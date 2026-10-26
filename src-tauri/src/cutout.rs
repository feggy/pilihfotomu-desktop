//! Hapus latar for Buat konten: a see-through mask of a picture's subject,
//! made on this computer. Two small ONNX models, embedded and run with tract
//! like the face models (see `models/README.md`):
//! - **MODNet** (Apache-2.0) for people: hair and fine edges;
//! - **U²-Netp** (Apache-2.0) for objects: one clear subject, firm edges;
//! - **MediaPipe Selfie Multiclass** (Apache-2.0) for a person's parts —
//!   hair, body skin, face skin, clothes, accessories — on a crop round
//!   them (Edit foto › Masking › Orang);
//! - **DeepLabV3 MobileNetV2, ADE20K** (Apache-2.0, TensorFlow Model
//!   Garden) for the sky (Masking › Langit): one of its 150 kinds of thing.
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
static MULTICLASS_ONNX: &[u8] = include_bytes!("../models/selfie_multiclass.onnx");
static DEEPLAB_ONNX: &[u8] = include_bytes!("../models/deeplab_ade20k.onnx");

/// DeepLab's fixed input side, and its output's (one in four).
pub const SKY_SIDE: u32 = 513;
pub const SKY_OUT: usize = 129;
/// ADE20K's classes, "other" first; the sky is the third kind.
const ADE_CLASSES: usize = 151;
const ADE_SKY: usize = 3;

/// Selfie Multiclass's fixed input side.
pub const PARTS_SIDE: u32 = 256;
/// Its classes, in order: background, hair, body skin, face skin, clothes, others.
pub const PARTS: usize = 6;

/// U²-Netp's fixed input side.
pub const OBJECT_SIDE: u32 = 320;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// People (MODNet): any size, both sides a multiple of 32.
    Portrait,
    /// Objects (U²-Netp): 320 × 320.
    Object,
    /// A person's parts (Selfie Multiclass): 256 × 256, six bytes a pixel.
    Parts,
    /// The sky (DeepLab, ADE20K): 513 × 513 in, its share 129 × 129 out.
    Sky,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s {
            "potret" => Some(Mode::Portrait),
            "objek" => Some(Mode::Object),
            "bagian" => Some(Mode::Parts),
            "langit" => Some(Mode::Sky),
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

fn multiclass() -> Result<Plan, String> {
    static PLAN: OnceLock<Result<Plan, String>> = OnceLock::new();
    PLAN.get_or_init(|| {
        let s = PARTS_SIDE as usize;
        tract_onnx::onnx()
            .model_for_read(&mut Cursor::new(MULTICLASS_ONNX))
            .and_then(|m| m.with_input_fact(0, f32::fact([1, s, s, 3]).into()))
            .and_then(|m| m.into_optimized())
            .and_then(|m| m.into_runnable())
            .map_err(|e| format!("model bagian orang tidak bisa dimuat: {e}"))
    })
    .clone()
}

fn deeplab() -> Result<Plan, String> {
    static PLAN: OnceLock<Result<Plan, String>> = OnceLock::new();
    PLAN.get_or_init(|| {
        let s = SKY_SIDE as usize;
        tract_onnx::onnx()
            .model_for_read(&mut Cursor::new(DEEPLAB_ONNX))
            .and_then(|m| m.with_input_fact(0, f32::fact([1, s, s, 3]).into()))
            .and_then(|m| m.into_optimized())
            .and_then(|m| m.into_runnable())
            .map_err(|e| format!("model langit tidak bisa dimuat: {e}"))
    })
    .clone()
}

/// The subject's mask of an RGB picture `w` × `h`: one alpha byte per pixel,
/// same size — or, for `Parts`, each class's share (0–255) per pixel, six
/// bytes a pixel in the classes' order.
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
        Mode::Sky => {
            if w != SKY_SIDE || h != SKY_SIDE {
                return Err("Data gambar tidak terbaca.".into());
            }
            // −1…1, channels last, as DeepLab's own graph prepares it.
            let s = SKY_SIDE as usize;
            let input = tract_ndarray::Array4::from_shape_fn((1, s, s, 3), |(_, y, x, c)| px(y * s + x, c) / 127.5 - 1.0);
            let out = deeplab()?.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
            let scores = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
            let flat: Vec<f32> = scores.iter().copied().collect();
            if flat.len() != SKY_OUT * SKY_OUT * ADE_CLASSES {
                return Err("model langit memberi hasil yang tidak terduga".into());
            }
            // The sky's share of each spot (softmax over the 151 kinds).
            Ok(flat
                .as_chunks::<ADE_CLASSES>()
                .0
                .iter()
                .map(|px| {
                    let top = px.iter().fold(f32::MIN, |a, &b| a.max(b));
                    let sum: f32 = px.iter().map(|v| (v - top).exp()).sum();
                    ((px[ADE_SKY] - top).exp() / sum * 255.0).round() as u8
                })
                .collect())
        }
        Mode::Parts => {
            if w != PARTS_SIDE || h != PARTS_SIDE {
                return Err("Data gambar tidak terbaca.".into());
            }
            // 0–1, channels last, as MediaPipe feeds it.
            let s = PARTS_SIDE as usize;
            let input = tract_ndarray::Array4::from_shape_fn((1, s, s, 3), |(_, y, x, c)| px(y * s + x, c) / 255.0);
            let out = multiclass()?.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
            let scores = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
            let flat: Vec<f32> = scores.iter().copied().collect();
            // Its scores, made shares (softmax) for soft edges.
            let mut bytes = Vec::with_capacity(n * PARTS);
            for px in flat.as_chunks::<PARTS>().0 {
                let top = px.iter().fold(f32::MIN, |a, &b| a.max(b));
                let e: Vec<f32> = px.iter().map(|v| (v - top).exp()).collect();
                let sum: f32 = e.iter().sum();
                bytes.extend(e.iter().map(|v| (v / sum * 255.0).round() as u8));
            }
            Ok(bytes)
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
        let s = PARTS_SIDE as usize;
        assert_eq!(mask(Mode::Parts, PARTS_SIDE, PARTS_SIDE, &vec![120u8; s * s * 3]).unwrap().len(), s * s * PARTS);
        let k = SKY_SIDE as usize;
        // A pale blue picture above, dark below: sky up top, not at the foot.
        let rgb: Vec<u8> = (0..k * k).flat_map(|i| if i / k < k / 2 { [150u8, 190, 235] } else { [60u8, 50, 40] }).collect();
        let sky = mask(Mode::Sky, SKY_SIDE, SKY_SIDE, &rgb).unwrap();
        assert_eq!(sky.len(), SKY_OUT * SKY_OUT);
        assert!(sky[SKY_OUT * 10 + 64] > sky[SKY_OUT * 120 + 64], "more sky at the top than the bottom");
    }
}
