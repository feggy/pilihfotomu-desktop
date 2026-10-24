/** Roughly how many bytes a stored value takes: its pictures and data, and a little for the rest. */
export function byteSize(value: unknown, seen = new Set<object>()): number {
  if (value == null) return 0;
  if (value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value !== 'object') return 8;
  if (seen.has(value)) return 0;
  seen.add(value);
  let n = 0;
  for (const v of Object.values(value)) n += byteSize(v, seen);
  return n;
}
