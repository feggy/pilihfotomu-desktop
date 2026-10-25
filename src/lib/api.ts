/**
 * Typed wrappers around the Rust commands in `src-tauri/src/lib.rs`. Shapes
 * mirror the serde structs there; keep both sides in step.
 */

import { Channel, convertFileSrc, invoke } from '@tauri-apps/api/core';

export type Status = 'pick' | 'maybe' | 'reject';
export type Strictness = 'loose' | 'balanced' | 'strict';
/** Mirrors `cull::ShootType`. */
export type ShootType =
  | 'auto'
  | 'wedding'
  | 'prewedding'
  | 'lamaran'
  | 'wisuda'
  | 'event'
  | 'keluarga'
  | 'portrait'
  | 'lainnya';

export type Reason =
  | { kind: 'blur' }
  | { kind: 'softFocus' }
  | { kind: 'subjectSoft' }
  | { kind: 'dark' }
  | { kind: 'bright' }
  | { kind: 'duplicate'; of: number }
  | { kind: 'eyesClosed'; closed: number; faces: number }
  | { kind: 'bestInGroup' }
  /** Same pose as `of`, shot again after a pause. */
  | { kind: 'similar'; of: number }
  /** Good, but not among the `limit` best asked for. */
  | { kind: 'overLimit'; limit: number };

export interface Metrics {
  sharpness: number;
  brightness: number;
  shadowsClipped: number;
  highlightsClipped: number;
  dhash: number;
}

/** A face as fractions of the (upright) image, with eye aspect ratios. */
export interface Face {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  leftEye: number;
  rightEye: number;
  /** 0–1; null when the face is turned too far to tell. */
  smile?: number | null;
  /** Face sharpness (Laplacian variance); null when the face is too small. */
  sharpness?: number | null;
  /** Face width in source pixels. */
  px?: number;
  /** MediaPipe eyeBlinkLeft / eyeBlinkRight, 0 open – 1 shut. */
  blink?: [number, number] | null;
  /** Same number = same person within the session (`faces::assign_people`). */
  person?: number | null;
  /** This person's own blink cut-off, when seen often enough. */
  blinkCut?: number | null;
  /** This person's usual face sharpness in the session. */
  sharpRef?: number | null;
}

/** Mirrors `faces::EAR_CLOSED` / `EAR_SEALED` / `BLINK_CLOSED` and `Face::eyes_closed`. */
export const EAR_CLOSED = 0.05;
export const EAR_SEALED = 0.03;
export const BLINK_CLOSED = 0.55;
/** Mirrors `faces::SMILE`. */
export const SMILE = 0.45;
export const smiling = (f: Face) => (f.smile ?? 0) >= SMILE;

export const eyesClosed = (f: Face) =>
  (Math.max(f.leftEye, f.rightEye) < EAR_CLOSED && Math.min(f.leftEye, f.rightEye) < EAR_SEALED) ||
  (f.blink != null && Math.min(...f.blink) >= (f.blinkCut ?? BLINK_CLOSED));

/** A file pair found in a folder, before any analysis. */
export interface Photo {
  id: number;
  stem: string;
  prefix: string;
  number: number | null;
  folder: string;
  raw: string | null;
  jpeg: string | null;
}

export interface PhotoEntry extends Photo {
  name: string;
  thumb: string | null;
  takenAt: number | null;
  camera: string | null;
  metrics: Metrics | null;
  faces: Face[];
  error: string | null;
  status: Status;
  rating: number;
  reasons: Reason[];
  group: number | null;
  autoStatus: Status;
  /** The AI's stars; absent in older sessions. */
  autoRating?: number | null;
  /** Status or stars set by hand; absent in older sessions. */
  manual?: boolean;
}

/** Changed by hand (older sessions only show it as a status different from the AI's). */
export const isManual = (p: PhotoEntry) => !!p.manual || p.status !== p.autoStatus;

export interface Options {
  strictness: Strictness;
  shootType: ShootType;
  checkBlur: boolean;
  checkExposure: boolean;
  checkDuplicates: boolean;
  checkEyes: boolean;
  checkSmile: boolean;
  /** "Pilih N terbaik": at most this many Picks. */
  limit?: number | null;
}

export interface Session {
  id: string;
  root: string;
  name: string;
  createdAt: number;
  durationMs: number;
  options: Options;
  /** Top folders that were analyzed ("" = the session folder itself). */
  folders: string[];
  exported: boolean;
  photos: PhotoEntry[];
}

export interface SessionSummary {
  id: string;
  root: string;
  name: string;
  createdAt: number;
  durationMs: number;
  exported: boolean;
  total: number;
  picks: number;
  maybe: number;
  rejects: number;
  covers: string[];
  /** The settings the photos were judged with. */
  options: Options;
  /** Folder reachable right now (an external drive may be unplugged). */
  available: boolean;
}

export interface FolderSummary {
  /** "" for the chosen folder itself. */
  name: string;
  photos: number;
  bytes: number;
  formats: Record<string, number>;
}

export interface FolderInfo {
  root: string;
  name: string;
  /** The folder itself first (name ""), then subfolders with photos. */
  folders: FolderSummary[];
}

export type Progress =
  | { event: 'started'; total: number }
  | {
      event: 'photo';
      done: number;
      total: number;
      id: number;
      name: string;
      thumb: string | null;
      status: Status;
      reason: Reason | null;
    }
  | { event: 'grouping' };

export interface PickResult {
  readAs: string[];
  found: { query: string; photoId: number }[];
  ambiguous: { query: string; candidates: number[] }[];
  notFound: { query: string; suggestions: number[] }[];
  warnings: string[];
}

