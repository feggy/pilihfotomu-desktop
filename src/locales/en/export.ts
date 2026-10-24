/** English for export, copy-to-folder, setup and settings screens. */

export default {
  // shared (same as other dictionaries)
  Kembali: 'Back',
  Batal: 'Cancel',
  Pengaturan: 'Settings',
  Longgar: 'Loose',
  Seimbang: 'Balanced',
  Ketat: 'Strict',
  'Ketat seleksi': 'Strictness',
  'Jenis pemotretan': 'Shoot type',
  'Buka folder': 'Open folder',
  Selesai: 'Done',
  Segera: 'Soon',
  Foto: 'Photos',
  '{count} gagal:': '{count} failed:',

  // export-dialog.tsx
  'Ekspor hasil pilihan': 'Export results',
  '{pick} dipilih · {maybe} dicek · {reject} dilewati': '{pick} picked · {maybe} to check · {reject} skipped',
  'Ekspor {count} file XMP': ['Export {count} XMP file', 'Export {count} XMP files'],
  'Salin {count} JPG bertanda': ['Copy {count} marked JPG', 'Copy {count} marked JPGs'],
  'Buat {count} JPG': ['Create {count} JPG', 'Create {count} JPGs'],
  'Salin {count} foto': ['Copy {count} photo', 'Copy {count} photos'],
  'Buat file .xmp di samping tiap RAW. Satu file terbaca di ketiga aplikasi. File asli tidak disentuh.':
    'Writes an .xmp file next to each RAW. One file works in all three apps. Originals are not touched.',
  'Label hijau': 'Green label',
  'Label kuning': 'Yellow label',
  'Label merah': 'Red label',
  'Tambah keyword alasan (blur, duplikat…)': 'Add reason keywords (blurry, duplicate…)',
  'Timpa file .xmp yang sudah ada': 'Overwrite existing .xmp files',
  'Edit Lightroom yang tersimpan di file .xmp lama akan hilang.': 'Lightroom edits saved in the old .xmp files will be lost.',
  '{count} foto hanya JPEG: salin ke folder “{folder}” dengan label & bintang di dalamnya': [
    '{count} JPEG-only photo: copy to the “{folder}” folder with label & stars inside',
    '{count} JPEG-only photos: copy to the “{folder}” folder with labels & stars inside',
  ],
  'Aplikasi foto membaca label JPEG dari dalam file, bukan dari .xmp, dan file asli tidak pernah diubah. Import folder itu sebagai ganti JPEG aslinya. Ekspor ulang memperbarui salinannya.':
    'Photo apps read JPEG labels from inside the file, not from an .xmp, and originals are never changed. Import that folder instead of the original JPEGs. Exporting again updates the copies.',
  'Kalau tidak dicentang, foto JPEG dilewati.': 'If unchecked, JPEG photos are skipped.',
  'Salin ke folder': 'Copy to folder',
  'Salin file asli, atau buat JPG baru dengan ukuran yang bisa diatur.':
    'Copy the original files, or create new JPGs at a size you choose.',
  'Kirim ke pilihfotomu': 'Send to pilihfotomu',
  'Upload foto yang dipilih ke galeri booking supaya klien memilih dari foto yang sudah bersih. Butuh internet.':
    'Upload picked photos to the booking gallery so clients choose from a clean set. Needs internet.',
  'Mengekspor…': 'Exporting…',
  'Terbaca otomatis saat import. Foto sudah terlanjur di-import? Pilih semua fotonya lalu klik Metadata › Read Metadata from Files.':
    'Read automatically on import. Already imported? Select all the photos, then choose Metadata › Read Metadata from Files.',
  'Nyalakan Settings › Image › Metadata › Auto Sync Sidecar XMP: Load (atau Full Sync). Label warna jadi Color Tag, bintang jadi Rating. Foto yang sudah ada di katalog: muat ulang metadatanya dari menu Image.':
    'Turn on Settings › Image › Metadata › Auto Sync Sidecar XMP: Load (or Full Sync). Color labels become Color Tags, stars become Rating. Photos already in the catalog: reload their metadata from the Image menu.',
  'Foto Pilih otomatis ber-Tag, bintang terbaca. Label warna dibaca dari namanya (Green / Yellow / Red): samakan nama Color Class di Photo Mechanic supaya warnanya tampil.':
    'Picked photos are Tagged automatically and stars are read. Color labels are matched by name (Green / Yellow / Red): give Photo Mechanic’s Color Classes the same names to see the colors.',
  '{count} file XMP ditulis.': ['{count} XMP file written.', '{count} XMP files written.'],
  '{count} dilewati karena file .xmp sudah ada.': [
    '{count} skipped because an .xmp file already exists.',
    '{count} skipped because their .xmp files already exist.',
  ],
  '{count} JPG disalin dengan label & bintang ke “{folder}”.': [
    '{count} JPG copied with label & stars to “{folder}”.',
    '{count} JPGs copied with labels & stars to “{folder}”.',
  ],
  '{count} foto JPEG-saja dilewati.': ['{count} JPEG-only photo skipped.', '{count} JPEG-only photos skipped.'],

  // copy-flow.tsx
  Tinggi: 'High',
  Sedang: 'Medium',
  Hemat: 'Small',
  'Disalin apa adanya, tanpa diubah. File RAW ikut dengan JPG pasangannya (nama sama).':
    'Copied as they are, unchanged. A RAW file comes along with its matching JPG (same name).',
  'Disalin apa adanya, tanpa diubah.': 'Copied as they are, unchanged.',
  'Foto JPG diperkecil dan dikompres dari JPG aslinya.': 'JPG photos are resized and compressed from the original JPG.',
  'Foto RAW tanpa JPG dibuat dari preview kamera di dalam file RAW — warnanya sama dengan layar kamera, dan 100% = ukuran preview itu (beberapa kamera hanya menyimpan ±1600 px).':
    'RAW photos without a JPG are made from the camera preview inside the RAW — colors match the camera screen, and 100% = that preview’s size (some cameras only store ±1600 px).',
  'Foto RAW dibuat dari preview kamera di dalam file RAW — warnanya sama dengan layar kamera, dan 100% = ukuran preview itu (beberapa kamera hanya menyimpan ±1600 px).':
    'RAW photos are made from the camera preview inside the RAW — colors match the camera screen, and 100% = that preview’s size (some cameras only store ±1600 px).',
  'File asli tidak diubah.': 'Originals are not changed.',
  'Yang disalin': 'What to copy',
  'Salin file asli': 'Copy originals',
  'Buat JPG baru': 'Create new JPGs',
  Ukuran: 'Size',
  'Ukuran dalam persen': 'Size in percent',
  Kualitas: 'Quality',
  'Nama folder': 'Folder name',
  'dibuat di dalam folder sesi': 'created inside the session folder',
  '{count} file disalin.': ['{count} file copied.', '{count} files copied.'],
  '{count} file sudah ada di sana, tidak disalin ulang.': [
    '{count} file was already there, not copied again.',
    '{count} files were already there, not copied again.',
  ],
  '{count} JPG dibuat.': ['{count} JPG created.', '{count} JPGs created.'],
  'Ukuran hasil: {size} px.': 'Output size: {size} px.',
  '{count} JPG sudah ada dengan nama sama, dilewati.': [
    '{count} JPG with the same name already exists, skipped.',
    '{count} JPGs with the same name already exist, skipped.',
  ],
  'Membuat JPG… {done} dari {total}': 'Creating JPGs… {done} of {total}',
  'Salin {count} foto ke folder': ['Copy {count} photo to a folder', 'Copy {count} photos to a folder'],
  'Folder baru dibuat di dalam folder sesi.': 'A new folder is created inside the session folder.',

  // setup.tsx
  '{count} foto': ['{count} photo', '{count} photos'],
  'Belum ada folder dipilih': 'No folder selected yet',
  'Isi folder': 'Folder contents',
  'Centang yang mau dipilah': 'Check the ones to cull',
  'tidak ada foto langsung di sini': 'no photos directly in here',
  'Tiap folder dipilih sendiri, termasuk folder di dalam subfolder. Folder yang tidak dicentang tidak dipilah dan tidak diubah.':
    'Each folder is chosen on its own, including folders inside subfolders. Unchecked folders are not culled and not changed.',
  Subfolder: 'Subfolder',
  Bawaan: 'Default',
  'Atau pilih sendiri supaya lebih tepat:': 'Or choose one for a closer fit:',
  'Bisa diganti nanti di layar Review tanpa analisis ulang.': 'You can change it later in Review without analyzing again.',
  'Longgar: hanya yang jelas blur dibuang. Duplikat tetap di Cek.':
    'Loose: only clearly blurry photos are skipped. Duplicates stay in Check.',
  'Seimbang: foto yang ragu-ragu masuk Cek, bukan langsung dilewati.':
    'Balanced: doubtful photos go to Check instead of being skipped.',
  'Ketat: standar ketajaman lebih tinggi, foto yang dipilih lebih sedikit.':
    'Strict: a higher bar for sharpness, fewer photos picked.',
  'Yang dicek AI': 'What the AI checks',
  'Blur / tidak fokus': 'Blur / missed focus',
  'Diukur di bagian paling tajam, bukan latar bokeh': 'Measured on the sharpest part, not the bokeh background',
  'Mata terpejam': 'Closed eyes',
  'Masuk Cek; dilewati hanya di mode Ketat': 'Goes to Check; skipped only in Strict',
  'Duplikat & burst': 'Duplicates & bursts',
  'Simpan yang terbaik per grup': 'Keep the best of each group',
  Eksposur: 'Exposure',
  'Terlalu gelap atau terlalu terang': 'Too dark or too bright',
  Ekspresi: 'Expression',
  'Di grup burst, yang tersenyum diutamakan · tidak pernah membuang foto': 'In a burst, smiles come first · never skips a photo',
  'Diproses offline di Mac ini. Foto tidak di-upload dan file asli tidak diubah.':
    'Processed offline on this Mac. Photos are not uploaded and originals are not changed.',
  'Diproses offline di komputer ini. Foto tidak di-upload dan file asli tidak diubah.':
    'Processed offline on this computer. Photos are not uploaded and originals are not changed.',
  'Mulai pilih otomatis': 'Start auto culling',
  'Centang minimal satu folder.': 'Check at least one folder.',
  'Nyalakan minimal satu pengecekan.': 'Turn on at least one check.',

  // settings.tsx
  'Lisensi & perangkat': 'License & devices',
  Bahasa: 'Language',
  'Analisis bawaan': 'Analysis defaults',
  'Penyimpanan & cache': 'Storage & cache',
  'Pintasan keyboard': 'Keyboard shortcuts',
  Tentang: 'About',
  'Pindah foto': 'Move between photos',
  'Beri / hapus bintang': 'Set / clear stars',
  'Buka / tutup tampilan besar': 'Open / close large view',
  'Perbesar / perkecil': 'Zoom in / out',
  'Zoom di tampilan besar': 'Zoom in the large view',
  'Geser foto saat di-zoom': 'Pan while zoomed',
  'Pilih foto di Bandingkan': 'Choose a photo in Compare',
  'Grup burst berikutnya': 'Next burst group',
  'Kembali / tutup': 'Back / close',
  'Buka pengaturan': 'Open settings',
  '“{key}” sudah dipakai untuk fungsi tetap. Pilih huruf lain.': '“{key}” is taken by a fixed shortcut. Choose another letter.',
  '{key} dipindah dari “{action}”, yang sekarang memakai {old}.': '{key} moved from “{action}”, which now uses {old}.',
  'Kembalikan bawaan': 'Restore defaults',
  'Klik tombol di kanan, lalu tekan huruf baru. Contoh: Q / W / E untuk Pilih / Cek / Lewati.':
    'Click a key on the right, then press a new letter. For example Q / W / E for Pick / Check / Skip.',
  'Tekan huruf baru': 'Press a new letter',
  'Esc batal': 'Esc to cancel',
  'Klik untuk mengganti': 'Click to change',
  Tetap: 'Fixed',
  'Pilihan awal di layar Atur analisis. Tetap bisa diganti per folder, dan ketat seleksi & jenis pemotretan bisa diganti lagi di layar Review.':
    'The starting choices on the analysis setup screen. You can still change them per folder, and strictness & shoot type can be changed again in Review.',
  'Pratinjau tampilan besar': 'Large-view previews',
  'Dibuat lagi saat foto dibuka': 'Made again when a photo is opened',
  'Gambar kualitas penuh': 'Full-quality pictures',
  'Dibuat lagi saat di-zoom': 'Made again when zooming',
  'Thumbnail yang tidak terpakai': 'Unused thumbnails',
  'Dari sesi yang sudah dihapus atau folder pilihan klien': 'From deleted sessions or client-pick folders',
  'Thumbnail sesi tersimpan': 'Saved session thumbnails',
  'Tetap disimpan: dipakai di grid Review': 'Kept: the Review grid uses them',
  'Cache hanya berisi salinan kecil untuk tampilan. Foto asli, file .xmp, dan folder hasil ekspor tidak pernah ada di sini.':
    'The cache only holds small copies for display. Original photos, .xmp files and export folders are never in here.',
  'Lokasi cache': 'Cache location',
  'Membersihkan…': 'Cleaning…',
  'Bersihkan {size}': 'Clean up {size}',
  '{size} dibebaskan.': '{size} freed.',
  'Lokasi cache mengikuti sistem dan belum bisa dipindah. Untuk melepas semua thumbnail sebuah sesi, hapus sesinya dari Beranda.':
    'The cache location follows the system and can’t be moved yet. To release all of a session’s thumbnails, delete the session from Home.',
  'Ikuti sistem': 'Follow system',
  'Sekarang: {name}': 'Currently: {name}',
  'Menu bar ikut berganti. Keyword yang ditulis ke file .xmp tetap berbahasa Indonesia (pilihfotomu › pilih / cek / lewati), supaya daftar keyword di Lightroom tetap sama di setiap ekspor.':
    'The menu bar follows too. Keywords written to .xmp files stay in Indonesian (pilihfotomu › pilih / cek / lewati), so the Lightroom keyword list stays the same across exports.',
  'Versi pengembangan': 'Development version',
  'Belum perlu aktivasi': 'No activation needed yet',
  'Aktivasi lisensi (1 lisensi = 1 perangkat, update gratis selamanya) dibuat setelah server lisensi di pilihfotomu-api siap. Untuk sekarang semua fitur terbuka.':
    'License activation (1 license = 1 device, free updates forever) comes once the license server in pilihfotomu-api is ready. For now every feature is open.',
  'Versi {version}': 'Version {version}',
  'Semua foto diproses di perangkat ini. Tidak ada foto yang di-upload, dan file asli tidak pernah diubah.':
    'All photos are processed on this device. Nothing is uploaded, and originals are never changed.',
  '{own} di sini · {count} total': '{own} here · {count} total',
} as Record<string, string | [string, string]>;
