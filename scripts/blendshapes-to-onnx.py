"""MediaPipe face_blendshapes.tflite -> ONNX, op by op (only the ops this model uses).

Makes src-tauri/models/face_blendshapes.onnx (see the README there). Needs
`pip install tflite onnx numpy`; tflite2onnx can't read this model.

usage: python3 -I scripts/blendshapes-to-onnx.py face_blendshapes.tflite out.onnx
"""
import sys

import numpy as np
import onnx
import tflite
from onnx import TensorProto, helper, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
buf = open(src, 'rb').read()
m = tflite.Model.GetRootAsModel(buf, 0)
g = m.Subgraphs(0)
OPS = {v: k for k, v in tflite.BuiltinOperator.__dict__.items() if not k.startswith('_')}
DT = {0: np.float32, 1: np.float16, 2: np.int32, 4: np.int64}

nodes, inits = [], {}
consts = {}  # tensor index -> numpy value (for shape / axes operands)


def name(i):
    return 't%d' % i


def tensor_const(i):
    t = g.Tensors(i)
    b = m.Buffers(t.Buffer())
    if b.DataLength() == 0:
        return None
    shape = list(t.ShapeAsNumpy()) if t.ShapeLength() else []
    return np.frombuffer(b.DataAsNumpy().tobytes(), dtype=DT[t.Type()]).reshape(shape)


def const(i, value=None):
    """Registers tensor i (or a given value under a fresh name) as an initializer."""
    if value is None:
        value = consts[i]
        n = name(i)
    else:
        n = 'c%d_%d' % (i, len(inits))
    if n not in inits:
        inits[n] = numpy_helper.from_array(np.ascontiguousarray(value), n)
    return n


def inp(i):
    if i in consts:
        v = consts[i]
        return const(i, v.astype(np.float32) if v.dtype == np.float16 else None)
    return name(i)


def node(op, ins, outs, **attrs):
    nodes.append(helper.make_node(op, ins, outs, **attrs))


def act(fused, out):
    """Applies a fused activation to the tensor named `out`'s producer output."""
    if fused == 0:
        return
    assert fused == 1, 'only NONE / RELU expected, got %d' % fused
    tmp = out + '_pre'
    nodes[-1].output[0] = tmp
    node('Relu', [tmp], [out])


for i in range(g.TensorsLength()):
    v = tensor_const(i)
    if v is not None:
        consts[i] = v

