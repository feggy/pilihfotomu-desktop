/**
 * Browser-only preview: fakes the Rust side so the UI can be opened in a
 * normal browser at http://localhost:1420/?mock=review (or home, setup,
 * picks, compare). Loaded only by `npm run dev` outside the Tauri window;
 * never part of a production build.
 */

import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';

import type { FolderInfo, PhotoEntry, Reason, Session, Status } from '../lib/api';

const N = 96;
const T0 = 1_791_800_000;

function photo(i: number): PhotoEntry {
  const sony = i % 5 === 4;
  const number = 101 + i;
  const stem = sony ? `DSC_${String(number).padStart(4, '0')}` : `IMG_${String(number).padStart(4, '0')}`;
  const burst = Math.floor(i / 4) % 3 === 0 ? Math.floor(i / 4) : null;
  const roll = (i * 37) % 10;
  let status: Status = roll < 4 ? 'pick' : roll < 6 ? 'maybe' : 'reject';
  const reasons: Reason[] = [];
  if (status === 'reject')
    reasons.push(roll === 6 ? { kind: 'blur' } : roll === 7 ? { kind: 'eyesClosed', closed: 1, faces: 2 } : { kind: 'duplicate', of: 101 });
  if (status === 'maybe') reasons.push(roll === 4 ? { kind: 'dark' } : { kind: 'softFocus' });
  if (burst != null && i % 4 === 0) {
    status = 'pick';
    reasons.splice(0, reasons.length, { kind: 'bestInGroup' });
  }
  return {
    id: i,
    stem,
    prefix: sony ? 'DSC_' : 'IMG_',
    number,
    folder: sony ? 'sony' : '',
    raw: `/Sesi/${stem}.${sony ? 'ARW' : 'CR3'}`,
    jpeg: null,
    name: `${stem}.${sony ? 'ARW' : 'CR3'}`,
    thumb: `https://picsum.photos/seed/pfm${i}/640/427`,
    takenAt: T0 + i * (burst != null ? 0.4 : 20),
    camera: sony ? 'SONY ILCE-7M4' : 'Canon EOS R6',
    metrics: { sharpness: status === 'reject' ? 18 : status === 'maybe' ? 38 : 70 + (i % 25), brightness: roll === 4 ? 28 : 120, shadowsClipped: 0, highlightsClipped: 0, dhash: 0 },
    faces: [
      { x: 0.3, y: 0.25, w: 0.14, h: 0.2, score: 0.93, leftEye: 0.28, rightEye: 0.27, smile: i % 3 ? 0.7 : 0.1 },
      { x: 0.52, y: 0.2, w: 0.14, h: 0.2, score: 0.92, leftEye: roll === 7 ? 0.06 : 0.3, rightEye: roll === 7 ? 0.05 : 0.29 },
    ],
    error: null,
    status,
    rating: status === 'pick' ? (reasons.length ? 5 : 4) : status === 'maybe' ? 3 : 1,
    reasons,
    group: burst,
    autoStatus: status,
  };
}

const session: Session = {
  id: 'mock',
  root: '/Users/demo/Pictures/Wedding Rina & Dimas',
  name: 'Wedding Rina & Dimas',
  createdAt: T0,
  durationMs: 192_000,
  options: { strictness: 'balanced', shootType: 'auto', checkBlur: true, checkExposure: true, checkDuplicates: true, checkEyes: true, checkSmile: true },
  folders: [''],
  exported: false,
  photos: Array.from({ length: N }, (_, i) => photo(i)),
};

const folder: FolderInfo = {
  root: session.root,
  name: session.name,
  folders: [
    { name: '', photos: N, bytes: 38.4 * 1024 ** 3, formats: { ARW: 19, CR3: 77 } },
    { name: 'edited', photos: 62, bytes: 2.82 * 1024 ** 3, formats: { JPG: 62 } },
    { name: 'jpg', photos: 96, bytes: 842 * 1024 ** 2, formats: { JPG: 96 } },
    { name: 'post', photos: 9, bytes: 11.7 * 1024 ** 2, formats: { JPG: 9 } },
  ],
};

const shelves = new Map<string, Map<string, string>>();
const shelf = (name: unknown) => {
  const key = String(name ?? 'drafts');
  if (!shelves.has(key)) shelves.set(key, new Map());
  return shelves.get(key)!;
};

