/**
 * Ketentuan Penggunaan and Kebijakan Privasi, shown in Pengaturan › Dokumen
 * hukum and agreed to on first launch. Written per language (not through
 * `t()`): legal text is read as a whole, not phrase by phrase.
 *
 * Before release: fill DEVELOPER and CONTACT, and have a lawyer read both
 * documents. Raising TERMS_VERSION asks everyone to agree again.
 */

/** Who grants the licence: a person's full name or the company. */
export const DEVELOPER = '[NAMA PENGEMBANG]';
/** Where support and privacy questions go. */
export const CONTACT = '[EMAIL KONTAK]';
export const TERMS_VERSION = 1;
export const TERMS_DATE = { id: '25 Oktober 2026', en: '25 October 2026' };

export interface LegalDoc {
  title: string;
  sections: { heading: string; body: string[] }[];
}

export const TERMS: Record<'id' | 'en', LegalDoc> = {
  id: {
    title: 'Ketentuan Penggunaan',
    sections: [
      {
        heading: '1. Tentang perjanjian ini',
        body: [
          `Ketentuan ini adalah perjanjian antara Anda dan ${DEVELOPER} (“kami”) tentang penggunaan aplikasi desktop pilihfotomu. Dengan memasang atau memakai aplikasi, Anda menyetujui ketentuan ini. Jika tidak setuju, jangan gunakan aplikasi.`,
        ],
      },
      {
        heading: '2. Apa itu pilihfotomu',
        body: [
          'pilihfotomu membantu fotografer memilah dan mengolah foto: menilai ketajaman, eksposur, duplikat, mata dan ekspresi; mengelompokkan orang dalam satu sesi; memberi status Pilih / Cek / Lewati beserta alasannya; mengekspor penanda untuk Lightroom, Capture One dan Photo Mechanic; serta membuat konten dari template.',
          'Semua pengolahan berjalan di perangkat Anda. Aplikasi tidak meng-upload foto.',
        ],
      },
      {
        heading: '3. Penilaian AI bisa keliru',
        body: [
          'Status, alasan, bintang, deteksi mata terpejam, ketajaman wajah dan pengelompokan orang adalah saran otomatis, bukan keputusan akhir. Hasilnya tidak selalu benar. Contohnya: mata sipit atau tersenyum dibaca terpejam, fokus yang disengaja dianggap meleset, atau dua orang yang mirip dianggap satu orang.',
          'Periksa kembali hasilnya sebelum foto diserahkan, dihapus, atau dilewati. Keputusan akhir atas foto yang Anda pilih, serahkan kepada klien, atau lewati sepenuhnya menjadi tanggung jawab Anda.',
        ],
      },
      {
        heading: '4. Lisensi',
        body: [
          'Kami memberi Anda lisensi non-eksklusif yang tidak dapat dialihkan untuk memasang dan memakai aplikasi di perangkat yang Anda miliki atau kuasai, sesuai paket lisensi yang Anda dapatkan.',
          'Anda tidak boleh menjual ulang, menyewakan, atau mendistribusikan aplikasi; membongkar atau merekayasa balik aplikasi, kecuali sejauh diizinkan hukum; menghapus pemberitahuan hak cipta; atau memakai model AI yang dibundel di luar lisensinya masing-masing.',
        ],
      },
      {
        heading: '5. File asli dan cadangan',
        body: [
          'Aplikasi tidak mengubah atau menghapus file foto asli. Aplikasi menulis file pendamping (XMP), salinan, dan folder ekspor di tempat yang Anda pilih.',
          'Buat cadangan foto Anda. Kami tidak bertanggung jawab atas kehilangan data akibat kerusakan perangkat, drive, atau cara pemakaian.',
        ],
      },
      {
        heading: '6. Foto dan data klien Anda',
        body: [
          'Foto, termasuk wajah dan data pribadi klien di dalamnya, tetap milik dan tanggung jawab Anda. Anda bertanggung jawab memiliki hak dan izin untuk mengolahnya, sesuai Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi dan perjanjian Anda dengan klien.',
        ],
      },
      {
        heading: '7. Tanpa jaminan',
        body: [
          'Aplikasi disediakan “sebagaimana adanya”. Sejauh diizinkan hukum, kami tidak menjamin aplikasi bebas galat, selalu tersedia, cocok untuk keperluan tertentu, atau bahwa hasil AI-nya akurat.',
        ],
      },
      {
        heading: '8. Batas tanggung jawab',
        body: [
          'Sejauh diizinkan hukum, kami tidak bertanggung jawab atas kerugian tidak langsung, termasuk kehilangan pendapatan, klien, data, atau reputasi, yang timbul dari pemakaian aplikasi atau hasil penilaiannya. Jumlah tanggung jawab kami paling banyak sebesar biaya lisensi yang Anda bayar dalam 12 bulan terakhir.',
        ],
      },
      {
        heading: '9. Komponen pihak ketiga',
        body: [
          'Aplikasi memuat model AI dan pustaka pihak ketiga dengan lisensinya masing-masing (Apache-2.0, MIT, dan lainnya). Daftarnya ada di Pemberitahuan pihak ketiga.',
        ],
      },
      {
        heading: '10. Perubahan dan pengakhiran',
        body: [
          'Kami dapat mengubah ketentuan ini di versi aplikasi berikutnya. Perubahan penting akan ditampilkan di aplikasi untuk disetujui kembali.',
          'Lisensi berakhir bila Anda melanggar ketentuan ini. Setelah itu, hentikan pemakaian dan hapus aplikasi.',
        ],
      },
      {
        heading: '11. Hukum yang berlaku',
        body: [
          'Ketentuan ini tunduk pada hukum Republik Indonesia. Sengketa diselesaikan lebih dulu secara musyawarah, dan bila tidak tercapai, melalui pengadilan yang berwenang di Indonesia.',
        ],
      },
      {
        heading: '12. Kontak',
        body: [`Pertanyaan tentang ketentuan ini: ${CONTACT}.`],
      },
    ],
  },
  en: {
    title: 'Terms of Use',
    sections: [
      {
        heading: '1. About this agreement',
        body: [
          `These terms are an agreement between you and ${DEVELOPER} (“we”) about using the pilihfotomu desktop app. By installing or using the app you agree to them. If you don’t agree, don’t use the app.`,
        ],
      },
      {
        heading: '2. What pilihfotomu is',
        body: [
          'pilihfotomu helps photographers sort and work with photos. It judges sharpness, exposure, duplicates, eyes and expressions, and groups the people in a session. It gives each photo a Pick, Check or Skip status with reasons, exports marks for Lightroom, Capture One and Photo Mechanic, and makes content from templates.',
          'All processing runs on your device. The app doesn’t upload photos.',
        ],
      },
      {
        heading: '3. The AI can be wrong',
        body: [
          'Statuses, reasons, stars, closed-eye detection, face sharpness and people grouping are automatic suggestions, not final decisions. They are not always right: narrow or smiling eyes can read as closed, intentional focus can read as missed, and two similar people can be taken for one.',
          'Check the results before photos are delivered, deleted or skipped. The final decision on the photos you pick, deliver to clients or skip is entirely yours.',
        ],
      },
      {
        heading: '4. Licence',
        body: [
          'We grant you a non-exclusive, non-transferable licence to install and use the app on devices you own or control, according to the licence plan you obtained.',
          'You may not resell, rent or redistribute the app. You may not decompile or reverse engineer it, except as far as the law allows, or remove copyright notices. You may not use the bundled AI models outside their own licences.',
        ],
      },
      {
        heading: '5. Original files and backups',
        body: [
          'The app never changes or deletes your original photo files. It writes sidecar files (XMP), copies and export folders where you choose.',
          'Keep backups of your photos. We are not responsible for data loss caused by device or drive failure, or by how the app is used.',
        ],
      },
      {
        heading: '6. Your photos and your clients’ data',
        body: [
          'Photos, including the faces and personal data of clients in them, remain yours and your responsibility. You are responsible for having the rights and consent to process them under Indonesian Law No. 27 of 2022 on Personal Data Protection and your agreements with clients.',
        ],
      },
      {
        heading: '7. No warranty',
        body: [
          'The app is provided “as is”. As far as the law allows, we don’t guarantee that it is error-free, always available, fit for a particular purpose, or that its AI results are accurate.',
        ],
      },
      {
        heading: '8. Limitation of liability',
        body: [
          'As far as the law allows, we are not liable for indirect losses from using the app or its judgements, including lost income, clients, data or reputation. Our total liability is limited to the licence fees you paid in the last 12 months.',
        ],
      },
      {
        heading: '9. Third-party components',
        body: [
          'The app includes third-party AI models and libraries under their own licences (Apache-2.0, MIT and others). They are listed under Third-party notices.',
        ],
      },
      {
        heading: '10. Changes and termination',
        body: [
          'We may change these terms in a later version of the app. Important changes will be shown in the app for you to agree to again.',
          'The licence ends if you break these terms. When it ends, stop using the app and delete it.',
        ],
      },
      {
        heading: '11. Governing law',
        body: [
          'These terms are governed by the laws of the Republic of Indonesia. Disputes are first settled by discussion; failing that, by the competent courts of Indonesia.',
        ],
      },
      {
        heading: '12. Contact',
        body: [`Questions about these terms: ${CONTACT}.`],
      },
    ],
  },
};

