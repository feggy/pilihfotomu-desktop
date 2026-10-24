/** English for messages that come from the Rust side (see `tRust`). */

export default {
  'Dibatalkan.': 'Cancelled.',
  'Nama folder tidak valid.': 'Invalid folder name.',
  'Sesi tidak ditemukan.': 'Session not found.',
  'Belum ada sesi yang dibuka.': 'No session is open.',
  'Foto tidak ditemukan.': 'Photo not found.',
  'Folder ini tidak berisi foto RAW atau JPEG.': 'This folder has no RAW or JPEG photos.',
  'Kualitas penuh belum tersedia di sistem operasi ini.': 'Full quality is not available on this operating system yet.',
  'Windows belum bisa membaca RAW ini. Pasang “Raw Image Extension” (gratis) dari Microsoft Store, lalu coba lagi.':
    'Windows can’t read this RAW yet. Install the free “Raw Image Extension” from the Microsoft Store, then try again.',
  'file tidak bisa dibuka oleh macOS': 'macOS could not open the file',
  'RAW tidak bisa di-decode oleh macOS': 'macOS could not decode the RAW',
  'file hasil tidak bisa dibuat': 'could not create the output file',
  'gagal menulis JPEG': 'failed to write the JPEG',
  'hasil decode tidak lengkap': 'decoded picture is incomplete',
  'nama file tidak valid': 'invalid file name',
  'sudah ada file lain dengan nama sama di folder tujuan': 'another file with the same name is already in the destination folder',
  'bukan file JPEG yang bisa dibaca': 'not a readable JPEG file',
  'tidak ada preview JPEG di dalam file': 'no JPEG preview inside the file',
} as Record<string, string>;

/** Messages with a name or number inside: [pattern, English with $1…]. */
export const PATTERNS: [RegExp, string][] = [
  [
    /^Folder “(.+)” tidak ditemukan\. Kalau ada di drive eksternal, sambungkan dulu drivenya lalu coba lagi\.$/s,
    'Folder “$1” not found. If it is on an external drive, connect the drive and try again.',
  ],
  [/^Folder tidak ditemukan: (.+)$/s, 'Folder not found: $1'],
  [/^Folder tidak bisa dibaca: (.+)$/s, 'Folder can’t be read: $1'],
  [/^Deteksi mata tidak bisa dijalankan: (.+)$/s, 'Eye detection could not start: $1'],
  [/^model wajah tidak bisa dimuat: (.+)$/s, 'face model could not be loaded: $1'],
  [/^Gagal menyimpan sesi: (.+)$/s, 'Failed to save the session: $1'],
  [
    /^Folder ini sepertinya bukan sesi yang sama: hanya (\d+) dari (\d+) foto yang namanya cocok\. Pilih folder lain\.$/s,
    'This doesn’t look like the same session: only $1 of $2 photo names match. Choose another folder.',
  ],
  [/^RAW tidak bisa di-decode oleh Windows: (.+)$/s, 'Windows could not decode the RAW: $1'],
  [/^preview tidak bisa dibaca: (.+)$/s, 'preview can’t be read: $1'],
  [/^path tidak valid: (.+)$/s, 'invalid path: $1'],
  [
    /^Rentang (.+)–(.+) terlalu panjang \((\d+) foto\), dilewati\. Salah ketik\?$/s,
    'Range $1–$2 is too long ($3 photos), skipped. A typo?',
  ],
];
