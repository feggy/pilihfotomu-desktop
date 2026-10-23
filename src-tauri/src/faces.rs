//! Faces and whether their eyes are open.
//!
//! Two small ONNX models, run with tract (pure Rust, so nothing native to
//! ship per OS):
//! 1. **YuNet** (OpenCV Zoo, MIT) finds faces and 5 points on each — eyes,
//!    nose, mouth corners.
//! 2. **Face Mesh V2** (Google MediaPipe, Apache-2.0) gives 478 points on a
//!    face crop, eyelids included. Eye openness is the eye aspect ratio:
//!    eyelid gap ÷ eye width, so it doesn't depend on how big the face is.
//!
//! Both are embedded in the binary; see `models/` and THIRD-PARTY-NOTICES.

use std::io::Cursor;
use std::sync::OnceLock;

use image::RgbImage;
use serde::{Deserialize, Serialize};
use tract_onnx::prelude::*;

type Plan = Arc<TypedRunnableModel>;

static DETECTOR_ONNX: &[u8] = include_bytes!("../models/face_detection_yunet_2023mar.onnx");
static MESH_ONNX: &[u8] = include_bytes!("../models/face_landmarks.onnx");

const DET_SIZE: usize = 640;
const MESH_SIZE: usize = 256;
const MIN_SCORE: f32 = 0.6;
const NMS_IOU: f32 = 0.3;
/// Faces smaller than this (source pixels) are too small to judge eyelids.
const MIN_FACE_PX: f32 = 40.0;
/// Eye aspect ratio below which an eye counts as shut. Measured on a real
/// session (Indonesian family, 128 flagged faces): narrow, smiling and
/// downcast eyes that are open sit at 0.03–0.12, so a single cut-off there
/// mistakes "sipit" for blinking. Only nearly sealed lids are called closed:
/// both eyes under `EAR_CLOSED`, and at least one under `EAR_SEALED`.
pub const EAR_CLOSED: f32 = 0.05;
pub const EAR_SEALED: f32 = 0.03;
/// Smile score from which a face counts as smiling. Calibrated on the same
/// session: neutral faces scored ≤ 0.27, faint smiles ≥ 0.5.
pub const SMILE: f32 = 0.45;
/// Faces narrower than this (source px) get a sharpness reading at all.
pub const SHARP_MIN_PX: f32 = 100.0;
/// On its own, a face's sharpness only means "out of focus" when the face
/// is big and the reading very low: on the Galvin session smooth, downcast
/// but sharp faces read 14–40 at 100–130 px, the one missed-focus face 24 at
/// 177 px, faces ≥ 150 px otherwise ≥ 39. Within a burst, frames compare
/// against each other instead (`cull`), which is far more reliable.
pub const SOFT_ALONE_MIN_PX: f32 = 150.0;
pub const FACE_SOFT: f32 = 30.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Face {
    /// Box as fractions of the image (0–1), so the UI can draw it on any size.
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub score: f32,
    /// Eye aspect ratio of the subject's left and right eye.
    pub left_eye: f32,
    pub right_eye: f32,
    /// 0–1, how much this face smiles; None when it's turned too far to tell.
    /// Older saved sessions don't have it.
    #[serde(default)]
    pub smile: Option<f32>,
    /// Laplacian variance of the face's middle at a fixed size
    /// (`analyze::face_variance`); None when the face is too small to judge.
    #[serde(default)]
    pub sharpness: Option<f32>,
    /// Width of the face in source pixels.
    #[serde(default)]
    pub px: f32,
}

impl Face {
    /// Both eyes under the threshold. One closed eye is usually a wink or a
    /// face turned away — not the blink photographers cull for.
    pub fn eyes_closed(&self) -> bool {
        self.left_eye.max(self.right_eye) < EAR_CLOSED && self.left_eye.min(self.right_eye) < EAR_SEALED
    }

    /// The subject itself is out of focus (even if something else is sharp).
    pub fn soft(&self) -> bool {
        self.px >= SOFT_ALONE_MIN_PX && self.sharpness.is_some_and(|v| v < FACE_SOFT)
    }

    pub fn smiling(&self) -> bool {
        self.smile.is_some_and(|s| s >= SMILE)
    }
}

