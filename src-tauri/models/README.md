# Model AI yang dibundel

Keduanya ditanam ke dalam aplikasi lewat `include_bytes!` di `src/faces.rs`
dan dijalankan dengan tract (ONNX, Rust murni). Jangan ganti file tanpa
memperbarui checksum di sini.

| File | Asal | Lisensi | SHA-256 |
|------|------|---------|---------|
| `face_detection_yunet_2023mar.onnx` | [opencv/face_detection_yunet](https://huggingface.co/opencv/face_detection_yunet) (OpenCV Zoo, Shiqi Yu) | MIT — `LICENSE-yunet.txt` | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `face_landmarks.onnx` | [fernandotonon/QtMeshEditor-facemesh-onnx](https://huggingface.co/fernandotonon/QtMeshEditor-facemesh-onnx) — konversi ONNX dari MediaPipe Face Mesh V2 (Google) | Apache-2.0 | `d16e5a55e6a480284d468ee32469692464049518c311662ab3956681de31e3e9` |

`face_landmarks.onnx` adalah konversi pihak ketiga, bukan rilisan resmi
Google. Sebelum dijual, pertimbangkan mengonversi sendiri dari
`face_landmarker.task` resmi (storage.googleapis.com/mediapipe-models) dan
bandingkan hasilnya.

Cek bentuk input/output dan uji ke foto:
`cargo run --release --example probe_models -- foto1.jpg foto2.jpg`
