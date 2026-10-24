import { t } from './i18n';

/** Names photographers give to output, not to what the camera shot. */
const OUTPUT = /edit|export|final|hasil|jpe?g|post|output|preview|picks?|pilihan|klien|client|retouch|web|ig|insta/i;

export const looksLikeOutput = (name: string) => OUTPUT.test(name);

export const folderLabel = (name: string) => (name === '' ? t('Folder utama') : `↳ ${name}`);

/** Any part of the path looks like output: `Canon/jpg` too. */
const outputPath = (path: string) => path.split('/').some(looksLikeOutput);

/**
 * What to analyze by default: the photos sitting in the chosen folder
 * itself. A folder that only has subfolders (`Canon/`, `Sony/`, at any
 * depth) gets all of them, except ones that look like exports.
 */
export function defaultFolders(folders: { name: string }[]): string[] {
  if (folders.some((f) => f.name === '')) return [''];
  const shoots = folders.filter((f) => !outputPath(f.name)).map((f) => f.name);
  return shoots.length ? shoots : folders.map((f) => f.name);
}

export interface FolderNode<F> {
  /** "Canon/jpg" */
  path: string;
  /** "jpg" */
  name: string;
  /** 1 for a subfolder of the chosen folder, 2 below that… */
  depth: number;
  /** Photos directly in it; null for a folder that only holds folders. */
  own: F | null;
  /** Every folder with photos at or below this one (what its checkbox picks). */
  paths: string[];
  photos: number;
  bytes: number;
  hasChildren: boolean;
}

/**
 * The subfolders as a tree in reading order (parent, then its children A–Z),
 * including folders that only hold other folders, so `Wedding/Canon/jpg`
 * shows under `Wedding` and `Canon`. The chosen folder itself ("") is left
 * out; its own photos are a separate row.
 */
export function folderTree<F extends { name: string; photos: number; bytes: number }>(folders: F[]): FolderNode<F>[] {
  const own = new Map(folders.map((f) => [f.name, f]));
  const children = new Map<string, Set<string>>();
  for (const f of folders) {
    if (f.name === '') continue;
    const parts = f.name.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/');
      const parent = parts.slice(0, i - 1).join('/');
      if (!children.has(parent)) children.set(parent, new Set());
      children.get(parent)!.add(path);
    }
  }
  const out: FolderNode<F>[] = [];
  const walk = (parent: string, depth: number) => {
    const kids = [...(children.get(parent) ?? [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const path of kids) {
      const node: FolderNode<F> = {
        path,
        name: path.split('/').pop()!,
        depth,
        own: own.get(path) ?? null,
        paths: [],
        photos: 0,
        bytes: 0,
        hasChildren: children.has(path),
      };
      out.push(node);
      const start = out.length;
      walk(path, depth + 1);
      const below = out.slice(start);
      node.paths = [...(node.own ? [path] : []), ...below.filter((n) => n.own).map((n) => n.path)];
      node.photos = (node.own?.photos ?? 0) + below.reduce((n, c) => n + (c.own?.photos ?? 0), 0);
      node.bytes = (node.own?.bytes ?? 0) + below.reduce((n, c) => n + (c.own?.bytes ?? 0), 0);
    }
  };
  walk('', 1);
  return out;
}

/** A checkbox over several folders: all, some or none of them chosen. */
export function checkState(paths: string[], chosen: string[]): 'on' | 'some' | 'off' {
  const n = paths.filter((p) => chosen.includes(p)).length;
  return n === 0 ? 'off' : n === paths.length ? 'on' : 'some';
}

/** Clicking such a checkbox: all chosen → none; otherwise → all. */
export function toggleAll(paths: string[], chosen: string[]): string[] {
  return checkState(paths, chosen) === 'on'
    ? chosen.filter((c) => !paths.includes(c))
    : [...chosen, ...paths.filter((p) => !chosen.includes(p))];
}
