import type { DenoiseMessage, DenoiseRequest } from './denoise.worker';
import { estimateSigma } from './denoise-sigma';

/**
 * AI Denoise: the photo cleaned of noise in this browser — never sent
 * anywhere. The model (3.4 MB) and its runtime load the first time only, in a
 * worker of their own: the editor stays smooth while it works.
 */

/** Longest side it is cleaned at — the size photos are developed at, at most. */
const MAX_SIDE = 4096;
const MODEL = '/models/ffdnet-color.onnx';

export type DenoiseProgress = { stage: 'model' | 'proses'; progress: number };

/** A download at full resolution: as large as the photo is developed then (see develop.ts). */
export const FULL_SIZE = { side: 8192, pixels: 36_000_000 };

/** The picture cleaned, as a canvas; rejects with an AbortError when stopped. */
export function denoisePicture(
  img: HTMLImageElement | HTMLCanvasElement,
  onProgress: (p: DenoiseProgress) => void,
  signal?: AbortSignal,
  /** How large it is cleaned at most; the editor's own size unless asked. */
  limit: { side: number; pixels?: number } = { side: MAX_SIDE },
): Promise<HTMLCanvasElement> {
  const iw = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const ih = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const k = Math.min(
    1,
    limit.side / Math.max(iw, ih, 1),
    limit.pixels ? Math.sqrt(limit.pixels / Math.max(1, iw * ih)) : 1,
  );
  const W = Math.max(2, Math.round(iw * k));
  const H = Math.max(2, Math.round(ih * k));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return Promise.reject(new Error('Browser ini tidak bisa memproses gambar.'));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H);

  const sigma = estimateSigma(data.data, W, H);
  return run(data, sigma, onProgress, signal).then((pixels) => {
    ctx.putImageData(new ImageData(pixels, W, H), 0, 0);
    return canvas;
  });
}

/** A margin of rows each band reads beyond its own, so its edges clean as the middle. */
const BAND_MARGIN = 32;

/** One worker: `load`, then `clean` jobs; answers in order. */
function spawn() {
  const worker = new Worker(new URL('./denoise.worker.ts', import.meta.url), { type: 'module' });
  const ask = <T extends DenoiseMessage['type']>(
    q: DenoiseRequest,
    until: T,
    onProgress?: (done: number, total: number) => void,
    transfer: Transferable[] = [],
  ) =>
    new Promise<Extract<DenoiseMessage, { type: T }>>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<DenoiseMessage>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress?.(m.done, m.total);
        else if (m.type === 'error') reject(new Error(m.message));
        else if (m.type === until) resolve(m as Extract<DenoiseMessage, { type: T }>);
      };
      worker.onerror = (e) => reject(new Error(e.message || 'AI Denoise gagal.'));
      worker.postMessage(q, transfer);
    });
  return { ask, stop: () => worker.terminate() };
}

/**
 * Cleans `image`: on the graphics card in one go when it can; else on the
 * processor in bands, one worker per core (up to 6) — the runtime uses one
 * core each, so a single one would leave most of the computer idle.
 */
async function run(
  image: ImageData,
  sigma: number,
  onProgress: (p: DenoiseProgress) => void,
  signal?: AbortSignal,
): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const { width: W, height: H } = image;
  const workers = [spawn()];
  const stopAll = () => workers.forEach((w) => w.stop());
  const aborted = new Promise<never>((_, reject) => {
    const stop = () => {
      stopAll();
      reject(new DOMException('Dibatalkan', 'AbortError'));
    };
    if (signal?.aborted) stop();
    signal?.addEventListener('abort', stop, { once: true });
  });
  const work = async () => {
    onProgress({ stage: 'model', progress: 0 });
    const { gpu } = await workers[0]!.ask({ type: 'load', model: MODEL }, 'loaded');
    if (gpu) {
      const px = new Uint8ClampedArray(image.data);
      const m = await workers[0]!.ask(
        { type: 'clean', width: W, height: H, pixels: px, sigma },
        'done',
        (done, total) =>
          onProgress({ stage: 'proses', progress: Math.round((done / total) * 100) }),
        [px.buffer],
      );
      return new Uint8ClampedArray(m.pixels);
    }
    // The processor: bands of rows, each with a margin, side by side.
    const cores = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));
    const n = Math.max(1, Math.min(cores, Math.floor(H / 128)));
    for (let k = 1; k < n; k++) workers.push(spawn());
    await Promise.all(
      workers.slice(1).map((w) => w.ask({ type: 'load', model: MODEL, cpu: true }, 'loaded')),
    );
    const out = new Uint8ClampedArray(image.data.length);
    const progress = new Array<number>(n).fill(0);
    const totals = new Array<number>(n).fill(1);
    const band = Math.ceil(H / n);
    await Promise.all(
      workers.map(async (w, k) => {
        const y0 = k * band;
        const y1 = Math.min(H, y0 + band);
        const r0 = Math.max(0, y0 - BAND_MARGIN);
        const r1 = Math.min(H, y1 + BAND_MARGIN);
        const px = image.data.slice(r0 * W * 4, r1 * W * 4);
        const m = await w.ask(
          { type: 'clean', width: W, height: r1 - r0, pixels: px, sigma },
          'done',
          (done, total) => {
            progress[k] = done;
            totals[k] = total;
            const sum = progress.reduce((a, b) => a + b, 0);
            const all = totals.reduce((a, b) => a + b, 0);
            onProgress({ stage: 'proses', progress: Math.round((sum / all) * 100) });
          },
          [px.buffer],
        );
        // Only the band's own rows: the margins were there to be read.
        out.set(m.pixels.subarray((y0 - r0) * W * 4, (y1 - r0) * W * 4), y0 * W * 4);
      }),
    );
    return out;
  };
  try {
    return await Promise.race([work(), aborted]);
  } finally {
    stopAll();
  }
}
