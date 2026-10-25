# Model AI yang dibundel

Keempatnya ditanam ke dalam aplikasi lewat `include_bytes!` di `src/faces.rs`
dan dijalankan dengan tract (ONNX, Rust murni). Jangan ganti file tanpa
memperbarui checksum di sini.

| File | Asal | Lisensi | SHA-256 |
|------|------|---------|---------|
| `face_detection_yunet_2023mar.onnx` | [opencv/face_detection_yunet](https://huggingface.co/opencv/face_detection_yunet) (OpenCV Zoo, Shiqi Yu) | MIT — `LICENSE-yunet.txt` | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `face_blendshapes.onnx` | `face_blendshapes.tflite` dari [face_landmarker.task](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task) resmi MediaPipe (Google), dikonversi dengan `scripts/blendshapes-to-onnx.py` | Apache-2.0 | `cdfba3868cdac1d7258cada325bc18af5e5676a3ddc098b5fbb3445f2cb4da33` |
| `face_recognition_sface_2021dec_f16.onnx` | `face_recognition_sface_2021dec.onnx` dari [opencv/face_recognition_sface](https://huggingface.co/opencv/face_recognition_sface) (OpenCV Zoo), bobot disimpan float16 dengan `scripts/onnx-fp16-weights.py` (38,7 → 19,4 MB; cosinus ke fp32 0,999998) | Apache-2.0 | `b20c4dab3369d661e793880349d4d5fcd67e1af0118f87be9287be2767ecea28` |
| `face_landmarks.onnx` | [fernandotonon/QtMeshEditor-facemesh-onnx](https://huggingface.co/fernandotonon/QtMeshEditor-facemesh-onnx) — konversi ONNX dari MediaPipe Face Mesh V2 (Google) | Apache-2.0 | `d16e5a55e6a480284d468ee32469692464049518c311662ab3956681de31e3e9` |

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

Cek bentuk input/output dan uji ke foto:
`cargo run --release --example probe_models -- foto1.jpg foto2.jpg`