export async function installMock() {
  mockWindows('main');
  mockIPC(
    async (cmd, args) => {
      const a = args as Record<string, unknown>;
      switch (cmd) {
        case 'list_sessions':
          return [
            { ...session, total: N, picks: 38, maybe: 19, rejects: 39, covers: [0, 8, 12].map((i) => session.photos[i].thumb), available: true },
          ];
        case 'open_session':
          return session;
        // Drafts and own templates, kept for the page's life (src-tauri: save_draft…).
        case 'save_draft':
          shelf(a.shelf).set(String(a.id), String(a.json));
          return null;
        case 'list_drafts':
          return [...shelf(a.shelf).values()].reverse();
        case 'delete_draft':
          shelf(a.shelf).delete(String(a.id));
          return null;
        case 'inspect_folder':
          return folder;
        case 'set_status':
        case 'set_rating':
        case 'delete_session':
          return null;
        case 'full_res_supported':
          return true;
        case 'recull':
          session.options = a.options as Session['options'];
          return { ...session, photos: session.photos.map((p) => ({ ...p })) };
        case 'save_export': {
          // Raw body: the picture bytes. Remember the size so a test can check it.
          const bytes = args as unknown as Uint8Array;
          (window as unknown as { __lastExport?: number }).__lastExport = bytes.byteLength;
          return `${session.root}/Konten/konten-${bytes.byteLength}.jpg`;
        }
        case 'cache_info':
          return { dir: '/Users/demo/Library/Caches/com.pilihfotomu.desktop', previews: 812e6, full: 2.4e9, thumbs: 96e6, unusedThumbs: 31e6 };
        case 'clear_cache':
          return 3.24e9;
        case 'export_xmp':
          return { written: 77, skippedExisting: 0, skippedJpeg: 0, markedJpeg: 19, markedFolder: `${session.root}/JPG bertanda`, failed: [] };
        case 'full_res_image':
          await new Promise((r) => setTimeout(r, 1200));
          return { path: `https://picsum.photos/seed/pfm${a.id}/3000/2000`, width: 3000, height: 2000 };
        case 'preview_image':
          return `https://picsum.photos/seed/pfm${a.id}/1600/1067`;
        case 'scan_photos':
          return session.photos;
        case 'thumbnails':
          return Object.fromEntries((a.ids as number[]).map((id) => [id, session.photos[id]?.thumb ?? null]));
        case 'copy_to_folder':
          return { copied: (a.ids as number[]).length * 2, alreadyThere: 0, failed: [], folder: `${session.root}/${a.folderName}` };
        case 'export_jpegs':
          return {
            written: (a.ids as number[]).length,
            alreadyThere: 0,
            failed: [],
            folder: `${session.root}/${a.folderName}`,
            smallest: [1616, 1080],
            largest: [3000, 2000],
          };
        case 'resolve_client_picks': {
          const nums = [...String(a.text).matchAll(/\d+/g)].map((m) => Number(m[0]));
          const found = nums.flatMap((n) => {
            const p = session.photos.find((x) => x.number === n);
            return p ? [{ query: String(n).padStart(4, '0'), photoId: p.id }] : [];
          });
          return {
            readAs: nums.map((n) => String(n).padStart(4, '0')),
            found,
            ambiguous: [{ query: '120', candidates: [19, 24] }],
            notFound: [{ query: 'DSC_0465', suggestions: [4, 9] }],
            warnings: [],
          };
        }
        case 'plugin:app|version':
          return '0.1.0';
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  // Thumbnails above are plain URLs here, not files in the app cache.
  (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc = (p) => p;

  const screen = new URLSearchParams(location.search).get('mock');
  const { useApp } = await import('../store');
  const app = useApp.getState();
  if (screen === 'review' || screen === 'picks' || screen === 'compare') {
    useApp.setState({ session, selectedId: 8 });
    app.go(
      screen === 'compare'
        ? { name: 'compare', group: 0 }
        : screen === 'picks'
          ? { name: 'picks', root: session.root, back: { name: 'review' } }
          : { name: 'review' },
    );
  } else if (screen === 'setup') {
    app.go({ name: 'setup', folder });
  }
}
