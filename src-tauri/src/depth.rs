//! Edit foto › Lens Blur: how near each part of the photo is, on this
//! computer. Depth Anything V2 Small (Lihe Yang et al., Apache-2.0 — weights
//! stored float16, 50 MB, embedded, see `models/README.md`) run with tract on
//! the photo at 518 px on its long side.
//!
//! Its answer is relative (nearer is larger, no units), so it is stretched
//! to 0–255 per photo: 255 the nearest, 0 the farthest.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Mutex, OnceLock};

use tract_onnx::prelude::*;

type Plan = Arc<TypedRunnableModel>;

static DEPTH_ONNX: &[u8] = include_bytes!("../models/depth_anything_v2_small_f16.onnx");

/// The long side the model reads; both sides a multiple of its 14 px patches.
const LONG: usize = 518;
const PATCH: usize = 14;
/// As the model was trained (ImageNet's mean and spread).
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

fn plan(w: usize, h: usize) -> Result<Plan, String> {
    static PLANS: OnceLock<Mutex<HashMap<(usize, usize), Plan>>> = OnceLock::new();
    let plans = PLANS.get_or_init(Default::default);
    if let Some(p) = plans.lock().unwrap().get(&(w, h)) {
        return Ok(p.clone());
    }
    let p = tract_onnx::onnx()
        .model_for_read(&mut Cursor::new(DEPTH_ONNX))
        .and_then(|m| m.with_input_fact(0, f32::fact([1, 3, h, w]).into()))
        .and_then(|m| m.into_optimized())
        .and_then(|m| m.into_runnable())
        .map_err(|e| format!("model kedalaman tidak bisa dimuat: {e}"))?;
    plans.lock().unwrap().insert((w, h), p.clone());
    Ok(p)
}

/// The size the model reads a `w` × `h` photo at.
pub fn model_size(w: usize, h: usize) -> (usize, usize) {
    let k = LONG as f32 / w.max(h) as f32;
    let fit = |v: usize| (((v as f32 * k) / PATCH as f32).round() as usize).max(1) * PATCH;
    (fit(w), fit(h))
}

/// The depth of `img`: nearness 0–255 per pixel, at `model_size`.
pub fn depth(img: &image::RgbImage) -> Result<(Vec<u8>, usize, usize), String> {
    let (w, h) = model_size(img.width() as usize, img.height() as usize);
    let small = image::imageops::resize(img, w as u32, h as u32, image::imageops::FilterType::CatmullRom);
    let input = tract_ndarray::Array4::from_shape_fn((1, 3, h, w), |(_, c, y, x)| {
        (small.get_pixel(x as u32, y as u32)[c] as f32 / 255.0 - MEAN[c]) / STD[c]
    });
    let out = plan(w, h)?.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
    let v = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
    let vals: Vec<f32> = v.iter().copied().collect();
    if vals.len() != w * h {
        return Err("model kedalaman memberi hasil yang tidak terduga".into());
    }
    // Stretched between the 1st and 99th percentile: a stray spot doesn't squash the rest.
    let mut sorted = vals.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let lo = sorted[sorted.len() / 100];
    let hi = sorted[sorted.len() * 99 / 100].max(lo + 1e-6);
    Ok((vals.iter().map(|v| (((v - lo) / (hi - lo)).clamp(0.0, 1.0) * 255.0).round() as u8).collect(), w, h))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_at_the_model_size_and_spans_near_to_far() {
        assert_eq!(model_size(6000, 4000), (518, 350));
        // A dark floor below a bright wall: something near and something far.
        let img = image::RgbImage::from_fn(300, 200, |_, y| if y > 120 { image::Rgb([90, 70, 50]) } else { image::Rgb([200, 210, 220]) });
        let (d, w, h) = depth(&img).unwrap();
        assert_eq!(d.len(), w * h);
        assert!(d.iter().any(|&v| v > 200) && d.iter().any(|&v| v < 50));
    }
}