for k in range(g.OperatorsLength()):
    op = g.Operators(k)
    c = m.OperatorCodes(op.OpcodeIndex())
    kind = OPS[max(c.BuiltinCode(), c.DeprecatedBuiltinCode())]
    ins = [op.Inputs(j) for j in range(op.InputsLength())]
    out = op.Outputs(0)
    o = op.BuiltinOptions()

    def opts(cls):
        x = cls()
        x.Init(o.Bytes, o.Pos)
        return x

    if kind == 'DEQUANTIZE':
        consts[out] = consts[ins[0]].astype(np.float32)
    elif kind in ('MEAN', 'SUM'):
        axes = consts[ins[1]].reshape(-1).astype(np.int64)
        keep = int(opts(tflite.ReducerOptions).KeepDims())
        if kind == 'MEAN':
            node('ReduceMean', [inp(ins[0])], [name(out)], axes=axes.tolist(), keepdims=keep)
        else:
            node('ReduceSum', [inp(ins[0]), const(ins[1], axes)], [name(out)], keepdims=keep)
    elif kind in ('ADD', 'SUB', 'MUL', 'DIV'):
        cls = {'ADD': tflite.AddOptions, 'SUB': tflite.SubOptions, 'MUL': tflite.MulOptions, 'DIV': tflite.DivOptions}[kind]
        node(kind.capitalize(), [inp(ins[0]), inp(ins[1])], [name(out)])
        act(opts(cls).FusedActivationFunction(), name(out))
    elif kind == 'SQUARED_DIFFERENCE':
        d = name(out) + '_d'
        node('Sub', [inp(ins[0]), inp(ins[1])], [d])
        node('Mul', [d, d], [name(out)])
    elif kind == 'SQRT':
        node('Sqrt', [inp(ins[0])], [name(out)])
    elif kind == 'RSQRT':
        s = name(out) + '_s'
        node('Sqrt', [inp(ins[0])], [s])
        node('Reciprocal', [s], [name(out)])
    elif kind == 'NEG':
        node('Neg', [inp(ins[0])], [name(out)])
    elif kind == 'LOGISTIC':
        node('Sigmoid', [inp(ins[0])], [name(out)])
    elif kind == 'RESHAPE':
        shape = list(g.Tensors(out).ShapeAsNumpy())
        node('Reshape', [inp(ins[0]), const(out, np.array(shape, np.int64))], [name(out)])
    elif kind == 'TRANSPOSE':
        node('Transpose', [inp(ins[0])], [name(out)], perm=consts[ins[1]].astype(int).tolist())
    elif kind == 'CONCATENATION':
        node('Concat', [inp(i) for i in ins], [name(out)], axis=opts(tflite.ConcatenationOptions).Axis())
        act(opts(tflite.ConcatenationOptions).FusedActivationFunction(), name(out))
    elif kind == 'STRIDED_SLICE':
        x = opts(tflite.StridedSliceOptions)
        assert x.EllipsisMask() == 0 and x.NewAxisMask() == 0
        rank = g.Tensors(ins[0]).ShapeLength()
        shape = list(g.Tensors(ins[0]).ShapeAsNumpy())
        b, e, s = (consts[i].astype(np.int64).copy() for i in ins[1:4])
        for a in range(rank):
            if x.BeginMask() >> a & 1:
                b[a] = 0
            if x.EndMask() >> a & 1:
                e[a] = shape[a]
            if x.ShrinkAxisMask() >> a & 1:
                e[a] = b[a] + 1
        sl = name(out) + ('_sl' if x.ShrinkAxisMask() else '')
        node('Slice', [inp(ins[0]), const(ins[1], b), const(ins[2], e), const(ins[0], np.arange(rank, dtype=np.int64)), const(ins[3], s)], [sl])
        if x.ShrinkAxisMask():
            shrink = [a for a in range(rank) if x.ShrinkAxisMask() >> a & 1]
            node('Squeeze', [sl, const(out, np.array(shrink, np.int64))], [name(out)])
    elif kind == 'CONV_2D':
        x = opts(tflite.Conv2DOptions)
        w = consts[ins[1]]  # [Cout, 1, 1, Cin], NHWC 1×1 conv = matmul on the last axis
        assert w.shape[1] == 1 and w.shape[2] == 1 and x.StrideW() == 1 and x.StrideH() == 1
        mm = name(out) + '_mm'
        node('MatMul', [inp(ins[0]), const(ins[1], w.reshape(w.shape[0], w.shape[3]).T.astype(np.float32))], [mm])
        node('Add', [mm, inp(ins[2])], [name(out)])
        act(x.FusedActivationFunction(), name(out))
    else:
        raise SystemExit('unsupported op ' + kind)

gi, go = g.Inputs(0), g.Outputs(0)
graph = helper.make_graph(
    nodes,
    'face_blendshapes',
    [helper.make_tensor_value_info(name(gi), TensorProto.FLOAT, [int(v) for v in g.Tensors(gi).ShapeAsNumpy()])],
    [helper.make_tensor_value_info(name(go), TensorProto.FLOAT, [int(v) for v in g.Tensors(go).ShapeAsNumpy()])],
    list(inits.values()),
)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)], producer_name='pilihfotomu tflite->onnx')
model.ir_version = 7
onnx.checker.check_model(model)
onnx.save(model, dst)
print('ok', dst, len(nodes), 'nodes')
