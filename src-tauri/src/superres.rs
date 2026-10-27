//! Edit foto › Super Resolution: a photo made twice as wide and twice as
//! tall, its detail drawn in rather than blown up, on this computer.
//! Real-ESRGAN's compact general model (`realesr-general-x4v3`, Xintao
//! Wang et al., BSD-3-Clause — 4.9 MB, embedded, see `models/README.md`)
//! enlarges four times; each tile is then brought down to twice by
//! averaging every 2 × 2, which also smooths what the model overdid.
//! Run with tract over the photo in overlapping tiles, several at once.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};

use rayon::prelude::*;
use tract_onnx::prelude::*;

type Plan = Arc<TypedRunnableModel>;
/// One tile's part of the result: x0, y0, x1, y1 (in the result) and its RGB bytes.
type Part = (usize, usize, usize, usize, Vec<u8>);

static ESRGAN_ONNX: &[u8] = include_bytes!("../models/esrgan_x4v3.onnx");

/// Tile side (in the photo), and the margin round the part kept.
const TILE: usize = 128;
const MARGIN: usize = 8;
/// What the model does, and what comes out.
const MODEL_SCALE: usize = 4;
pub const SCALE: usize = 2;

fn plan(w: usize, h: usize) -> Result<Plan, String> {
    static PLANS: OnceLock<Mutex<HashMap<(usize, usize), Plan>>> = OnceLock::new();
    let plans = PLANS.get_or_init(Default::default);
    if let Some(p) = plans.lock().unwrap().get(&(w, h)) {
        return Ok(p.clone());
    }
    let p = tract_onnx::onnx()
        .model_for_read(&mut Cursor::new(ESRGAN_ONNX))
        .and_then(|m| m.with_input_fact(0, f32::fact([1, 3, h, w]).into()))
        .and_then(|m| m.into_optimized())
        .and_then(|m| m.into_runnable())
        .map_err(|e| format!("model Super Resolution tidak bisa dimuat: {e}"))?;
    plans.lock().unwrap().insert((w, h), p.clone());
    Ok(p)
}

/// `rgb` (`w` × `h`, row by row) at twice the size, `2w` × `2h`.
/// `progress(done, total)` as tiles finish.
pub fn upscale(rgb: &[u8], w: usize, h: usize, progress: impl Fn(u32, u32) + Sync) -> Result<Vec<u8>, String> {
    if w < 8 || h < 8 || rgb.len() != w * h * 3 {
        return Err("Data gambar tidak terbaca.".into());
    }
    let (tw, th) = (TILE.min(w), TILE.min(h));
    let step_x = tw.saturating_sub(2 * MARGIN).max(1);
    let step_y = th.saturating_sub(2 * MARGIN).max(1);
    let tiles: Vec<(usize, usize)> =
        (0..h).step_by(step_y).flat_map(|ty| (0..w).step_by(step_x).map(move |tx| (tx, ty))).collect();
    let total = tiles.len() as u32;
    let done = AtomicU32::new(0);
    let p = plan(tw, th)?;
    let (ow, oh) = (w * SCALE, h * SCALE);
    // How many of the model's pixels make one of ours, each way.
    let k = MODEL_SCALE / SCALE;

    let results: Vec<Result<Part, String>> = tiles
        .par_iter()
        .map(|&(tx, ty)| {
            let wx = tx.saturating_sub(MARGIN).min(w - tw);
            let wy = ty.saturating_sub(MARGIN).min(h - th);
            let input = tract_ndarray::Array4::from_shape_fn((1, 3, th, tw), |(_, c, y, x)| {
                rgb[((wy + y) * w + wx + x) * 3 + c] as f32 / 255.0
            });
            let out = p.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
            let v = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
            // The part this tile writes, in the result's pixels.
            let (x0, y0) = (tx * SCALE, ty * SCALE);
            let (x1, y1) = (((tx + step_x).min(w)) * SCALE, ((ty + step_y).min(h)) * SCALE);
            let mut part = Vec::with_capacity((x1 - x0) * (y1 - y0) * 3);
            for y in y0..y1 {
                for x in x0..x1 {
                    // This pixel's k × k block in the model's output, averaged.
                    let (my, mx) = ((y - wy * SCALE) * k, (x - wx * SCALE) * k);
                    for c in 0..3 {
                        let mut s = 0.0;
                        for dy in 0..k {
                            for dx in 0..k {
                                s += v[[0, c, my + dy, mx + dx]];
                            }
                        }
                        part.push(((s / (k * k) as f32).clamp(0.0, 1.0) * 255.0).round() as u8);
                    }
                }
            }
            progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);
            Ok((x0, y0, x1, y1, part))
        })
        .collect();

    let mut out = vec![0u8; ow * oh * 3];
    for r in results {
        let (x0, y0, x1, y1, part) = r?;
        let row = (x1 - x0) * 3;
        for (i, y) in (y0..y1).enumerate() {
            out[(y * ow + x0) * 3..(y * ow + x1) * 3].copy_from_slice(&part[i * row..(i + 1) * row]);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn twice_the_size_and_close_to_the_photo() {
        // A soft ramp: enlarged, each 2 × 2 should still read about the same as its pixel.
        let (w, h) = (150, 90);
        let rgb: Vec<u8> = (0..w * h).flat_map(|i| {
            let (x, y) = (i % w, i / w);
            [(x * 255 / w) as u8, (y * 255 / h) as u8, 128]
        }).collect();
        let out = upscale(&rgb, w, h, |_, _| {}).unwrap();
        assert_eq!(out.len(), w * h * 4 * 3);
        for (x, y) in [(10, 10), (75, 45), (140, 80)] {
            let src = rgb[(y * w + x) * 3] as i32;
            let big = out[((y * 2) * (w * 2) + x * 2) * 3] as i32;
            assert!((src - big).abs() < 12, "at {x},{y}: {src} vs {big}");
        }
    }
}
