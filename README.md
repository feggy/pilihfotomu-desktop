# pilihfotomu Desktop

Aplikasi desktop (macOS + Windows) yang memilah foto sesi secara otomatis —
**Pilih / Cek / Lewati**, lengkap dengan alasannya — dan berjalan
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
npm run test:rust       # 35 test inti Rust
npm run tauri build     # installer untuk OS yang sedang dipakai
```

Installer Mac harus di-build di Mac, installer Windows di Windows (atau lewat
GitHub Actions `tauri-action`).

## Buat konten (`src/kreasi/`)

Story / feed / carousel Instagram dari template, offline:
**Pilih template → Isi foto → Edit & ekspor** (Beranda › Buat konten, atau
Review › Lanjutkan ▾ › Buat konten untuk memakai foto sesi yang terbuka).

- **Mesin** (`src/kreasi/engine/`) disalin dari `pilihfotomu-web/src/features/collage`
  apa adanya, kecuali bagian yang khusus web: `fonts.ts` (font dibundel, lihat
  bawah), `types.ts` (`DriveFile` lokal), draf cloud dan kuota ekspor dibuang.
  Perbaikan mesin sebaiknya dibuat di web lalu disalin ulang ke sini.
- **Template**: 354 template komunitas dari `pilihfotomu-api/prisma/seed-data/community-templates.json`
  di `public/kreasi/templates.json`. Pratinjau digambar mesin dengan foto pengganti.
- **Offline penuh**: template, font, dan stiker ikut di dalam app (folder `dist`
  ditanam Tauri). Template tidak berisi URL; stiker digambar dari kode.
- **Font**: 97 keluarga Google Fonts (OFL), subset latin, di `public/fonts/` +
  `src/kreasi/fonts.css` — rentang berat penuh untuk font variabel, dan setiap
  berat/miring yang dipakai template ada persis. Buat ulang dengan
  `node scripts/fetch-fonts.mjs` (membaca `pilihfotomu-web` untuk daftar berat).
- **Isi foto**: dari sesi yang terbuka (Dipilih / Bintang 5 / Semua), atau
  **Pilih foto** satu per satu (RAW/JPG, boleh dari beberapa folder — `open_files`;
  hasil ekspor ke folder foto pertama), atau satu folder. "Hanya yang pas untuk slot" memakai bentuk foto (diukur dari
  thumbnail); foto diletakkan supaya wajah dari analisis ada di tengah tempatnya.
  "Isi sisanya otomatis": Dipilih, bintang tertinggi, bentuk pas, tidak dua dari satu burst.
- **Ekspor**: JPG/PNG 1080 px atau 2×, foto dari pratinjau 2048 px, disimpan ke
  `<folder sesi>/Konten/` lewat `save_export` (byte mentah, tidak pernah menimpa).
- **Mulai dari kosong**: kanvas Story / Feed / 1:1 / Carousel tanpa template
  (layout bebas mesin). Langsung ke editor; foto ditambah dari panel **Foto**
  (klik, atau seret ke kanvas) sebagai bingkai yang bisa dipindah, diubah ukuran,
  diputar, dan dipotong jadi lingkaran / lengkung / hati.
- **Template saya**: editor › Simpan template menyimpan desain tanpa fotonya
  (tempat foto dan bentuknya tetap) ke `<app data>/kreasi/templates/` —
  muncul di galeri sebagai kategori Template saya, bisa dihapus dari panel kanan.
- **Draf**: setiap desain tersimpan otomatis ke `<app data>/kreasi/<id>.json`;
  muncul di galeri sebagai Lanjutkan desain.
- **Buat sekaligus**: galeri › Buat sekaligus, centang beberapa template, lalu
  semuanya diisi foto sesi (foto Pilih dulu, berbeda di tiap desain, bentuk
  yang pas) dan data klien, diekspor ke satu folder, dan disimpan sebagai draf
  (`src/kreasi/batch.tsx`).
- **Template bawaan**: `public/kreasi/templates.json`. Template komunitas plus
  yang dibuat `scripts/make-templates.py` (id `g…`: prewedding, lamaran, bayi &
  maternity, aqiqah & khitan, ulang tahun anak, keluarga). Jalankan ulang
  script itu setelah mengubah layout atau tema; template komunitas tidak
  disentuh.

## Bahasa

Indonesia dan Inggris (Pengaturan › Bahasa; bawaan ikut bahasa sistem —
Indonesia kalau bahasa pertama sistem Indonesia, selain itu Inggris).
Teks Indonesia adalah kuncinya: `t('…')` dari `src/lib/i18n.ts`, terjemahan
Inggris di `src/locales/en/*.ts`; yang belum diterjemahkan tampil dalam bahasa
Indonesia. Pesan dari Rust diterjemahkan di UI lewat `tRust`
(`locales/en/errors.ts`), menu bar dibangun ulang lewat `set_language`.
Keyword XMP tetap Indonesia supaya daftar keyword Lightroom tidak terpecah.

## Alur

```
Beranda ─ pilih/seret folder ─▶ Atur analisis ─ Mulai ─▶ Memproses ─▶ Review
                                                                     │  P / U / X (bisa diubah), ← →, Space
                                                                     │  ⌘/Shift-klik pilih banyak · ⌘A · ⌘Z / ⇧⌘Z
                                                                     │  Atur penilaian (ketat/jenis) tanpa scan ulang
                                    Ringkasan sesi ◀─────────────────┤  (otomatis setelah analisis)
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
   yang paling tajam disimpan, sisanya Duplikat. File **tanpa waktu jepret**
   dikelompokkan dari nomor frame berurutan (selisih ≤ 2, folder + awalan
   sama) dan dHash ≤ 8 bit. **Pose mirip**: foto yang tersisa (tunggal atau
   terbaik di burst) ≤ 90 dtk berselang dan dHash ≤ 6 bit ditandai
   `Pose mirip`; hanya Ketat yang memindahkannya ke Cek.
   **Jenis pemotretan** (`cull::profile`): Umum = semua wajah dihitung;
   Wedding/Prewedding/Lamaran/Event/Portrait = kedipan tamu di latar
   diabaikan; Wisuda/Keluarga = wajah ≥ 15 % wajah terbesar ikut subjek utama
   (bukan 40 %); Lainnya = wajah tidak dinilai.
   **Atur ulang di Review** (`Session::recull`) — ketat seleksi dan jenis
   pemotretan bisa diganti setelah analisis; diputuskan ulang dari angka
   yang tersimpan (< 1 ms untuk 242 foto), foto yang diubah manual
   (`manual`) tidak ikut berubah.
   **Pilih N terbaik** (`cull::keep_best`, `Options::limit`) — hanya N Pick
   yang tetap Pick, sisanya ke Cek dengan alasan `Melebihi batas jumlah`.
   Jatah dibagi per **momen** (jeda jepret > 15 menit = momen baru)
   sebanding jumlah Pick-nya, minimal 1 per momen selama jatah cukup. Di
   dalam momen: ★5 (terbaik di burst / tersenyum), bukan pose mirip, jumlah
   subjek utama tersenyum, ketajaman. Pick manual ikut dihitung dari N.
5. **Mata** (`faces.rs`, preview 2048 px) — YuNet mencari wajah (skor ≥ 0,7; di bawahnya separuh adalah tangan, kain atau bayangan; di bawah 0,8 dibuang juga bila Face Mesh menilai bukan wajah), Face Mesh
   memberi 478 titik per wajah, lalu model **Face Blendshapes** MediaPipe
   memberi skor kedip 0–1 per mata. Model itu dilatih Google dari banyak
   orang, jadi mata sipit, tersenyum dan menunduk tidak dianggap berkedip
   (bukan batas yang disetel dari satu sesi). Kedua mata ≥ 0,55 = terpejam,
   kecuali kelopaknya masih terbuka lebar (EAR rata-rata ≥ 0,2: kacamata
   memantul, wajah kecil, wajah menyamping tertipu model);
   kelopak yang hampir rapat (*eye aspect ratio* < 0,05 dan < 0,03) juga,
   dan hanya itu yang dipakai untuk sesi lama tanpa skor kedip.
   **Orang** (`faces::assign_people`, model SFace): wajah ≥ 50 px dikelompokkan
   per orang dalam sesi. Orang yang muncul ≥ 4 kali dinilai terhadap dirinya
   sendiri: terpejam bila skor kedip ≥ skor biasanya + 0,3 (0,45–0,8), dan
   ketajaman wajahnya dibandingkan dengan wajahnya sendiri di foto lain.
   Review › Saring: orang › **Kelola orang** membetulkan pengelompokan: beri
   nama, gabungkan dua orang yang sama, pisahkan atau pindahkan wajah yang
   salah (`name_person`, `merge_people`, `move_faces`); ambang tiap orang
   dihitung ulang dan foto dinilai ulang. Nama hilang bila wajah dibaca ulang.
   Sesi lama: tombol **Baca ulang wajah** di Review (`reread_faces`). Wajah utama (≥ 40 % wajah
   terbesar) berkedip → Reject (Maybe di Longgar); hanya tamu → Maybe. Di
   grup burst, frame yang matanya terbuka diutamakan sebelum ketajaman.
   Model: `src-tauri/models/README.md`.
6. **Ekspresi** (`faces.rs::smile`) — skor 0–1 dari bentuk mulut (lebar mulut ÷
   lebar wajah, sudut bibir terangkat, gigi terlihat); ≥ 0,45 = tersenyum.
   Dikalibrasi di sesi Galvin: wajah netral ≤ 0,27, senyum tipis ≥ 0,47.
   Hanya menambah: di grup burst frame yang tersenyum diutamakan (asal
   ketajamannya ≤ 12 poin di bawah yang tertajam), Pick yang semua wajah
   utamanya tersenyum dapat ★5. Tidak pernah membuat foto Maybe/Reject.
7. **Subjek kurang tajam** (`analyze::face_variance`) — ketajaman bagian
   tengah wajah utama. Nilai mutlaknya tidak bisa membedakan wajah blur dari
   kulit halus/menunduk (diuji di sesi Galvin), jadi dipakai **relatif**: di
   grup burst foto terbaik dipilih dari wajah tertajam, dan frame yang
   wajahnya < 35 % wajah tertajam ditandai. Di luar burst, wajah utama
   tertajam di foto dibandingkan dengan **sesi itu sendiri**: < 35 % dari
   median sesi (min. 6 foto berwajah) = ditandai, jadi kamera, lensa dan
   cahaya tiap sesi menentukan tingkatnya. Karena bisa disengaja (fokus ke
   cincin), Longgar/Seimbang hanya memindahkan ke Cek; Ketat ke Lewati.
   Wajah ≥ 150 px yang sangat lembut tetap ditandai sendiri.
8. **Simpan** (`session.rs`) — hasil + koreksi manual di
   `<app data>/sessions/<id>.json`, thumbnail 640 px di
   `<app cache>/thumbs/<id>/`.

## Ekspor ke Lightroom, Capture One, Photo Mechanic

`export.rs` menulis `IMG_0101.xmp` di samping tiap RAW — satu file yang
dibaca ketiganya (Photo Mechanic juga membaca `photomechanic:Tagged`, = Pilih):

| Status | Label | Rating | Keyword |
|--------|-------|--------|---------|
| Pilih | Green | ★★★★ (★★★★★ terbaik di grup / semua tersenyum) | `pilihfotomu › pilih` |
| Cek | Yellow | ★★★ | `pilihfotomu › cek › …alasan` |
| Lewati | Red | ★ | `pilihfotomu › lewati › blur` |

- **File `.xmp` yang sudah ada tidak ditimpa** (bisa berisi edit Lightroom),
  kecuali dicentang "Timpa".
- Flag Pick/Reject Lightroom tidak bisa dibawa lewat XMP — itu hanya ada di
  katalog. Karena itu dipakai label warna + bintang.
- Foto JPEG-saja tidak bisa diberi sidecar (aplikasi membacanya dari dalam
  file). Opsi bawaan: disalin ke `JPG bertanda/` dengan XMP tertanam; ekspor
  ulang memperbarui salinan buatan aplikasi, file lain bernama sama tidak
  pernah ditimpa. Folder ini dilewati saat scan.

## Salin ke folder / jadikan JPG

Dari Ekspor (Picks atau Picks + Maybe) dan dari Tempel pilihan klien:

- **Salin file asli** — disalin apa adanya; RAW ikut dengan JPG pasangannya dan `.xmp`-nya kalau ada.
- **Buat JPG baru** (`export::export_jpegs`) — ukuran 10–100 %, kualitas
  Tinggi/Sedang/Hemat (92/85/75). Piksel diambil dari JPG kamera kalau ada,
  kalau tidak dari preview yang tertanam di RAW: warnanya persis seperti di
  layar kamera, tapi **100 % = ukuran preview itu**, bukan ukuran sensor
  (Canon/Nikon biasanya penuh; beberapa Sony/Fuji hanya ±1600 px). Hasil
  akhir menampilkan rentang ukurannya.
- JPG baru membawa EXIF asli (tanggal, kamera, lensa, eksposur; dari RAW
  kalau JPG kamera tidak punya), orientasi di-set 1 karena piksel sudah tegak.
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

- **Skor kedip (`BLINK_CLOSED` = 0,55), batas subjek lembut (35 %) dan
  pengelompokan orang (0,45) baru diuji di 20 foto buatan Gemini** (wajah
  terbuka ≤ 0,52, terpejam 0,56–0,84; orang di foto Gemini tidak konsisten
  antarfoto). Uji di sesi kamera asli.
- **Ambang pose mirip (90 dtk, dHash ≤ 6) dan burst tanpa EXIF belum
  dikalibrasi** dengan sesi sungguhan.
- **Ambang ketajaman belum dikalibrasi** dengan sesi sungguhan
  (`VAR_BLURRY`/`VAR_CRISP` di `analyze.rs`, ambang per tingkat di `cull.rs`).
  Uji dengan 1–2 sesi wedding asli sebelum dipakai klien.
- **Loupe**: preview 2048 px dulu (label *Pratinjau*). *Muat kualitas penuh* —
  atau zoom melewati resolusi preview — men-decode RAW asli lewat ImageIO
  macOS (`full_res.rs`, ±1 dtk per 24 MP, lalu di-cache di `<cache>/full/`).
  Di Windows lewat WIC + “Raw Image Extension” dari Microsoft Store (tanpa
  itu muncul pesan cara memasangnya). **Kode Windows baru lolos cek kompilasi,
  belum dicoba di mesin Windows.** Warna mengikuti pengolahan RAW sistem,
  bisa sedikit beda dari JPEG kamera.
- **Deteksi mata masih dari preview kamera** — Sony A7C hanya menyimpan
  1616 px, jadi wajah kecil sulit dibaca. Karena itu dugaan terpejam hanya
  Maybe (Reject hanya di mode Ketat).
- **"Jadikan JPG" bukan develop RAW**: tidak ada pengolahan dari data sensor,
  jadi ukurannya terbatas pada preview kamera.
- **Lisensi & aktivasi** (1 lisensi = 1 perangkat, update gratis selamanya)
  belum dibuat — menunggu server lisensi di `pilihfotomu-api`.
- **Kirim ke pilihfotomu** (upload Picks ke galeri booking) tampil sebagai
  *Segera* — butuh server/bucket.
- **Lokasi cache belum bisa dipindah** (Pengaturan › Penyimpanan hanya
  menampilkan dan membersihkan pratinjau, kualitas penuh, dan thumbnail yang
  tidak terpakai).
