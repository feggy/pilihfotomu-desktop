/** English for `src/lib` (format, keys, shoot types, folders) and the app shell. */

export default {
  // format.ts
  '{s} dtk': '{s} s',
  '{m} mnt {s} dtk': '{m} min {s} s',
  '{m} mnt': '{m} min',
  Dipilih: 'Picked',
  Pilih: 'Pick',
  Dicek: 'To check',
  Cek: 'Check',
  Dilewati: 'Skipped',
  Lewati: 'Skip',
  Blur: 'Blurry',
  'Kurang tajam': 'Slightly soft',
  'Subjek kurang tajam': 'Subject out of focus',
  'Terlalu gelap': 'Too dark',
  'Terlalu terang': 'Too bright',
  Duplikat: 'Duplicate',
  'Terdeteksi terpejam': 'Eyes closed',
  'Terbaik di grup': 'Best in group',
  'Pose mirip': 'Similar pose',
  'Melebihi batas jumlah': 'Over the limit',
  Tersenyum: 'Smiling',
  Netral: 'Neutral',
  '{n} dari {total} tersenyum': '{n} of {total} smiling',
  'Semua netral': 'All neutral',
  '{n} dari {total} terpejam': '{n} of {total} closed',
  Terbuka: 'Open',
  '{n} wajah terbuka': '{n} faces, all open',
  // folders.ts
  'Folder utama': 'Main folder',
  // keys.ts
  'Tandai Pilih': 'Mark Pick',
  'Tandai Cek': 'Mark Check',
  'Tandai Lewati': 'Mark Skip',
  'Bandingkan grup burst': 'Compare burst group',
  'Zoom / pas layar (tampilan besar)': 'Zoom / fit (large view)',
  'Info foto (tampilan besar)': 'Photo info (large view)',
  'Kotak wajah (tampilan besar)': 'Face boxes (large view)',
  // shoot.ts
  'Semua wajah diperhatikan, termasuk tamu yang berkedip di latar.':
    'Every face counts, including guests blinking in the background.',
  'Mata dan fokus dinilai dari subjek utama. Tamu yang berkedip di latar diabaikan.':
    'Eyes and focus are judged on the main subject. Guests blinking in the background are ignored.',
  'Foto grup: semua orang dihitung, wajah yang kecil di pinggir pun.':
    'Group photos: everyone counts, even small faces at the edge.',
  'Wajah tidak dinilai. Hanya ketajaman, eksposur, dan duplikat.':
    'Faces are not judged. Only sharpness, exposure and duplicates.',
  Wedding: 'Wedding',
  'Akad, resepsi, keluarga': 'Ceremony, reception, family',
  Prewedding: 'Pre-wedding',
  'Pasangan, outdoor': 'Couple, outdoor',
  Lamaran: 'Engagement',
  'Engagement, siraman': 'Engagement, pre-wedding rites',
  Wisuda: 'Graduation',
  'Keluarga, toga': 'Family, gowns',
  Event: 'Event',
  'Seminar, ulang tahun': 'Seminars, birthdays',
  Keluarga: 'Family',
  'Foto keluarga, maternity': 'Family photos, maternity',
  Portrait: 'Portrait',
  'Personal, profil, model': 'Personal, profile, model',
  Lainnya: 'Other',
  'Produk, makanan, tempat': 'Products, food, places',
  Umum: 'General',
  // app.tsx
  Tutup: 'Close',
} as Record<string, string | [string, string]>;
