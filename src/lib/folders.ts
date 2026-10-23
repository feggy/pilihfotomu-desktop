/** Names photographers give to output, not to what the camera shot. */
const OUTPUT = /edit|export|final|hasil|jpe?g|post|output|preview|picks?|pilihan|klien|client|retouch|web|ig|insta/i;

export const looksLikeOutput = (name: string) => OUTPUT.test(name);

export const folderLabel = (name: string) => (name === '' ? 'Folder utama' : `↳ ${name}`);

/**
 * What to analyze by default: the photos sitting in the chosen folder
 * itself. A folder that only has subfolders (`Canon/`, `Sony/`) gets all of
 * them, except ones that look like exports.
 */
export function defaultFolders(folders: { name: string }[]): string[] {
  if (folders.some((f) => f.name === '')) return [''];
  const shoots = folders.filter((f) => !looksLikeOutput(f.name)).map((f) => f.name);
  return shoots.length ? shoots : folders.map((f) => f.name);
}