struct Models {
    detector: Plan,
    mesh: Plan,
}

fn models() -> Result<&'static Models, String> {
    static MODELS: OnceLock<Result<Models, String>> = OnceLock::new();
    MODELS
        .get_or_init(|| {
            let load = || -> TractResult<Models> {
                let detector = tract_onnx::onnx()
                    .model_for_read(&mut Cursor::new(DETECTOR_ONNX))?
                    .into_optimized()?
                    .into_runnable()?;
                let mesh = tract_onnx::onnx()
                    .model_for_read(&mut Cursor::new(MESH_ONNX))?
                    .with_input_fact(0, f32::fact([1, MESH_SIZE, MESH_SIZE, 3]).into())?
                    .into_optimized()?
                    .into_runnable()?;
                Ok(Models { detector, mesh })
            };
            load().map_err(|e| format!("model wajah tidak bisa dimuat: {e}"))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

/// Loads the models (once); an error means eye checks can't run at all.
pub fn ready() -> Result<(), String> {
    models().map(|_| ())
}

/// Finds the faces in `img` (upright) and measures their eyes.
pub fn analyze(img: &RgbImage) -> Result<Vec<Face>, String> {
    let m = models()?;
    let (w, h) = (img.width() as f32, img.height() as f32);
    let gray = image::DynamicImage::ImageRgb8(img.clone()).to_luma8();
    let mut out = Vec::new();
    for d in detect(&m.detector, img).map_err(|e| e.to_string())? {
        if d.w.max(d.h) < MIN_FACE_PX {
            continue;
        }
        let Ok((left_eye, right_eye, smile)) = eyes(&m.mesh, img, &d) else { continue };
        let sharpness =
            (d.w >= SHARP_MIN_PX).then(|| crate::analyze::face_variance(&gray, d.x / w, d.y / h, d.w / w, d.h / h));
        out.push(Face {
            x: d.x / w,
            y: d.y / h,
            w: d.w / w,
            h: d.h / h,
            score: d.score,
            left_eye,
            right_eye,
            smile,
            sharpness,
            px: d.w,
        });
    }
    Ok(out)
}

/// A detection in source pixels.
#[derive(Debug, Clone, Copy)]
struct Detection {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    score: f32,
    /// YuNet's 5 points: right eye, left eye (the subject's), nose, mouth corners.
    kps: [(f32, f32); 5],
}

fn detect(plan: &Plan, img: &RgbImage) -> TractResult<Vec<Detection>> {
    // Letterbox into 640×640 (YuNet's fixed input), BGR, 0–255, NCHW.
    let scale = DET_SIZE as f32 / img.width().max(img.height()) as f32;
    let (sw, sh) = ((img.width() as f32 * scale).round() as u32, (img.height() as f32 * scale).round() as u32);
    let small = image::imageops::resize(img, sw.max(1), sh.max(1), image::imageops::FilterType::Triangle);
    let input = tract_ndarray::Array4::from_shape_fn((1, 3, DET_SIZE, DET_SIZE), |(_, c, y, x)| {
        if (x as u32) < small.width() && (y as u32) < small.height() {
            small.get_pixel(x as u32, y as u32)[2 - c] as f32
        } else {
            0.0
        }
    });
    let out = plan.run(tvec!(Tensor::from(input).into()))?;
    let view = |i: usize| out[i].to_plain_array_view::<f32>().map(|v| v.iter().copied().collect::<Vec<f32>>());

    let mut found = Vec::new();
    for (k, stride) in [8usize, 16, 32].into_iter().enumerate() {
        let (cls, obj, bbox, kps) = (view(k)?, view(3 + k)?, view(6 + k)?, view(9 + k)?);
        let cols = DET_SIZE / stride;
        for idx in 0..cls.len() {
            let score = (cls[idx].clamp(0.0, 1.0) * obj[idx].clamp(0.0, 1.0)).sqrt();
            if score < MIN_SCORE {
                continue;
            }
            let (c, r) = ((idx % cols) as f32, (idx / cols) as f32);
            let s = stride as f32;
            let cx = (c + bbox[idx * 4]) * s;
            let cy = (r + bbox[idx * 4 + 1]) * s;
            let bw = bbox[idx * 4 + 2].exp() * s;
            let bh = bbox[idx * 4 + 3].exp() * s;
            let mut points = [(0.0, 0.0); 5];
            for (n, p) in points.iter_mut().enumerate() {
                *p = (((kps[idx * 10 + 2 * n] + c) * s) / scale, ((kps[idx * 10 + 2 * n + 1] + r) * s) / scale);
            }
            found.push(Detection {
                x: (cx - bw / 2.0) / scale,
                y: (cy - bh / 2.0) / scale,
                w: bw / scale,
                h: bh / scale,
                score,
                kps: points,
            });
        }
    }
    Ok(nms(found))
}

fn nms(mut d: Vec<Detection>) -> Vec<Detection> {
    d.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut keep: Vec<Detection> = Vec::new();
    for c in d {
        if keep.iter().all(|k| iou(k, &c) < NMS_IOU) {
            keep.push(c);
        }
    }
    keep
}

fn iou(a: &Detection, b: &Detection) -> f32 {
    let ix = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
    let iy = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
    if ix <= 0.0 || iy <= 0.0 {
        return 0.0;
    }
    let inter = ix * iy;
    inter / (a.w * a.h + b.w * b.h - inter)
}

// Face Mesh landmark indices (subject's left/right): eye corners, then the
// two upper and two lower eyelid points facing each other.
const LEFT_EYE: [usize; 6] = [362, 263, 385, 380, 387, 373];
const RIGHT_EYE: [usize; 6] = [33, 133, 160, 144, 158, 153];

/// Eye aspect ratios (left, right) of one detected face.
fn eyes(plan: &Plan, img: &RgbImage, d: &Detection) -> TractResult<(f32, f32, Option<f32>)> {
    let pts = mesh(plan, img, d)?.1;
    Ok((ear(&pts, LEFT_EYE), ear(&pts, RIGHT_EYE), smile(&pts)))
}

/// How much a face smiles, 0–1, from the mouth's shape:
/// - width: mouth corners (61, 291) ÷ cheek-to-cheek face width (234, 454) —
///   about 0.34 at rest, 0.45+ in a full smile;
/// - lift: how far the corners sit above the lip centre (13, 14);
/// - teeth: an open mouth on a wide smile (laughing).
///
/// The crop is rotated eyes-level, so "up" is −y. A face turned to profile
/// squashes the width measure; those return None rather than a wrong answer.
fn smile(pts: &[(f32, f32)]) -> Option<f32> {
    let fw = dist(pts[234], pts[454]).max(1e-3);
    let width = dist(pts[61], pts[291]) / fw;
    if width < 0.25 {
        return None;
    }
    let lift = ((pts[13].1 + pts[14].1) / 2.0 - (pts[61].1 + pts[291].1) / 2.0) / fw;
    let open = dist(pts[13], pts[14]) / fw;
    let w = ((width - 0.35) / 0.10).clamp(0.0, 1.0);
    let l = (lift / 0.04).clamp(0.0, 1.0);
    let teeth = if open > 0.04 && width > 0.42 { 0.2 } else { 0.0 };
    Some((w * 0.6 + l * 0.4 + teeth).min(1.0))
}

/// Runs Face Mesh on one face: the 256 px crop it saw, and its 478 points
/// (x, y in crop pixels).
fn mesh(plan: &Plan, img: &RgbImage, d: &Detection) -> TractResult<(RgbImage, Vec<(f32, f32)>)> {
    // MediaPipe's own ROI: a square 1.5× the face box, centred on it and
    // rotated so the eyes are level.
    let (re, le) = (d.kps[0], d.kps[1]);
    let angle = (le.1 - re.1).atan2(le.0 - re.0);
    let (cx, cy) = (d.x + d.w / 2.0, d.y + d.h / 2.0);
    let side = d.w.max(d.h) * 1.5;
    let (sin, cos) = angle.sin_cos();
    let input = tract_ndarray::Array4::from_shape_fn((1, MESH_SIZE, MESH_SIZE, 3), |(_, v, u, ch)| {
        let nx = (u as f32 + 0.5) / MESH_SIZE as f32 - 0.5;
        let ny = (v as f32 + 0.5) / MESH_SIZE as f32 - 0.5;
        let sx = cx + (nx * cos - ny * sin) * side;
        let sy = cy + (nx * sin + ny * cos) * side;
        bilinear(img, sx, sy, ch) / 255.0
    });
    let crop = RgbImage::from_fn(MESH_SIZE as u32, MESH_SIZE as u32, |x, y| {
        let px = |c| (input[[0, y as usize, x as usize, c]] * 255.0) as u8;
        image::Rgb([px(0), px(1), px(2)])
    });
    let out = plan.run(tvec!(Tensor::from(input).into()))?;
    let raw: Vec<f32> = out[0].to_plain_array_view::<f32>()?.iter().copied().collect();
    Ok((crop, raw.chunks(3).map(|c| (c[0], c[1])).collect()))
}

fn dist(a: (f32, f32), b: (f32, f32)) -> f32 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

fn ear(pts: &[(f32, f32)], e: [usize; 6]) -> f32 {
    let width = dist(pts[e[0]], pts[e[1]]).max(1e-3);
    (dist(pts[e[2]], pts[e[3]]) + dist(pts[e[4]], pts[e[5]])) / (2.0 * width)
}

/// A face, the 256 px crop Face Mesh saw, and its points in that crop.
pub type DebugFace = (Face, RgbImage, Vec<(f32, f32)>);

/// Dev aid (`examples/eye_debug.rs`): every face with its crop and points.
pub fn debug(img: &RgbImage) -> Result<Vec<DebugFace>, String> {
    let m = models()?;
    let (w, h) = (img.width() as f32, img.height() as f32);
    let mut out = Vec::new();
    for d in detect(&m.detector, img).map_err(|e| e.to_string())? {
        if d.w.max(d.h) < MIN_FACE_PX {
            continue;
        }
        let (crop, pts) = mesh(&m.mesh, img, &d).map_err(|e| e.to_string())?;
        let face = Face {
            x: d.x / w,
            y: d.y / h,
            w: d.w / w,
            h: d.h / h,
            score: d.score,
            left_eye: ear(&pts, LEFT_EYE),
            right_eye: ear(&pts, RIGHT_EYE),
            smile: smile(&pts),
            sharpness: None,
            px: d.w,
        };
        out.push((face, crop, pts));
    }
    Ok(out)
}

fn bilinear(img: &RgbImage, x: f32, y: f32, ch: usize) -> f32 {
    let (w, h) = (img.width() as i64, img.height() as i64);
    let (x0, y0) = (x.floor() as i64, y.floor() as i64);
    let (fx, fy) = (x - x0 as f32, y - y0 as f32);
    let px = |xx: i64, yy: i64| -> f32 {
        if xx < 0 || yy < 0 || xx >= w || yy >= h { 0.0 } else { img.get_pixel(xx as u32, yy as u32)[ch] as f32 }
    };
    let top = px(x0, y0) * (1.0 - fx) + px(x0 + 1, y0) * fx;
    let bottom = px(x0, y0 + 1) * (1.0 - fx) + px(x0 + 1, y0 + 1) * fx;
    top * (1.0 - fy) + bottom * fy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_load_and_find_nothing_in_a_blank_frame() {
        let blank = RgbImage::from_pixel(800, 600, image::Rgb([128, 128, 128]));
        assert!(analyze(&blank).unwrap().is_empty());
    }

    #[test]
    fn closed_needs_both_eyes() {
        let f = |l, r| Face {
            x: 0.0,
            y: 0.0,
            w: 0.1,
            h: 0.1,
            score: 0.9,
            left_eye: l,
            right_eye: r,
            smile: None,
            sharpness: None,
            px: 100.0,
        };
        assert!(f(0.01, 0.04).eyes_closed());
        assert!(!f(0.04, 0.045).eyes_closed(), "narrow but not sealed");
        assert!(!f(0.08, 0.1).eyes_closed(), "sipit is open");
        assert!(!f(0.01, 0.3).eyes_closed());
        assert!(!f(0.28, 0.3).eyes_closed());
    }
}