export interface ExportReport {
  written: number;
  skippedExisting: number;
  skippedJpeg: number;
  /** JPEG-only photos copied with the marks written inside. */
  markedJpeg: number;
  markedFolder: string | null;
  failed: string[];
}

export interface CacheInfo {
  dir: string;
  previews: number;
  full: number;
  thumbs: number;
  unusedThumbs: number;
}

export interface JpegOptions {
  scalePercent: number;
  quality: number;
}

export interface JpegReport {
  written: number;
  alreadyThere: number;
  failed: string[];
  folder: string;
  smallest: [number, number] | null;
  largest: [number, number] | null;
}

export interface CopyReport {
  copied: number;
  alreadyThere: number;
  failed: string[];
  folder: string;
}

export const api = {
  inspectFolder: (path: string) => invoke<FolderInfo>('inspect_folder', { path }),
  analyzeFolder: (path: string, folders: string[], options: Options, onProgress: (p: Progress) => void) => {
    const channel = new Channel<Progress>();
    channel.onmessage = onProgress;
    return invoke<Session>('analyze_folder', { path, folders, options, onProgress: channel });
  },
  cancelAnalysis: () => invoke<void>('cancel_analysis'),
  /** Reads the open session's faces again (blink scores, people); cancelled like an analysis. */
  rereadFaces: (onProgress: (p: { done: number; total: number }) => void) => {
    const channel = new Channel<{ done: number; total: number }>();
    channel.onmessage = onProgress;
    return invoke<Session>('reread_faces', { onProgress: channel });
  },
  listSessions: () => invoke<SessionSummary[]>('list_sessions'),
  openSession: (id: string) => invoke<Session>('open_session', { id }),
  /** Remakes a session's thumbnails whose cache files are gone; how many. */
  restoreThumbs: (id: string) => invoke<number>('restore_thumbs', { id }),
  /** Forgets the session; the photos and any exported files stay. */
  deleteSession: (id: string) => invoke<void>('delete_session', { id }),
  /** Points a session at the folder it was moved to (photos matched by name). */
  relinkSession: (id: string, path: string) => invoke<Session>('relink_session', { id, path }),
  setStatus: (ids: number[], status: Status) => invoke<void>('set_status', { ids, status }),
  setRating: (ids: number[], rating: number) => invoke<void>('set_rating', { ids, rating }),
  setMarks: (marks: { id: number; status: Status; rating: number }[]) => invoke<void>('set_marks', { marks }),
  /** Decides the open session again with other settings; hand-made changes stay. */
  recull: (options: Options) => invoke<Session>('recull', { options }),
  cacheInfo: () => invoke<CacheInfo>('cache_info'),
  /** Frees previews, full-size pictures and unused thumbnails; returns bytes freed. */
  clearCache: () => invoke<number>('clear_cache'),
  previewImage: (root: string, id: number) => invoke<string>('preview_image', { root, id }),
  fullResSupported: () => invoke<boolean>('full_res_supported'),
  fullResImage: (root: string, id: number) =>
    invoke<{ path: string; width: number; height: number }>('full_res_image', { root, id }),
  scanPhotos: (root: string) => invoke<Photo[]>('scan_photos', { root }),
  /** Photos picked file by file: a key to use as `root`, the folder results go to, and the photos. */
  openFiles: (paths: string[]) => invoke<{ root: string; dir: string; photos: Photo[] }>('open_files', { paths }),
  thumbnails: (root: string, ids: number[]) =>
    invoke<Record<number, string | null>>('thumbnails', { root, ids }),
  resolveClientPicks: (root: string, folders: string[], text: string) =>
    invoke<PickResult>('resolve_client_picks', { root, folders, text }),
  exportXmp: (existing: 'skip' | 'overwrite', withReasons: boolean, jpegCopies: boolean) =>
    invoke<ExportReport>('export_xmp', { existing, withReasons, jpegCopies }),
  copyToFolder: (root: string, ids: number[], folderName: string) =>
    invoke<CopyReport>('copy_to_folder', { root, ids, folderName }),
  /** Saves picture bytes into `<root>/<folder>/<name>` (never overwrites); returns the path written. */
  saveExport: (root: string, folder: string, name: string, bytes: Uint8Array) =>
    invoke<string>('save_export', bytes, {
      headers: { root: encodeURIComponent(root), folder: encodeURIComponent(folder), name: encodeURIComponent(name) },
    }),
  saveDraft: (id: string, json: string) => invoke<void>('save_draft', { id, json }),
  loadDraft: (id: string) => invoke<string>('load_draft', { id }),
  listDrafts: () => invoke<string[]>('list_drafts'),
  deleteDraft: (id: string) => invoke<void>('delete_draft', { id }),
  /** The photographer's own templates (Buat konten › Template saya), kept like drafts. */
  saveMyTemplate: (id: string, json: string) => invoke<void>('save_draft', { id, json, shelf: 'templates' }),
  listMyTemplates: () => invoke<string[]>('list_drafts', { shelf: 'templates' }),
  deleteMyTemplate: (id: string) => invoke<void>('delete_draft', { id, shelf: 'templates' }),
  exportJpegs: (
    root: string,
    ids: number[],
    folderName: string,
    options: JpegOptions,
    onProgress: (p: { done: number; total: number }) => void,
  ) => {
    const channel = new Channel<{ done: number; total: number }>();
    channel.onmessage = onProgress;
    return invoke<JpegReport>('export_jpegs', { root, ids, folderName, options, onProgress: channel });
  },
};

/** Thumbnails live in the app cache; the asset protocol serves them. */
export const thumbUrl = (path: string | null) => (path ? convertFileSrc(path) : undefined);
