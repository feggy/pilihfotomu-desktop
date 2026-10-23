# pilihfotomu Desktop

Aplikasi desktop (macOS + Windows) yang memilah foto sesi secara otomatis —
**Picks / Maybe / Rejects**, lengkap dengan alasannya — dan berjalan
sepenuhnya offline. Foto klien tidak pernah di-upload, file asli tidak pernah
diubah.

| Bagian | Stack |
|--------|-------|
| Inti (`src-tauri/`) | Rust, Tauri 2, `image`, `rayon`, `kamadak-exif` |
| UI (`src/`) | React 19, TypeScript, Tailwind v4, Zustand, TanStack Virtual, lucide |

Desain layar ada di Figma, file **pilihfotomu** halaman **UI** (layar 01–10).
Ikon aplikasi sama dengan web (`pilihfotomu-web/src/app/icon.png`); sumbernya
di `src-tauri/icons/source/` — `icon-macos-1024.png` versi bermargin untuk
`.icns`. Buat ulang dengan `npx tauri icon`.

## Menjalankan (dev)

Butuh Node ≥ 20 dan Rust stable (`rustup`). Di macOS juga Xcode Command Line Tools.

```bash
npm install
npm run tauri dev       # jendela aplikasi + hot reload
```

**Lihat UI tanpa Rust:** jalankan `npm run dev`, lalu buka
<http://localhost:1420/?mock=review> di browser. Sisi Rust dipalsukan dengan
data contoh (`src/dev/mock.ts`); pilihan lain: `home`, `setup`, `picks`,
`compare`. Hanya aktif di dev, tidak ikut build.

```bash
npm run check           # TypeScript
npm run test:rust       # 27 test inti Rust
npm run tauri build     # installer untuk OS yang sedang dipakai
```

Installer Mac harus di-build di Mac, installer Windows di Windows (atau lewat
GitHub Actions `tauri-action`).

## Alur

```
Beranda ─ pilih/seret folder ─▶ Atur analisis ─ Mulai ─▶ Memproses ─▶ Review
                                                                     │  P / U / X, ← →, Space
                                    Loupe (Space) ◀──────────────────┤  ← →, 1–5 bintang, I info
                                    Bandingkan burst ◀─ C ───────────┤
                                    Tempel pilihan klien ◀───────────┤
                                    Ekspor (XMP / salin Picks) ◀─────┘
```

## Cara kerja analisis

1. **Scan** (`scan.rs`) — semua RAW dan JPEG di folder (rekursif). RAW + JPG
   dengan nama sama dipasangkan jadi satu foto. Folder `Picks` dan
   `Pilihan Klien` yang dibuat aplikasi sendiri dilewati. Di layar Atur
   analisis subfolder tingkat pertama bisa dicentang (bawaan: hanya foto di
   folder itu sendiri; kalau folder itu hanya berisi subfolder, semua dicentang kecuali yang namanya mirip ekspor seperti `edited/`, `jpg/`, `post/`).
   Id foto diberikan dari scan lengkap, jadi sama apa pun pilihannya; cache
   thumbnail/preview dinamai dari path + ukuran + waktu ubah file.
2. **Preview** (`preview.rs`) — RAW **tidak di-decode**; diambil JPEG
   preview terbesar yang tertanam di dalamnya (JPEG lossless berisi data
   sensor CR2/DNG diabaikan). Orientasi dan waktu jepret dari EXIF; untuk CR3
   dari kotak `CMT1`/`CMT2`.
3. **Ukur** (`analyze.rs`, di 1024 px) — ketajaman = varians Laplacian per
   petak 6×6, diambil petak terbaik kedua (subjek tajam di latar bokeh tetap
   lolos); eksposur dari rata-rata terang dan piksel terpotong; dHash 64-bit
   untuk kemiripan.
4. **Putuskan** (`cull.rs`) — ambang blur per tingkat Longgar/Seimbang/Ketat;
   foto ≤ 2,5 dtk berselang dan mirip (dHash ≤ 12 bit) jadi satu **grup burst**,
   yang paling tajam disimpan, sisanya Duplikat.
5. **Mata** (`faces.rs`, preview 2048 px) — YuNet mencari wajah, Face Mesh
   memberi 478 titik per wajah; *eye aspect ratio* (celah kelopak ÷ lebar
   mata) < 0,12 di **kedua** mata = terpejam. Wajah utama (≥ 40 % wajah
   terbesar) berkedip → Reject (Maybe di Longgar); hanya tamu → Maybe. Di
   grup burst, frame yang matanya terbuka diutamakan sebelum ketajaman.
   Model: `src-tauri/models/README.md`.
6. **Ekspresi** (`faces.rs::smile`) — skor 0–1 dari bentuk mulut (lebar mulut ÷
   lebar wajah, sudut bibir terangkat, gigi terlihat); ≥ 0,45 = tersenyum.
   Dikalibrasi di sesi Galvin: wajah netral ≤ 0,27, senyum tipis ≥ 0,47.
   Hanya menambah: di grup burst frame yang tersenyum diutamakan (asal
   ketajamannya ≤ 12 poin di bawah yang tertajam), Pick yang semua wajah
   utamanya tersenyum dapat ★5. Tidak pernah membuat foto Maybe/Reject.
