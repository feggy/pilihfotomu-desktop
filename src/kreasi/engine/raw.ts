import type { RawMessage, RawRequest } from './raw.worker';

/**
 * Camera RAW files in the editor: read and drawn in a worker of its own (the
 * page stays smooth), never sent anywhere. The file itself is kept in this
 * browser (lut-store); the worker keeps the latest two read, and asks for a
 * file again when it has let it go.
 */

/** The RAW kinds LibRaw reads, by file extension. */
const RAW_EXTENSIONS = [
  'arw',
  'srf',
  'sr2',
  'cr2',
  'cr3',
  'crw',
  'nef',
  'nrw',
  'dng',
  'raf',
  'orf',
  'rw2',
  'pef',
  'srw',
  '3fr',
  'iiq',
  'x3f',
  'erf',
  'kdc',
  'mrw',
];
export const RAW_ACCEPT = RAW_EXTENSIONS.map((e) => `.${e}`).join(',');
export const isRawName = (name: string) =>
  RAW_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '');

export type RawInfo = {
  width: number;
  height: number;
  /** The sensor's full size (a download at full resolution). */
  sensor: { width: number; height: number };
  asShot: { kelvin: number; tint: number };
};

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, (m: RawMessage) => void>();
const reading = new Map<string, { resolve: (i: RawInfo) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./raw.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<RawMessage>) => {
    const m = e.data;
    if (m.type === 'decoded') {
      reading.get(m.key)?.resolve({
        width: m.width,
        height: m.height,
        sensor: m.sensor,
        asShot: m.asShot,
      });
      reading.delete(m.key);
    } else if (m.type === 'error' && m.id === undefined) {
      reading.get(m.key)?.reject(new Error(m.message));
      reading.delete(m.key);
    } else if ('id' in m && m.id !== undefined) {
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  };
  return worker;
}

const send = (q: RawRequest, transfer: Transferable[] = []) => getWorker().postMessage(q, transfer);

/**
 * Whether this device reads RAWs at the sensor's full size: a computer with
 * 8 GB or more (some 150 MB a RAW while it is open). Others read half — quick
 * and light, and a download still reads the full size once.
 */
function readsInFull() {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const phone = /Android|iPhone|iPad|iPod|Mobile/.test(navigator.userAgent);
  return !phone && (memory ?? 0) >= 8;
}

/** Reads a RAW into the worker (under `key`): its size as shown, and the camera's white balance. */
export async function readRaw(key: string, file: Blob): Promise<RawInfo> {
  const bytes = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    reading.set(key, { resolve, reject });
    send({ type: 'decode', key, bytes, full: readsInFull() }, [bytes]);
  });
}

/** A request answered by id; a file the worker let go is read again, once. */
async function ask(
  make: (id: number) => RawRequest,
  key: string,
  file: () => Promise<Blob | undefined>,
): Promise<RawMessage> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = nextId++;
    const m = await new Promise<RawMessage>((resolve) => {
      waiting.set(id, resolve);
      send(make(id));
    });
    if (m.type !== 'missing') return m;
    const blob = await file();
    if (!blob) throw new Error('File RAW tidak ada di browser ini.');
    await readRaw(key, blob);
  }
  throw new Error('File RAW tidak bisa dibaca.');
}

const toCanvas = (m: { width: number; height: number; pixels: Uint8ClampedArray }) => {
  const c = document.createElement('canvas');
  c.width = m.width;
  c.height = m.height;
  c.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(m.pixels), m.width, m.height),
    0,
    0,
  );
  return c;
};

/** The RAW drawn at a white balance, as a canvas. */
export async function renderRaw(
  key: string,
  kelvin: number,
  tint: number,
  file: () => Promise<Blob | undefined>,
): Promise<HTMLCanvasElement> {
  const m = await ask((id) => ({ type: 'render', id, key, kelvin, tint }), key, file);
  if (m.type === 'error') throw new Error(m.message);
  if (m.type !== 'rendered') throw new Error('RAW tidak bisa digambar.');
  return toCanvas(m);
}

/**
 * A RAW at the sensor's full size (the editor works from half), drawn at a
 * white balance — for a download at its full resolution. Some seconds, and
 * a few hundred MB while it runs.
 */
export async function renderRawFull(
  key: string,
  file: Blob,
  kelvin: number,
  tint: number,
): Promise<HTMLCanvasElement> {
  const ask = (bytes?: ArrayBuffer) => {
    const id = nextId++;
    return new Promise<RawMessage>((resolve) => {
      waiting.set(id, resolve);
      send({ type: 'full', id, key, bytes, kelvin, tint }, bytes ? [bytes] : []);
    });
  };
  // Read in full already (a computer that reads so): drawn from that, no reading again.
  let m = await ask();
  if (m.type === 'missing') m = await ask(await file.arrayBuffer());
  if (m.type === 'error') throw new Error(m.message);
  if (m.type !== 'rendered') throw new Error('RAW tidak bisa digambar.');
  return toCanvas(m);
}

/** The white balance that makes the spot at (u, v) of the RAW neutral. */
export async function neutralOfRaw(
  key: string,
  u: number,
  v: number,
  file: () => Promise<Blob | undefined>,
) {
  const m = await ask((id) => ({ type: 'neutral', id, key, u, v }), key, file);
  if (m.type !== 'neutral') throw new Error('Warna netral tidak bisa dibaca.');
  return { kelvin: m.kelvin, tint: m.tint };
}

/** For each RAW: the white balance to draw next, while one is being drawn. */
const next = new Map<string, { kelvin: number; tint: number } | null>();

/**
 * Draws RAW `key` at a white balance, then `done` — while a slider moves, only
 * the latest asked is drawn after the one under way, never a queue of them.
 */
export function drawRawLatest(
  key: string,
  kelvin: number,
  tint: number,
  file: () => Promise<Blob | undefined>,
  done: (canvas: HTMLCanvasElement, kelvin: number, tint: number) => void,
) {
  if (next.has(key)) {
    next.set(key, { kelvin, tint });
    return;
  }
  next.set(key, null);
  void (async () => {
    let want: { kelvin: number; tint: number } | null = { kelvin, tint };
    while (want) {
      try {
        done(await renderRaw(key, want.kelvin, want.tint, file), want.kelvin, want.tint);
      } catch {
        // Unreadable here: the picture stays as the camera shot it.
      }
      want = next.get(key) ?? null;
      next.set(key, null);
    }
    next.delete(key);
  })();
}
