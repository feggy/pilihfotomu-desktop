//! Hapus latar for Buat konten: a see-through mask of a picture's subject,
//! made on this computer. Two small ONNX models, embedded and run with tract
//! like the face models (see `models/README.md`):
//! - **MODNet** (Apache-2.0) for people: hair and fine edges;
//! - **U²-Netp** (Apache-2.0) for objects: one clear subject, firm edges.
//!
//! The page sends the picture already at the model's size (RGB, row by row)
//! and gets one alpha byte per pixel back; it stretches the mask over the
//! photo itself (`kreasi/engine/cutout.ts`).

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Mutex, OnceLock};

use tract_onnx::prelude::*;

type Plan = Arc<TypedRunnableModel>;

static MODNET_ONNX: &[u8] = include_bytes!("../models/modnet_f16.onnx");
static U2NETP_ONNX: &[u8] = include_bytes!("../models/u2netp.onnx");

/// U²-Netp's fixed input side.
pub const OBJECT_SIDE: u32 = 320;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// People (MODNet): any size, both sides a multiple of 32.
    Portrait,
    /// Objects (U²-Netp): 320 × 320.
    Object,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s {
            "potret" => Some(Mode::Portrait),
            "objek" => Some(Mode::Object),
            _ => None,
        }
    }
}

fn load(bytes: &[u8], w: u32, h: u32) -> TractResult<Plan> {
    tract_onnx::onnx()
        .model_for_read(&mut Cursor::new(bytes))?
        .with_input_fact(0, f32::fact([1, 3, h as usize, w as usize]).into())?
        .into_optimized()?
        .into_runnable()
}

/// MODNet's input size changes with the photo's shape: one plan per size,
/// kept (a session sees only a few shapes).
fn modnet(w: u32, h: u32) -> Result<Plan, String> {
    static PLANS: OnceLock<Mutex<HashMap<(u32, u32), Plan>>> = OnceLock::new();
    let plans = PLANS.get_or_init(Default::default);
    if let Some(p) = plans.lock().unwrap().get(&(w, h)) {
        return Ok(p.clone());
    }
    let p = load(MODNET_ONNX, w, h).map_err(|e| format!("model hapus latar tidak bisa dimuat: {e}"))?;
    plans.lock().unwrap().insert((w, h), p.clone());
    Ok(p)
}

fn u2netp() -> Result<Plan, String> {
    static PLAN: OnceLock<Result<Plan, String>> = OnceLock::new();
    PLAN.get_or_init(|| load(U2NETP_ONNX, OBJECT_SIDE, OBJECT_SIDE).map_err(|e| format!("model hapus latar tidak bisa dimuat: {e}")))
        .clone()
}

/// The subject's mask of an RGB picture `w` × `h`: one alpha byte per pixel,
/// same size.
pub fn mask(mode: Mode, w: u32, h: u32, rgb: &[u8]) -> Result<Vec<u8>, String> {
    let n = (w * h) as usize;
    if w == 0 || h == 0 || rgb.len() != n * 3 {
        return Err("Data gambar tidak terbaca.".into());
    }
    let px = |i: usize, c: usize| rgb[i * 3 + c] as f32;
    match mode {
        Mode::Portrait => {
            if !w.is_multiple_of(32) || !h.is_multiple_of(32) {
                return Err("Data gambar tidak terbaca.".into());
            }
            // (x / 255 − 0.5) / 0.5, as MODNet was trained.
            let input = tract_ndarray::Array4::from_shape_fn((1, 3, h as usize, w as usize), |(_, c, y, x)| {
                px(y * w as usize + x, c) / 127.5 - 1.0
            });
            let out = modnet(w, h)?.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
            let alpha = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
            Ok(alpha.iter().map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8).collect())
        }
        Mode::Object => {
            if w != OBJECT_SIDE || h != OBJECT_SIDE {
                return Err("Data gambar tidak terbaca.".into());
            }
            // As rembg runs it: scaled by the brightest channel, then ImageNet's mean and spread.
            const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
            const STD: [f32; 3] = [0.229, 0.224, 0.225];
            let max = rgb.iter().copied().max().unwrap_or(1).max(1) as f32;
            let s = OBJECT_SIDE as usize;
            let input = tract_ndarray::Array4::from_shape_fn((1, 3, s, s), |(_, c, y, x)| {
                (px(y * s + x, c) / max - MEAN[c]) / STD[c]
            });
            let out = u2netp()?.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
            // The fused output (the first); the others are side views.
            let pred = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
            let (lo, hi) = pred.iter().fold((f32::MAX, f32::MIN), |(lo, hi), &v| (lo.min(v), hi.max(v)));
            let range = (hi - lo).max(1e-6);
            Ok(pred.iter().map(|v| ((v - lo) / range * 255.0).round() as u8).collect())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_models_run_and_answer_one_byte_per_pixel() {
        let flat = vec![128u8; 64 * 96 * 3];
        assert_eq!(mask(Mode::Portrait, 64, 96, &flat).unwrap().len(), 64 * 96);
        let side = OBJECT_SIDE as usize;
        assert_eq!(mask(Mode::Object, OBJECT_SIDE, OBJECT_SIDE, &vec![90u8; side * side * 3]).unwrap().len(), side * side);
        assert!(mask(Mode::Portrait, 50, 96, &vec![0u8; 50 * 96 * 3]).is_err(), "not a multiple of 32");
    }
}
