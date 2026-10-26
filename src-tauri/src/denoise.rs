//! Edit foto › AI Denoise: a photo's noise taken away, on this computer.
//! FFDNet (Kai Zhang, KAIR, MIT — 3.4 MB, embedded, see `models/README.md`)
//! run with tract over the photo in overlapping tiles, several at once.
//!
//! How noisy the photo is (the σ the model is asked for) is read from the
//! photo itself where it is flat (`estimate_sigma`, as the web app's
//! `denoise-sigma.ts`): a clean ISO 100 photo comes out near 3 and is left
//! as it is; a high-ISO one is asked for more.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};

use rayon::prelude::*;
use tract_onnx::prelude::*;

type Plan = Arc<TypedRunnableModel>;
/// One tile's cleaned part: x0, y0, x1, y1 and its RGB bytes.
type Part = (usize, usize, usize, usize, Vec<u8>);

static FFDNET_ONNX: &[u8] = include_bytes!("../models/ffdnet-color.onnx");

/// Tile side, and the margin round the part of it kept (seams stay hidden).
const TILE: usize = 512;
const MARGIN: usize = 16;

/// One plan per tile shape (a photo has at most a few: the full tile, and
/// smaller ones only when the photo itself is smaller).
fn plan(w: usize, h: usize) -> Result<Plan, String> {
    static PLANS: OnceLock<Mutex<HashMap<(usize, usize), Plan>>> = OnceLock::new();
    let plans = PLANS.get_or_init(Default::default);
    if let Some(p) = plans.lock().unwrap().get(&(w, h)) {
        return Ok(p.clone());
    }
    let p = tract_onnx::onnx()
        .model_for_read(&mut Cursor::new(FFDNET_ONNX))
        .and_then(|m| m.with_input_fact(0, f32::fact([1, 3, h, w]).into()))
        .and_then(|m| m.with_input_fact(1, f32::fact([1, 1, 1, 1]).into()))
        .and_then(|m| m.into_optimized())
        .and_then(|m| m.into_runnable())
        .map_err(|e| format!("model AI Denoise tidak bisa dimuat: {e}"))?;
    plans.lock().unwrap().insert((w, h), p.clone());
    Ok(p)
}

/// `rgb` (`w` × `h`, row by row) cleaned at noise level `sigma` (0–255).
/// `progress(done, total)` as tiles finish.
pub fn denoise(rgb: &[u8], w: usize, h: usize, sigma: f32, progress: impl Fn(u32, u32) + Sync) -> Result<Vec<u8>, String> {
    if w < 8 || h < 8 || rgb.len() != w * h * 3 {
        return Err("Data gambar tidak terbaca.".into());
    }
    let even = |v: usize| v - v % 2;
    let (tw, th) = (TILE.min(even(w)), TILE.min(even(h)));
    let step_x = tw.saturating_sub(2 * MARGIN).max(1);
    let step_y = th.saturating_sub(2 * MARGIN).max(1);
    let tiles: Vec<(usize, usize)> =
        (0..h).step_by(step_y).flat_map(|ty| (0..w).step_by(step_x).map(move |tx| (tx, ty))).collect();
    let total = tiles.len() as u32;
    let done = AtomicU32::new(0);
    let p = plan(tw, th)?;
    let sig = Tensor::from(tract_ndarray::Array4::from_elem((1, 1, 1, 1), sigma / 255.0));

    let results: Vec<Result<Part, String>> = tiles
        .par_iter()
        .map(|&(tx, ty)| {
            // The window read: a margin round the part written, kept inside the photo.
            let wx = tx.saturating_sub(MARGIN).min(w - tw);
            let wy = ty.saturating_sub(MARGIN).min(h - th);
            let input = tract_ndarray::Array4::from_shape_fn((1, 3, th, tw), |(_, c, y, x)| {
                rgb[((wy + y) * w + wx + x) * 3 + c] as f32 / 255.0
            });
            let out = p.run(tvec!(Tensor::from(input).into(), sig.clone().into())).map_err(|e| e.to_string())?;
            let v = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
            // The part this tile writes: its step, inside the photo.
            let (x0, y0) = (tx, ty);
            let (x1, y1) = ((tx + step_x).min(w), (ty + step_y).min(h));
            let mut part = Vec::with_capacity((x1 - x0) * (y1 - y0) * 3);
            for y in y0..y1 {
                for x in x0..x1 {
                    for c in 0..3 {
                        part.push((v[[0, c, y - wy, x - wx]].clamp(0.0, 1.0) * 255.0).round() as u8);
                    }
                }
            }
            progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);
            Ok((x0, y0, x1, y1, part))
        })
        .collect();

    let mut out = vec![0u8; rgb.len()];
    for r in results {
        let (x0, y0, x1, y1, part) = r?;
        let row = (x1 - x0) * 3;
        for (i, y) in (y0..y1).enumerate() {
            out[(y * w + x0) * 3..(y * w + x1) * 3].copy_from_slice(&part[i * row..(i + 1) * row]);
        }
    }
    Ok(out)
}

