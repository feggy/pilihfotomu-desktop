//! Per-photo measurements: focus, exposure, and a fingerprint for spotting
//! near-identical frames. Pure functions over pixels — no AI model yet.

use image::{DynamicImage, GrayImage, imageops::FilterType};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    /// 0–100. Focus of the sharpest part of the frame, so a sharp subject on
    /// a blurred (bokeh) background still scores high.
    pub sharpness: f32,
    /// Mean luminance 0–255.
    pub brightness: f32,
    /// Share of pixels at or near pure black / pure white.
    pub shadows_clipped: f32,
    pub highlights_clipped: f32,
    /// 64-bit difference hash; few differing bits = visually the same frame.
    pub dhash: u64,
}

/// Tiles per side for the focus map.
const GRID: u32 = 6;
/// Laplacian variance that maps to 0 and to 100 (log scale), measured on a
/// ~1024 px preview. Tune these against real sessions.
const VAR_BLURRY: f32 = 12.0;
const VAR_CRISP: f32 = 900.0;

pub fn measure(img: &DynamicImage) -> Metrics {
    let gray = img.to_luma8();
    let (shadows_clipped, highlights_clipped, brightness) = exposure(&gray);
    Metrics { sharpness: sharpness(&gray), brightness, shadows_clipped, highlights_clipped, dhash: dhash(&gray) }
}

/// Variance of the Laplacian per tile; the frame's score is the second-best
/// tile, so one noisy or high-contrast tile can't fake focus on its own.
fn sharpness(g: &GrayImage) -> f32 {
    let (w, h) = g.dimensions();
    if w < 3 * GRID || h < 3 * GRID {
        return 0.0;
    }
    let (tw, th) = (w / GRID, h / GRID);
    let mut tiles = Vec::with_capacity((GRID * GRID) as usize);
    for ty in 0..GRID {
        for tx in 0..GRID {
            let (x0, y0) = ((tx * tw).max(1), (ty * th).max(1));
            let (x1, y1) = (((tx + 1) * tw).min(w - 1), ((ty + 1) * th).min(h - 1));
            let (mut sum, mut sq, mut n) = (0f64, 0f64, 0f64);
            for y in y0..y1 {
                for x in x0..x1 {
                    let c = g.get_pixel(x, y)[0] as f64;
                    let lap = g.get_pixel(x - 1, y)[0] as f64
                        + g.get_pixel(x + 1, y)[0] as f64
                        + g.get_pixel(x, y - 1)[0] as f64
                        + g.get_pixel(x, y + 1)[0] as f64
                        - 4.0 * c;
                    sum += lap;
                    sq += lap * lap;
                    n += 1.0;
                }
            }
            if n > 0.0 {
                let mean = sum / n;
                tiles.push((sq / n - mean * mean) as f32);
            }
        }
    }
    tiles.sort_by(|a, b| b.total_cmp(a));
    let v = tiles.get(1).or(tiles.first()).copied().unwrap_or(0.0).max(1e-3);
    let t = (v.ln() - VAR_BLURRY.ln()) / (VAR_CRISP.ln() - VAR_BLURRY.ln());
    (t.clamp(0.0, 1.0) * 100.0).round()
}

fn exposure(g: &GrayImage) -> (f32, f32, f32) {
    let n = g.pixels().len().max(1) as f32;
    let (mut lo, mut hi, mut sum) = (0u32, 0u32, 0u64);
    for p in g.pixels() {
        let v = p[0];
        sum += v as u64;
        lo += (v <= 6) as u32;
        hi += (v >= 250) as u32;
    }
    (lo as f32 / n, hi as f32 / n, sum as f32 / n)
}

fn dhash(g: &GrayImage) -> u64 {
    let small = image::imageops::resize(g, 9, 8, FilterType::Triangle);
    let mut bits = 0u64;
    for y in 0..8 {
        for x in 0..8 {
            bits <<= 1;
            bits |= (small.get_pixel(x, y)[0] > small.get_pixel(x + 1, y)[0]) as u64;
        }
    }
    bits
}

pub fn hamming(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GrayImage, Luma, imageops};

    fn checker(size: u32) -> DynamicImage {
        DynamicImage::ImageLuma8(GrayImage::from_fn(size, size, |x, y| {
            Luma([if (x / 4 + y / 4) % 2 == 0 { 30 } else { 220 }])
        }))
    }

    #[test]
    fn blur_lowers_sharpness() {
        let sharp = checker(240);
        let blurred = DynamicImage::ImageLuma8(imageops::blur(&sharp.to_luma8(), 6.0));
        let (s, b) = (measure(&sharp).sharpness, measure(&blurred).sharpness);
        assert!(s > 80.0, "sharp scored {s}");
        assert!(b < s - 40.0, "blurred scored {b} vs sharp {s}");
    }

    #[test]
    fn dark_frame_is_dark() {
        let dark = DynamicImage::ImageLuma8(GrayImage::from_pixel(64, 64, Luma([3])));
        let m = measure(&dark);
        assert!(m.brightness < 5.0 && m.shadows_clipped > 0.99);
    }

    #[test]
    fn similar_frames_hash_close() {
        // A bright spot on the left vs. the same scene mirrored.
        let spot = |cx: f32| {
            DynamicImage::ImageLuma8(GrayImage::from_fn(240, 240, |x, y| {
                let d = ((x as f32 - cx).powi(2) + (y as f32 - 120.0).powi(2)).sqrt();
                Luma([(230.0 - d).clamp(10.0, 230.0) as u8])
            }))
        };
        let a = spot(60.0);
        let b = DynamicImage::ImageLuma8(imageops::brighten(&a.to_luma8(), 8));
        let other = spot(180.0);
        assert!(hamming(measure(&a).dhash, measure(&b).dhash) <= 4);
        assert!(hamming(measure(&a).dhash, measure(&other).dhash) > 10);
    }
}
