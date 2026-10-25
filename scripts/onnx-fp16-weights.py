"""Stores an ONNX model's large float weights as float16 (Cast back to float32
at load), halving the file; the arithmetic stays float32.

Used for src-tauri/models/face_recognition_sface_2021dec_f16.onnx (see the
README there). Needs `pip install onnx numpy`.

usage: python3 -I scripts/onnx-fp16-weights.py in.onnx out.onnx
"""
import sys

import numpy as np
import onnx
from onnx import helper, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
init_names = {i.name for i in g.initializer}
# Old exports list weights as graph inputs too; only real inputs stay.
real_inputs = [i for i in g.input if i.name not in init_names]
del g.input[:]
g.input.extend(real_inputs)

casts = []
for init in g.initializer:
    if init.data_type != onnx.TensorProto.FLOAT or numpy_helper.to_array(init).size < 1024:
        continue
    half = numpy_helper.from_array(numpy_helper.to_array(init).astype(np.float16), init.name + '_f16')
    init.CopyFrom(half)
    casts.append(helper.make_node('Cast', [init.name], [init.name[: -len('_f16')]], to=onnx.TensorProto.FLOAT))

nodes = list(g.node)
del g.node[:]
g.node.extend(casts + nodes)
onnx.checker.check_model(m)
onnx.save(m, dst)
print('ok', dst, len(casts), 'weights as float16')