/// How noisy `rgb` is, as the σ (0–255) to ask the model for; see the module.
pub fn estimate_sigma(rgb: &[u8], w: usize, h: usize) -> f32 {
    const B: usize = 32;
    let (cols, rows) = (w / B, h / B);
    if cols == 0 || rows == 0 {
        return 3.0;
    }
    let every = (((cols * rows) as f32 / 3000.0).sqrt().round() as usize).max(1);
    let k = (std::f32::consts::PI / 2.0).sqrt() / 6.0;
    let lap = |g: &dyn Fn(usize, usize) -> f32, x: usize, y: usize| {
        (g(x - 1, y - 1) - 2.0 * g(x, y - 1) + g(x + 1, y - 1) - 2.0 * g(x - 1, y) + 4.0 * g(x, y) - 2.0 * g(x + 1, y)
            + g(x - 1, y + 1)
            - 2.0 * g(x, y + 1)
            + g(x + 1, y + 1))
            .abs()
    };
    let mut blocks: Vec<(f32, f32, f32)> = Vec::new();
    let half_side = B / 2;
    let mut half = vec![0f32; half_side * half_side];
    for by in (0..rows).step_by(every) {
        for bx in (0..cols).step_by(every) {
            let (x0, y0) = (bx * B, by * B);
            let mut worst = (0f32, 0f32, 0f32);
            for c in 0..3 {
                let at = |x: usize, y: usize| rgb[((y0 + y) * w + x0 + x) * 3 + c] as f32;
                let mut s = 0.0;
                for y in 1..B - 1 {
                    for x in 1..B - 1 {
                        s += lap(&at, x, y);
                    }
                }
                let pixel = k * s / ((B - 2) * (B - 2)) as f32;
                for y in 0..half_side {
                    for x in 0..half_side {
                        half[y * half_side + x] =
                            (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4.0;
                    }
                }
                let at_half = |x: usize, y: usize| half[y * half_side + x];
                let mut t = 0.0;
                for y in 1..half_side - 1 {
                    for x in 1..half_side - 1 {
                        t += lap(&at_half, x, y);
                    }
                }
                let half_size = 2.0 * k * t / ((half_side - 2) * (half_side - 2)) as f32;
                let level = pixel.max(half_size);
                if level > worst.0 {
                    worst = (level, pixel, half_size);
                }
            }
            blocks.push(worst);
        }
    }
    blocks.sort_by(|a, b| a.0.total_cmp(&b.0));
    let flat = &blocks[..(blocks.len() / 4).max(1)];
    let level = flat[flat.len() - 1].0;
    let pixel: f32 = flat.iter().map(|b| b.1).sum();
    let half_size: f32 = flat.iter().map(|b| b.2).sum();
    let clings = half_size / pixel.max(1e-6);
    let factor = (1.25 + (1.9 - clings) * 0.4).clamp(1.25, 1.6);
    (level * factor).clamp(3.0, 60.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noise_is_read_and_taken_away() {
        let (w, h) = (300, 200);
        // A smooth gradient with grain on it.
        let mut seed = 7u32;
        let mut rnd = || {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
            ((seed >> 16) % 61) as i32 - 30
        };
        let rgb: Vec<u8> = (0..w * h * 3).map(|i| ((i / 3 % w) as i32 * 200 / w as i32 + 20 + rnd()).clamp(0, 255) as u8).collect();
        let clean: Vec<u8> = (0..w * h * 3).map(|i| ((i / 3 % w) as i32 * 200 / w as i32 + 20) as u8).collect();
        let sigma = estimate_sigma(&rgb, w, h);
        assert!(sigma > 10.0, "grain read as noise: {sigma}");
        assert!(estimate_sigma(&clean, w, h) < 4.0, "a clean gradient stays clean");
        let out = denoise(&rgb, w, h, sigma, |_, _| {}).unwrap();
        let err = |a: &[u8]| a.iter().zip(&clean).map(|(x, y)| (*x as f32 - *y as f32).abs()).sum::<f32>() / a.len() as f32;
        assert!(err(&out) < err(&rgb) / 2.0, "{} vs {}", err(&out), err(&rgb));
    }
}
