/**
 * AI Denoise, off the page's thread so the editor stays smooth: FFDNet
 * (KAIR, MIT — 3.4 MB, public/models) run over the photo in tiles. On the
 * graphics card (WebGPU) when it gives the same answer as the processor on a
 * test patch — some cards do not — else on the processor (WebAssembly), where
 * the page runs several of these at once, a band of the photo each
 * (`denoise.ts`): one runtime there uses one core.
 */
import * as ort from 'onnxruntime-web/webgpu';

export type DenoiseRequest =
  /**
   * Loads the model — on the card when it can be trusted, unless `cpu` —
   * and says where it runs. Kept for the jobs that follow.
   */
  | { type: 'load'; model: string; cpu?: boolean }
  /** Cleans a picture (or a band of one) at noise level `sigma` (0–255). */
  | {
      type: 'clean';
      width: number;
      height: number;
      /** RGBA, row by row. */
      pixels: Uint8ClampedArray;
      sigma: number;
    };
export type DenoiseMessage =
  | { type: 'loaded'; gpu: boolean }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; pixels: Uint8ClampedArray }
  | { type: 'error'; message: string };

ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
// Its notes on where each step runs are not problems: only real errors are said.
ort.env.logLevel = 'error';

const post = (m: DenoiseMessage, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage: (m: unknown, t: Transferable[]) => void }).postMessage(
    m,
    transfer,
  );

/** The session, on the card when it can be trusted (and asked for). */
async function load(model: string, cpuOnly: boolean) {
  const bytes = new Uint8Array(await (await fetch(model)).arrayBuffer());
  const cpu = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    logSeverityLevel: 3,
  });
  const gpuApi = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  try {
    if (!cpuOnly && gpuApi && (await gpuApi.requestAdapter())) {
      const gpu = await ort.InferenceSession.create(bytes, {
        executionProviders: ['webgpu'],
        logSeverityLevel: 3,
      });
      // The same patch on both: the card is used only if it agrees.
      const N = 64;
      const data = new Float32Array(3 * N * N).map(() => Math.random());
      const feeds = () => ({
        image: new ort.Tensor('float32', data, [1, 3, N, N]),
        sigma: new ort.Tensor('float32', new Float32Array([25 / 255]), [1, 1, 1, 1]),
      });
      const a = (await cpu.run(feeds())).denoised!.data as Float32Array;
      const b = (await gpu.run(feeds())).denoised!.data as Float32Array;
      let worst = 0;
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
      if (worst < 0.01) {
        await cpu.release();
        return { session: gpu, gpu: true };
      }
      await gpu.release();
    }
  } catch {
    // No card, or it failed: the processor it is.
  }
  return { session: cpu, gpu: false };
}

let loaded: { session: ort.InferenceSession; gpu: boolean } | null = null;

self.onmessage = async (e: MessageEvent<DenoiseRequest>) => {
  const q = e.data;
  try {
    if (q.type === 'load') {
      loaded = await load(q.model, Boolean(q.cpu));
      post({ type: 'loaded', gpu: loaded.gpu });
      return;
    }
    if (!loaded) throw new Error('AI Denoise belum dimuat.');
    const { session, gpu } = loaded;
    const { width: W, height: H, pixels, sigma } = q;
    // Bigger tiles on the card; smaller ones on the processor, for steady progress.
    const T = gpu ? 512 : 256;
    const M = 16;
    const step = T - 2 * M;
    const even = (v: number) => v + (v % 2);
    const Tw = Math.min(T, even(W));
    const Th = Math.min(T, even(H));
    const cols = Math.ceil(W / step);
    const rows = Math.ceil(H / step);
    const out = new Uint8ClampedArray(pixels.length);
    const sig = new ort.Tensor('float32', new Float32Array([sigma / 255]), [1, 1, 1, 1]);
    const input = new Float32Array(3 * Tw * Th);
    let done = 0;
    for (let ty = 0; ty < H; ty += step) {
      for (let tx = 0; tx < W; tx += step) {
        // The window read: a margin round the part written, kept inside the picture.
        const wx = Math.max(0, Math.min(tx - M, W - Tw));
        const wy = Math.max(0, Math.min(ty - M, H - Th));
        for (let y = 0; y < Th; y++) {
          const sy = Math.min(H - 1, wy + y);
          for (let x = 0; x < Tw; x++) {
            const i = (sy * W + Math.min(W - 1, wx + x)) * 4;
            const o = y * Tw + x;
            input[o] = pixels[i]! / 255;
            input[Tw * Th + o] = pixels[i + 1]! / 255;
            input[2 * Tw * Th + o] = pixels[i + 2]! / 255;
          }
        }
        const result = (
          await session.run({
            image: new ort.Tensor('float32', input, [1, 3, Th, Tw]),
            sigma: sig,
          })
        ).denoised!.data as Float32Array;
        for (let y = ty; y < Math.min(H, ty + step); y++) {
          for (let x = tx; x < Math.min(W, tx + step); x++) {
            const o = (y - wy) * Tw + (x - wx);
            const i = (y * W + x) * 4;
            out[i] = result[o]! * 255;
            out[i + 1] = result[Tw * Th + o]! * 255;
            out[i + 2] = result[2 * Tw * Th + o]! * 255;
            out[i + 3] = pixels[i + 3]!;
          }
        }
        done++;
        post({ type: 'progress', done, total: cols * rows });
      }
    }
    post({ type: 'done', pixels: out }, [out.buffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
