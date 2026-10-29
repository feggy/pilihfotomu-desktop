//! Edit foto › Hapus objek: what was marked filled in by MI-GAN (Picsart AI
//! Research, MIT — 29,5 MB, embedded, see `models/README.md`), a small
//! inpainting network trained on Places2 at 512 px, run with tract on this
//! computer. The page cuts the part round the marks to 512 × 512, sends it
//! here with its mask, and blends what comes back into the photo.

use std::io::Cursor;
use std::sync::OnceLock;

use tract_onnx::prelude::*;

static MIGAN_ONNX: &[u8] = include_bytes!("../models/migan_512_places2.onnx");

/// The side the model works at.
pub const SIDE: usize = 512;

fn plan() -> Result<Arc<TypedRunnableModel>, String> {
    static PLAN: OnceLock<Result<Arc<TypedRunnableModel>, String>> = OnceLock::new();
    PLAN.get_or_init(|| {
        tract_onnx::onnx()
            .model_for_read(&mut Cursor::new(MIGAN_ONNX))
            .and_then(|m| m.with_input_fact(0, u8::fact([1, 3, SIDE, SIDE]).into()))
            .and_then(|m| m.with_input_fact(1, u8::fact([1, 1, SIDE, SIDE]).into()))
            .and_then(|m| m.into_optimized())
            .and_then(|m| m.into_runnable())
            .map_err(|e| format!("model Hapus objek tidak bisa dimuat: {e}"))
    })
    .clone()
}

/// `rgb` (512 × 512 × 3) with the pixels where `hole` is not 0 (512 × 512)
/// filled in; the rest comes back as it was.
pub fn fill(rgb: &[u8], hole: &[u8]) -> Result<Vec<u8>, String> {
    let n = SIDE * SIDE;
    if rgb.len() != n * 3 || hole.len() != n {
        return Err("Data gambar tidak terbaca.".into());
    }
    let image = tract_ndarray::Array4::from_shape_fn((1, 3, SIDE, SIDE), |(_, c, y, x)| rgb[(y * SIDE + x) * 3 + c]);
    // The model's mask: 255 where the photo is kept, 0 where it fills.
    let mask = tract_ndarray::Array4::from_shape_fn((1, 1, SIDE, SIDE), |(_, _, y, x)| if hole[y * SIDE + x] != 0 { 0u8 } else { 255u8 });
    let out = plan()?.run(tvec!(Tensor::from(image).into(), Tensor::from(mask).into())).map_err(|e| e.to_string())?;
    let v = out[0].to_plain_array_view::<u8>().map_err(|e| e.to_string())?;
    let mut filled = rgb.to_vec();
    for y in 0..SIDE {
        for x in 0..SIDE {
            if hole[y * SIDE + x] != 0 {
                for c in 0..3 {
                    filled[(y * SIDE + x) * 3 + c] = v[[0, c, y, x]];
                }
            }
        }
    }
    Ok(filled)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// For trying the page's side with the real model: `INPAINT_IN` (the body the page sends) to `INPAINT_OUT`.
    #[test]
    #[ignore]
    fn from_file() {
        let (Ok(i), Ok(o)) = (std::env::var("INPAINT_IN"), std::env::var("INPAINT_OUT")) else { return };
        let body = std::fs::read(i).unwrap();
        let n = SIDE * SIDE;
        std::fs::write(o, fill(&body[..n * 3], &body[n * 3..]).unwrap()).unwrap();
    }

    #[test]
    fn fills_only_the_hole() {
        // A flat grey picture with a square taken out: the square comes back near grey, the rest exactly.
        let rgb = vec![128u8; SIDE * SIDE * 3];
        let hole: Vec<u8> = (0..SIDE * SIDE).map(|i| u8::from((200..300).contains(&(i % SIDE)) && (200..300).contains(&(i / SIDE)))).collect();
        let out = fill(&rgb, &hole).unwrap();
        let mid = (250 * SIDE + 250) * 3;
        assert!(out[mid..mid + 3].iter().all(|&v| (v as i32 - 128).abs() < 24), "{:?}", &out[mid..mid + 3]);
        assert_eq!(&out[..30], &rgb[..30]);
    }
}