7. **Simpan** (`session.rs`) — hasil + koreksi manual di
   `<app data>/sessions/<id>.json`, thumbnail 640 px di
   `<app cache>/thumbs/<id>/`.

## Ekspor ke Lightroom

`export.rs` menulis `IMG_0101.xmp` di samping tiap RAW:

| Status | Label | Rating | Keyword |
|--------|-------|--------|---------|
| Picks | Green | ★★★★ (★★★★★ terbaik di grup) | `pilihfotomu › pick` |
| Maybe | Yellow | ★★★ | `pilihfotomu › maybe › …alasan` |
| Rejects | Red | ★ | `pilihfotomu › reject › blur` |

- **File `.xmp` yang sudah ada tidak ditimpa** (bisa berisi edit Lightroom),
  kecuali dicentang "Timpa".
- Flag Pick/Reject Lightroom tidak bisa dibawa lewat XMP — itu hanya ada di
  katalog. Karena itu dipakai label warna + bintang.
- Foto JPEG-saja dilewati: metadatanya harus ditulis ke dalam file.

## Salin ke folder / jadikan JPG

Dari Ekspor (Picks atau Picks + Maybe) dan dari Tempel pilihan klien:

- **Salin file asli** — disalin apa adanya; RAW ikut dengan JPG pasangannya dan `.xmp`-nya kalau ada.
- **Buat JPG baru** (`export::export_jpegs`) — ukuran 10–100 %, kualitas
  Tinggi/Sedang/Hemat (92/85/75). Piksel diambil dari JPG kamera kalau ada,
  kalau tidak dari preview yang tertanam di RAW: warnanya persis seperti di
  layar kamera, tapi **100 % = ukuran preview itu**, bukan ukuran sensor
  (Canon/Nikon biasanya penuh; beberapa Sony/Fuji hanya ±1600 px). Hasil
  akhir menampilkan rentang ukurannya.
- File dengan nama sama di folder tujuan tidak pernah ditimpa.

## Tempel pilihan klien

Bisa langsung dari Beranda: pilih folder, tempel pesan — **tidak perlu
dipilah dulu**. Folder yang dicari bisa dipilih (misalnya hanya `jpg/` yang
dikirim ke klien), supaya nomor yang sama di RAW dan JPG tidak jadi ambigu. Folder hanya di-scan (nama file); thumbnail dibuat untuk foto
yang tampil saja. Kalau folder itu sesi yang sudah dipilah, thumbnail-nya
dipakai ulang.

`client_picks.rs` mencocokkan **nama file** dulu — lengkap (`Gemini_Generated_Image_25vq….jpg`)
atau sebagian (minimal 6 karakter, maksimal 8 file cocok; lebih dari itu dianggap terlalu
umum) — lalu membaca **nomor foto** dari sisa pesan: `IMG_0101`, `0104`,
`jpg 141`, `110-115`, `110 sampai 115`, `125-28` (= 125–128). Kata, emoji, dan
ekstensi (`.CR3`) diabaikan; nomor ganda dihitung sekali. Hasilnya:
ditemukan, **ambigu** (nomor sama di dua kamera/folder → pilih), dan **tidak
ditemukan** (dengan saran salah ketik satu digit). Rentang > 300 foto
dianggap salah ketik.

## Yang belum ada — sengaja dicatat

- **Ambang mata terpejam belum dikalibrasi** dengan foto kedip sungguhan
  (`EAR_CLOSED` = 0,12 di `faces.rs`). Senyum lebar menurunkan rasio ke ±0,14,
  jadi ambangnya sengaja rendah; foto setengah terpejam belum tertangkap.
- **Jenis pemotretan belum memengaruhi hasil.** Pilihannya sudah ada di
  layar, tapi baru berguna setelah ada deteksi wajah.
- **Ambang ketajaman belum dikalibrasi** dengan sesi sungguhan
  (`VAR_BLURRY`/`VAR_CRISP` di `analyze.rs`, ambang per tingkat di `cull.rs`).
  Uji dengan 1–2 sesi wedding asli sebelum dipakai klien.
- **Grup burst butuh waktu jepret dari EXIF.** File tanpa EXIF tidak pernah
  dikelompokkan.
- **Loupe**: preview 2048 px dulu (label *Pratinjau*). *Muat kualitas penuh* —
  atau zoom melewati resolusi preview — men-decode RAW asli lewat ImageIO
  macOS (`full_res.rs`, ±1 dtk per 24 MP, lalu di-cache di `<cache>/full/`).
  **Belum ada di Windows** (tombolnya tidak tampil). Warna mengikuti
  pengolahan RAW Apple, bisa sedikit beda dari JPEG kamera.
- **Deteksi mata masih dari preview kamera** — Sony A7C hanya menyimpan
  1616 px, jadi wajah kecil sulit dibaca. Karena itu dugaan terpejam hanya
  Maybe (Reject hanya di mode Ketat).
- **JPG hasil ekspor belum membawa EXIF** (tanggal, kamera, lensa).
- **"Jadikan JPG" bukan develop RAW**: tidak ada pengolahan dari data sensor,
  jadi ukurannya terbatas pada preview kamera.
- **Lisensi & aktivasi** (1 lisensi = 1 perangkat, update gratis selamanya)
  belum dibuat — menunggu server lisensi di `pilihfotomu-api`.
- **Kirim ke pilihfotomu** (upload Picks ke galeri booking) tampil sebagai
  *Segera*.
