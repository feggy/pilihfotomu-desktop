# Model AI yang dibundel

Semuanya ditanam ke dalam aplikasi lewat `include_bytes!` di `src/faces.rs`
dan dijalankan dengan tract (ONNX, Rust murni). Jangan ganti file tanpa
memperbarui checksum di sini.

| File | Asal | Lisensi | SHA-256 |
|------|------|---------|---------|
| `face_detection_yunet_2023mar.onnx` | [opencv/face_detection_yunet](https://huggingface.co/opencv/face_detection_yunet) (OpenCV Zoo, Shiqi Yu) | MIT — `LICENSE-yunet.txt` | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `face_blendshapes.onnx` | `face_blendshapes.tflite` dari [face_landmarker.task](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task) resmi MediaPipe (Google), dikonversi dengan `scripts/blendshapes-to-onnx.py` | Apache-2.0 | `cdfba3868cdac1d7258cada325bc18af5e5676a3ddc098b5fbb3445f2cb4da33` |
| `face_recognition_sface_2021dec_f16.onnx` | `face_recognition_sface_2021dec.onnx` dari [opencv/face_recognition_sface](https://huggingface.co/opencv/face_recognition_sface) (OpenCV Zoo), bobot disimpan float16 dengan `scripts/onnx-fp16-weights.py` (38,7 → 19,4 MB; cosinus ke fp32 0,999998) | Apache-2.0 | `b20c4dab3369d661e793880349d4d5fcd67e1af0118f87be9287be2767ecea28` |
| `modnet_f16.onnx` | `onnx/model.onnx` dari [Xenova/modnet](https://huggingface.co/Xenova/modnet) ([MODNet](https://github.com/ZHKKKe/MODNet)), bobot float16 dengan `scripts/onnx-fp16-weights.py` (25,9 → 13,0 MB) | Apache-2.0 | `771f37abf610ed8dacc9358194f48f60426af8855a6d0fcb00bd1a74464b81e1` |
| `u2netp.onnx` | `onnx/model.onnx` dari [BritishWerewolf/U-2-Netp](https://huggingface.co/BritishWerewolf/U-2-Netp) revisi `7112208d` ([U²-Net](https://github.com/xuebinqin/U-2-Net)) | Apache-2.0 | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` |
| `ffdnet-color.onnx` | FFDNet warna dari [KAIR](https://github.com/cszn/KAIR) (Kai Zhang), diekspor ke ONNX untuk pilihfotomu-web (`public/models`) | MIT | `2ccb444b3aefe183f2fbd7be288bfb77b3a22bed66b39783d10d2d34cccb7a1b` |
| `selfie_multiclass.onnx` | `selfie_multiclass_256x256.tflite` (float32, latest) dari [MediaPipe Image Segmenter](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite) (Google, sha256 tflite `c6748b12…e0e0`), dikonversi `tf2onnx 1.16.1 --tflite --opset 13` | Apache-2.0 | `18bd5c5015490b804f1f1054bb52da2ec17f650abc98b915b232ddadb958b056` |
| `deeplab_ade20k.onnx` | `frozen_inference_graph.pb` dari [deeplabv3_mnv2_ade20k_train_2018_12_03.tar.gz](http://download.tensorflow.org/models/deeplabv3_mnv2_ade20k_train_2018_12_03.tar.gz) ([TensorFlow Model Garden DeepLab](https://github.com/tensorflow/models/tree/master/research/deeplab), sha256 tar `9565ccd0…776c`), dikonversi `tf2onnx 1.16.1 --inputs sub_7:0[1,513,513,3] --outputs logits/semantic/BiasAdd:0 --opset 13` | Apache-2.0 | `7674963643563a2a5e6e99e2f210bae0b70e53e26ac9e1d9d9e0b05ad0dcada2` |
| `esrgan_x4v3.onnx` | `realesr-general-x4v3.pth` dari [Real-ESRGAN v0.2.5.0](https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0) (Xintao Wang dkk., sha256 pth `8dc7edb9…6292`), SRVGGNetCompact diekspor `torch.onnx` opset 13 (selisih dengan PyTorch < 1e-5) | BSD-3-Clause | `19780c61e2679c3259abbcf55ef279aff4f9d037d00509bc3b4328a709528820` |
| `depth_anything_v2_small_f16.onnx` | lihat di bawah | Apache-2.0 | `285c12d0e9188bf3d1758a14260a69ace314cdb454de4c1fc9363906d7f76cab` |
| `face_landmarks.onnx` | [fernandotonon/QtMeshEditor-facemesh-onnx](https://huggingface.co/fernandotonon/QtMeshEditor-facemesh-onnx) — konversi ONNX dari MediaPipe Face Mesh V2 (Google) | Apache-2.0 | `d16e5a55e6a480284d468ee32469692464049518c311662ab3956681de31e3e9` |
| `migan_512_places2.onnx` | `migan.onnx` dari [andraniksargsyan/migan](https://huggingface.co/andraniksargsyan/migan) — MI-GAN-512-Places2 resmi [Picsart AI Research](https://github.com/Picsart-AI-Research/MI-GAN) | MIT (kode dan bobot) — `LICENSE-migan.txt` | `593eba0b7e04730f1b61c0a3cbca68d97d8d6a7ff5c6a44a7b9d7fcd880fc5ae` |

`face_landmarks.onnx` adalah konversi pihak ketiga, bukan rilisan resmi
Google. Sebelum dijual, pertimbangkan mengonversi sendiri dari
`face_landmarker.task` resmi (storage.googleapis.com/mediapipe-models) dan
bandingkan hasilnya.

`face_blendshapes.onnx` dicek terhadap MediaPipe Python resmi (Face
Landmarker dengan `output_face_blendshapes`) pada titik wajah yang sama:
selisih terbesar dari 52 skor 0,000004. Input `[1, 146, 2]` = titik Face Mesh
`kLandmarksSubsetIdxs` (lihat `faces::BLEND_POINTS`), output `[52]`;
`faces.rs` memakai eyeBlinkLeft (9) dan eyeBlinkRight (10).

SFace: input `[1, 3, 112, 112]` RGB 0–255, wajah diluruskan ke template
ArcFace dari 5 titik YuNet (`faces::aligned_at`); output 128 angka.
Pengelompokan orang: `faces::assign_people` (cosinus ≥ 0,45 ke rata-rata
orang itu, satu orang tidak pernah dua kali di satu foto). Cek susunan wajah
dengan `cargo run --release --example people_debug -- <out> foto...`.

Hapus latar (`src/cutout.rs`): MODNet untuk orang (sisi pendek 512 px,
kelipatan 32, `(x/255 − 0,5)/0,5`), U²-Netp untuk benda (320 × 320, dibagi
kanal tertinggi lalu mean/std ImageNet, output pertama dinormalkan min–max).
Hasil tract sama dengan onnxruntime (selisih rata-rata mask 0,3 / 255).
Cek: `cargo run --release --example cutout_debug -- <out> potret|objek foto...`.

Cek bentuk input/output dan uji ke foto:
`cargo run --release --example probe_models -- foto1.jpg foto2.jpg`

`ffdnet-color.onnx`: input `image [1, 3, h, w]` RGB 0–1 dan `sigma [1, 1, 1, 1]`
(σ/255), output gambar bersih 0–1. Dijalankan per tile 512 px dengan margin
16 px (`src/denoise.rs`); σ ditaksir dari foto (filter Immerkær di blok rata).

`selfie_multiclass.onnx` (Edit foto › Masking › Orang): input `[1, 256, 256, 3]`
RGB 0–1, kanal terakhir; output `[1, 256, 256, 6]` skor per kelas — latar,
rambut, kulit badan, kulit wajah, pakaian, lainnya (aksesori). `cutout.rs`
menjadikannya bagian (softmax) per piksel. Dijalankan pada potongan persegi di
sekitar tiap orang (kepala, lalu badan), bukan seluruh foto. Dipilih karena
BiSeNet face-parsing dilatih dengan CelebAMask-HQ yang hanya untuk riset
non-komersial.

`deeplab_ade20k.onnx` (Edit foto › Masking › Langit): grafik dipotong setelah
pra-proses DeepLab sendiri, jadi input `[1, 513, 513, 3]` RGB −1…1 (kanal
terakhir) dan output skor `[1, 129, 129, 151]` kelas ADE20K (0 = lainnya, 3 =
langit). `cutout.rs` mengembalikan bagian langit (softmax) per titik; tepinya
dirapikan di `smart-masks.ts`.

`esrgan_x4v3.onnx` (Edit foto › Ekspor › Super Resolution): input `image
[1, 3, h, w]` RGB 0–1, output `[1, 3, 4h, 4w]`. `superres.rs` menjalankannya
per tile 128 px lalu merata-rata tiap 2 × 2, jadi hasilnya 2× lebar dan tinggi.

`depth_anything_v2_small_f16.onnx` (Edit foto › Lens Blur): `onnx/model.onnx`
dari [onnx-community/depth-anything-v2-small](https://huggingface.co/onnx-community/depth-anything-v2-small)
revisi `4472b736` (Depth Anything V2 Small, Lihe Yang dkk., Apache-2.0; sha256
asli `afb6a5c2…c10c`). `value_info` dihapus dan batch ditetapkan 1 (tract tak
bisa menyatukan `batch_size` simbolik), lalu bobot disimpan float16 dengan
`scripts/onnx-fp16-weights.py`. Input `[1, 3, h, w]` (sisi kelipatan 14, sisi
panjang 518) dinormalisasi ImageNet; output kedalaman relatif `[1, h, w]`.
Versi Base/Large tidak dipakai: lisensinya CC-BY-NC.

`migan_512_places2.onnx` (Edit foto › Hapus objek, `src/inpaint_ai.rs`):
input `image [1, 3, 512, 512]` RGB uint8 dan `mask [1, 1, 512, 512]` uint8
(255 = dipertahankan, 0 = diisi), output `[1, 3, 512, 512]` RGB uint8. Bukan
`migan_pipeline_v2.onnx` dari repo yang sama: pra-prosesnya (NonZero, potong
otomatis) tidak bisa diketik tract. `heal.tsx` memotong area di sekitar tanda
(sekitar 2,4 × ukurannya) ke 512, lalu memadukan hasilnya kembali; PatchMatch
tetap dipakai sementara dan bila model gagal. Sekitar 0,8 detik per bagian di
CPU (M-series, profil optimized).