export const PRIVACY: Record<'id' | 'en', LegalDoc> = {
  id: {
    title: 'Kebijakan Privasi',
    sections: [
      {
        heading: '1. Ringkasnya',
        body: [
          'pilihfotomu bekerja offline. Tidak ada akun, tidak ada analitik atau pelacakan, dan foto maupun data Anda tidak dikirim ke server kami atau pihak lain.',
        ],
      },
      {
        heading: '2. Data yang diolah di perangkat Anda',
        body: [
          'Aplikasi membaca foto di folder yang Anda pilih. Dari foto itu aplikasi menyimpan hasil analisis: ketajaman, eksposur, posisi wajah, skor mata dan senyum, dan nomor kelompok orang. Aplikasi juga menyimpan status dan bintang yang Anda beri, thumbnail, pengaturan, draf Buat konten, dan potongan foto hasil Hapus latar.',
          'Semua data itu disimpan di folder data dan cache aplikasi di perangkat ini. Lokasinya terlihat di Pengaturan › Penyimpanan & cache.',
        ],
      },
      {
        heading: '3. Data wajah',
        body: [
          'Aplikasi mendeteksi wajah untuk menilai mata dan fokus, dan mengelompokkan wajah yang mirip agar setiap orang dinilai terhadap dirinya sendiri dan bisa disaring.',
          'Vektor pengenal wajah hanya dipakai selama analisis dan tidak disimpan. Yang disimpan hanya posisi wajah dan nomor kelompok, misalnya “Orang 1”. Wajah tidak pernah dicocokkan dengan identitas nyata atau dengan basis data di luar perangkat.',
          'Data wajah termasuk data pribadi yang bersifat spesifik menurut UU No. 27 Tahun 2022. Untuk foto klien, Anda adalah pengendali datanya dan bertanggung jawab atas dasar pemrosesannya, misalnya persetujuan dalam kontrak pemotretan.',
        ],
      },
      {
        heading: '4. Yang keluar dari perangkat',
        body: [
          'Tidak ada data yang keluar dari perangkat, kecuali karena tindakan Anda sendiri, misalnya menyalin ringkasan sesi untuk ditempel ke chat atau mengekspor foto ke folder yang Anda pilih.',
          'Jika versi berikutnya membutuhkan koneksi internet, misalnya untuk aktivasi lisensi atau pembaruan, kebijakan ini akan diperbarui lebih dulu.',
        ],
      },
      {
        heading: '5. Menghapus data',
        body: [
          'Hapus sesi dari Beranda untuk menghapus hasil analisis dan thumbnail-nya. Kosongkan cache di Pengaturan › Penyimpanan & cache. Menghapus aplikasi menghapus aplikasinya; folder data aplikasi bisa Anda hapus sendiri. File foto asli tidak pernah dihapus oleh aplikasi.',
        ],
      },
      {
        heading: '6. Foto anak-anak',
        body: [
          'Foto bisa memuat anak-anak. Datanya diperlakukan sama: tetap di perangkat. Pastikan Anda memiliki izin orang tua atau wali sesuai hukum yang berlaku.',
        ],
      },
      {
        heading: '7. Perubahan dan kontak',
        body: [
          'Perubahan kebijakan ini akan ditampilkan di aplikasi.',
          `Pertanyaan atau permintaan tentang privasi: ${CONTACT}.`,
        ],
      },
    ],
  },
  en: {
    title: 'Privacy Policy',
    sections: [
      {
        heading: '1. In short',
        body: [
          'pilihfotomu works offline. There is no account, no analytics or tracking, and your photos and data are not sent to our servers or anyone else’s.',
        ],
      },
      {
        heading: '2. Data processed on your device',
        body: [
          'The app reads the photos in the folders you choose. From them it keeps analysis results: sharpness, exposure, face positions, eye and smile scores, and person group numbers. It also keeps the statuses and stars you set, thumbnails, settings, Create content drafts and the cut-outs made with Remove background.',
          'All of this stays in the app’s data and cache folders on this device. You can see where under Settings › Storage & cache.',
        ],
      },
      {
        heading: '3. Face data',
        body: [
          'The app detects faces to judge eyes and focus, and groups similar faces so each person is judged against themselves and can be filtered.',
          'Face recognition vectors are used only during analysis and are not stored. Only face positions and group numbers, such as “Person 1”, are kept. Faces are never matched to real identities or to any database off the device.',
          'Face data is specific (sensitive) personal data under Indonesian Law No. 27 of 2022. For client photos you are the data controller and responsible for the legal basis, such as consent in your shoot contract.',
        ],
      },
      {
        heading: '4. What leaves the device',
        body: [
          'No data leaves the device, except through your own actions, such as copying a session summary to paste into a chat or exporting photos to a folder you choose.',
          'If a later version needs an internet connection, for example for licence activation or updates, this policy will be updated first.',
        ],
      },
      {
        heading: '5. Deleting data',
        body: [
          'Delete a session from Home to remove its analysis and thumbnails. Clear the cache under Settings › Storage & cache. Uninstalling removes the app; you can delete its data folder yourself. The app never deletes original photo files.',
        ],
      },
      {
        heading: '6. Photos of children',
        body: [
          'Photos may show children. Their data is treated the same way and stays on the device. Make sure you have parental or guardian consent as the law requires.',
        ],
      },
      {
        heading: '7. Changes and contact',
        body: ['Changes to this policy will be shown in the app.', `Privacy questions or requests: ${CONTACT}.`],
      },
    ],
  },
};
