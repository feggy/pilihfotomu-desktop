//! Faces and whether their eyes are open.
//!
//! Two small ONNX models, run with tract (pure Rust, so nothing native to
//! ship per OS):
//! 1. **YuNet** (OpenCV Zoo, MIT) finds faces and 5 points on each — eyes,
//!    nose, mouth corners.
//! 2. **Face Mesh V2** (Google MediaPipe, Apache-2.0) gives 478 points on a
//!    face crop, eyelids included.
//! 3. **Face Blendshapes** (Google MediaPipe, Apache-2.0) reads 146 of those
//!    points and scores 52 expressions, eyeBlinkLeft/Right among them. It is
//!    trained on many people, so narrow ("sipit"), smiling and downcast eyes
//!    aren't mistaken for blinks the way a cut-off on lid distance is.
//! 4. **SFace** (OpenCV Zoo, Apache-2.0) turns each face into 128 numbers;
//!    faces of the same person land close together. That groups the
//!    session's people, so each person is judged against their own usual
//!    eyes and focus (`assign_people`).
//!
//! All are embedded in the binary; see `models/` and THIRD-PARTY-NOTICES.

use std::io::Cursor;
use std::sync::OnceLock;

use image::RgbImage;
use serde::{Deserialize, Serialize};
use tract_onnx::prelude::*;

type Plan = Arc<TypedRunnableModel>;

static DETECTOR_ONNX: &[u8] = include_bytes!("../models/face_detection_yunet_2023mar.onnx");
static MESH_ONNX: &[u8] = include_bytes!("../models/face_landmarks.onnx");
static BLEND_ONNX: &[u8] = include_bytes!("../models/face_blendshapes.onnx");
static SFACE_ONNX: &[u8] = include_bytes!("../models/face_recognition_sface_2021dec_f16.onnx");

const DET_SIZE: usize = 640;
const MESH_SIZE: usize = 256;
/// YuNet's confidence a box is a face. On a real session (807 photos) half
/// the boxes under 0.7 were hands, cloth, flowers or shadows, and the real
/// ones there were faces turned away or cut off; above 0.8 all were faces.
pub const MIN_SCORE: f32 = 0.7;
/// A box the detector is less sure of than `SURE_SCORE` is dropped when Face
/// Mesh doesn't see a face in it either (presence logit under
/// `MIN_PRESENCE`). On the same session: 219 of 5,965 boxes, a third hands,
/// phones, cloth and shadows, the rest the backs of heads and faces almost
/// hidden; faces still worth judging sat above −3.
const SURE_SCORE: f32 = 0.8;
const MIN_PRESENCE: f32 = -3.0;
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
/// Both blink scores at least this: eyes shut. Open faces of all kinds
/// (narrow, smiling, looking down) scored ≤ 0.52 in the test set; shut ones
/// 0.56–0.84, smiles that close the eyes included.
pub const BLINK_CLOSED: f32 = 0.55;
/// Lids at least this far apart (mean eye aspect ratio) are open, whatever
/// the blink model says. On a real session (807 photos, small faces in
/// groups) the model called 546 faces shut; of the 105 with lids this open
/// almost none were: glasses catching light, eyes looking down a little,
/// faces turned away, and hands or cloth read as faces. Shut and downcast
/// eyes sat below 0.2.
pub const EAR_OPEN: f32 = 0.2;
/// A face's sharpness is only judged when the detector is this sure and the
/// face is whole: faces cut off by the frame or turned away (scored lower)
/// are smooth cheek and hair, and read as "missed focus" while the people
/// the photo is about are sharp — one such face at the edge was the only
/// reading on a sharp group photo.
pub const SHARP_MIN_SCORE: f32 = 0.8;
/// Within this share of the frame's edge a face counts as cut off.
const EDGE: f32 = 0.01;
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
    /// MediaPipe's eyeBlinkLeft / eyeBlinkRight (0 open – 1 shut), learned
    /// from many faces rather than a cut-off on lid distance. Older saved
    /// sessions don't have it.
    #[serde(default)]
    pub blink: Option<(f32, f32)>,
    /// Who this is within the session (same number = same person), from
    /// `assign_people`; None for faces too small to recognise.
    #[serde(default)]
    pub person: Option<u32>,
    /// This person's own blink cut-off, when they appear often enough to
    /// know their usual eyes (`BLINK_CLOSED` otherwise).
    #[serde(default)]
    pub blink_cut: Option<f32>,
    /// This person's usual face sharpness in the session, to compare against
    /// instead of the session's usual face.
    #[serde(default)]
    pub sharp_ref: Option<f32>,
    /// How alike this face is to its person (cosine similarity to their
    /// mean identity vector, from `assign_people`): the lowest are the
    /// likeliest put with the wrong person. None when moved by hand, or for
    /// sessions grouped before it was kept.
    #[serde(default)]
    pub likeness: Option<f32>,
    /// Face Mesh's own "this is a face" logit for the box (its second
    /// output): negative for hands and cloth the detector took for a face.
    /// Older saved sessions don't have it.
    #[serde(default)]
    pub presence: Option<f32>,
}

impl Face {
    /// Both eyes shut. One closed eye is usually a wink or a face turned
    /// away — not the blink photographers cull for. The blink model decides;
    /// lids that are nearly sealed count too, and sessions saved before the
    /// model existed only have that.
    pub fn eyes_closed(&self) -> bool {
        let sealed =
            self.left_eye.max(self.right_eye) < EAR_CLOSED && self.left_eye.min(self.right_eye) < EAR_SEALED;
        let cut = self.blink_cut.unwrap_or(BLINK_CLOSED);
        let open = (self.left_eye + self.right_eye) / 2.0 >= EAR_OPEN;
        sealed || (!open && self.blink.is_some_and(|(l, r)| l.min(r) >= cut))
    }

    /// Sharpness to judge focus by: none for faces cut off by the frame or
    /// unsure detections (`SHARP_MIN_SCORE`).
    pub fn sharp(&self) -> Option<f32> {
        let whole = self.x >= EDGE && self.y >= EDGE && self.x + self.w <= 1.0 - EDGE && self.y + self.h <= 1.0 - EDGE;
        self.sharpness.filter(|_| whole && self.score >= SHARP_MIN_SCORE)
    }

    /// The subject itself is out of focus (even if something else is sharp).
    pub fn soft(&self) -> bool {
        self.px >= SOFT_ALONE_MIN_PX && self.sharp().is_some_and(|v| v < FACE_SOFT)
    }

    pub fn smiling(&self) -> bool {
        self.smile.is_some_and(|s| s >= SMILE)
    }
}

struct Models {
    detector: Plan,
    mesh: Plan,
    blend: Plan,
    sface: Plan,
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
                let blend = tract_onnx::onnx()
                    .model_for_read(&mut Cursor::new(BLEND_ONNX))?
                    .with_input_fact(0, f32::fact([1, BLEND_POINTS.len(), 2]).into())?
                    .into_optimized()?
                    .into_runnable()?;
                let sface = tract_onnx::onnx()
                    .model_for_read(&mut Cursor::new(SFACE_ONNX))?
                    .with_input_fact(0, f32::fact([1, 3, SFACE_SIZE, SFACE_SIZE]).into())?
                    .into_optimized()?
                    .into_runnable()?;
                Ok(Models { detector, mesh, blend, sface })
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

/// A face's identity vector (SFace, 128 numbers); None when too small.
pub type Embedding = Option<Vec<f32>>;

/// Finds the faces in `img` (upright), measures their eyes, and reads who
/// they are (one embedding per face, same order).
pub fn analyze(img: &RgbImage) -> Result<(Vec<Face>, Vec<Embedding>), String> {
    let m = models()?;
    let (w, h) = (img.width() as f32, img.height() as f32);
    let gray = image::DynamicImage::ImageRgb8(img.clone()).to_luma8();
    let mut out = Vec::new();
    let mut ids = Vec::new();
    for d in detect(&m.detector, img).map_err(|e| e.to_string())? {
        if d.w.max(d.h) < MIN_FACE_PX {
            continue;
        }
        let Ok((left_eye, right_eye, smile, blink, presence)) = eyes(m, img, &d) else { continue };
        if d.score < SURE_SCORE && presence < MIN_PRESENCE {
            continue;
        }
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
            blink,
            person: None,
            blink_cut: None,
            sharp_ref: None,
            likeness: None,
            presence: Some(presence),
        });
        ids.push((d.w >= RECOGNISE_MIN_PX).then(|| embed(&m.sface, img, &d).ok()).flatten());
    }
    Ok((out, ids))
}

/// SFace's input side, and where its 5 points sit in it (the ArcFace
/// template: eyes, nose tip, mouth corners, image-left first).
const SFACE_SIZE: usize = 112;
const SFACE_POINTS: [(f32, f32); 5] =
    [(38.2946, 51.6963), (73.5318, 51.5014), (56.0252, 71.7366), (41.5493, 92.3655), (70.7299, 92.2041)];
/// Narrower faces are too small to tell people apart.
const RECOGNISE_MIN_PX: f32 = 50.0;

/// The face aligned onto SFace's template (rotation + scale + shift fitted
/// to YuNet's 5 points), RGB 0–255; the model normalises itself.
fn embed(plan: &Plan, img: &RgbImage, d: &Detection) -> TractResult<Vec<f32>> {
    let input = tract_ndarray::Array4::from_shape_fn((1, 3, SFACE_SIZE, SFACE_SIZE), |(_, c, v, u)| {
        aligned_at(img, d, u as f32, v as f32)[c]
    });
    let out = plan.run(tvec!(Tensor::from(input).into()))?;
    Ok(out[0].to_plain_array_view::<f32>()?.iter().copied().collect())
}

/// RGB at (u, v) of the 112 px aligned face: rotation + scale + shift
/// fitted (least squares) from YuNet's 5 points onto `SFACE_POINTS`.
fn aligned_at(img: &RgbImage, d: &Detection, u: f32, v: f32) -> [f32; 3] {
    let n = 5.0;
    let (smx, smy) = d.kps.iter().fold((0.0, 0.0), |(x, y), p| (x + p.0 / n, y + p.1 / n));
    let (dmx, dmy) = SFACE_POINTS.iter().fold((0.0, 0.0), |(x, y), p| (x + p.0 / n, y + p.1 / n));
    // d = [a −b; b a]·s + t, then inverted for each output pixel.
    let (mut sxx, mut num_a, mut num_b) = (0.0, 0.0, 0.0);
    for (s, t) in d.kps.iter().zip(SFACE_POINTS) {
        let (sx, sy, dx, dy) = (s.0 - smx, s.1 - smy, t.0 - dmx, t.1 - dmy);
        sxx += sx * sx + sy * sy;
        num_a += sx * dx + sy * dy;
        num_b += sx * dy - sy * dx;
    }
    let (a, b) = (num_a / sxx.max(1e-6), num_b / sxx.max(1e-6));
    let det = (a * a + b * b).max(1e-12);
    let (du, dv) = (u - dmx, v - dmy);
    let x = smx + (a * du + b * dv) / det;
    let y = smy + (-b * du + a * dv) / det;
    [bilinear(img, x, y, 0), bilinear(img, x, y, 1), bilinear(img, x, y, 2)]
}

/// Joins a person at or above this cosine similarity to their mean vector.
/// OpenCV publishes 0.363 for telling one pair apart; grouping a whole
/// session greedily needs a stricter bar, or look-alikes chain together.
const SAME_PERSON: f32 = 0.45;
/// Seen this often before their own usual eyes and focus are trusted.
pub const PERSON_MIN: usize = 4;
/// Above a person's usual blink score by this much: shut, for them.
const BLINK_ABOVE_USUAL: f32 = 0.3;

/// Groups the session's faces into people and, for people seen at least
/// `PERSON_MIN` times, sets their own blink cut-off and usual sharpness on
/// each of their faces. `faces`, `ids` and `photo` (which photo each face is
/// in: one person is never twice in the same photo) line up.
pub fn assign_people(faces: &mut [&mut Face], ids: &[Embedding], photo: &[usize]) {
    let unit = |v: &[f32]| {
        let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
        v.iter().map(|x| x / n).collect::<Vec<f32>>()
    };
    // Greedy: each face joins the closest person (by their mean vector) or
    // starts a new one. Bigger faces first: their vectors are the clearest.
    let mut order: Vec<usize> = (0..faces.len()).filter(|&i| ids[i].is_some()).collect();
    order.sort_by(|&a, &b| faces[b].px.total_cmp(&faces[a].px));
    let mut people: Vec<(Vec<f32>, Vec<usize>)> = Vec::new();
    for i in order {
        let v = unit(ids[i].as_ref().unwrap());
        let best = people
            .iter()
            .enumerate()
            .filter(|(_, (_, members))| members.iter().all(|&j| photo[j] != photo[i]))
            .map(|(p, (mean, _))| (p, unit(mean).iter().zip(&v).map(|(a, b)| a * b).sum::<f32>()))
            .filter(|&(_, sim)| sim >= SAME_PERSON)
            .max_by(|a, b| a.1.total_cmp(&b.1));
        match best {
            Some((p, _)) => {
                let (mean, members) = &mut people[p];
                mean.iter_mut().zip(&v).for_each(|(m, x)| *m += x);
                members.push(i);
            }
            None => people.push((v, vec![i])),
        }
    }
    // Numbered by how often they appear: person 0 is the most photographed.
    people.sort_by_key(|(_, members)| std::cmp::Reverse(members.len()));
    for f in faces.iter_mut() {
        (f.person, f.likeness) = (None, None);
    }
    for (p, (mean, members)) in people.iter().enumerate() {
        let mean = unit(mean);
        for &i in members {
            let v = unit(ids[i].as_ref().unwrap());
            faces[i].person = Some(p as u32);
            faces[i].likeness = Some(mean.iter().zip(&v).map(|(a, b)| a * b).sum());
        }
    }
    person_stats(faces);
}

/// Each person's own blink cut-off and usual sharpness, from the faces that
/// are theirs now — after grouping, and again when the photographer merges
/// or splits people.
pub fn person_stats(faces: &mut [&mut Face]) {
    let median = |mut v: Vec<f32>| {
        v.sort_by(f32::total_cmp);
        v[v.len() / 2]
    };
    let mut members: std::collections::HashMap<u32, Vec<usize>> = std::collections::HashMap::new();
    for (i, f) in faces.iter_mut().enumerate() {
        (f.blink_cut, f.sharp_ref) = (None, None);
        if let Some(p) = f.person {
            members.entry(p).or_default().push(i);
        }
    }
    for list in members.values() {
        let blinks: Vec<f32> = list.iter().filter_map(|&i| faces[i].blink.map(|(l, r)| l.min(r))).collect();
        let sharp: Vec<f32> = list.iter().filter_map(|&i| faces[i].sharp()).collect();
        let cut = (blinks.len() >= PERSON_MIN).then(|| (median(blinks) + BLINK_ABOVE_USUAL).clamp(0.45, 0.8));
        let usual = (sharp.len() >= PERSON_MIN).then(|| median(sharp));
        for &i in list {
            faces[i].blink_cut = cut;
            faces[i].sharp_ref = usual;
        }
    }
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

/// Eye aspect ratios (left, right), smile, and blink scores (left, right).
type Reading = (f32, f32, Option<f32>, Option<(f32, f32)>, f32);

/// What one detected face reads as.
fn eyes(m: &Models, img: &RgbImage, d: &Detection) -> TractResult<Reading> {
    let (_, pts, presence) = mesh(&m.mesh, img, d)?;
    Ok((ear(&pts, LEFT_EYE), ear(&pts, RIGHT_EYE), smile(&pts), blink(&m.blend, &pts).ok(), presence))
}

/// Face Mesh points MediaPipe's blendshape model reads (`kLandmarksSubsetIdxs`
/// in mediapipe/tasks/cc/vision/face_landmarker/face_blendshapes_graph.cc).
const BLEND_POINTS: [usize; 146] = [
    0, 1, 4, 5, 6, 7, 8, 10, 13, 14, 17, 21, 33, 37, 39, 40, 46, 52, 53, 54, 55, 58, 61, 63, 65, 66, 67, 70, 78, 80,
    81, 82, 84, 87, 88, 91, 93, 95, 103, 105, 107, 109, 127, 132, 133, 136, 144, 145, 146, 148, 149, 150, 152, 153,
    154, 155, 157, 158, 159, 160, 161, 162, 163, 168, 172, 173, 176, 178, 181, 185, 191, 195, 197, 234, 246, 249,
    251, 263, 267, 269, 270, 276, 282, 283, 284, 285, 288, 291, 293, 295, 296, 297, 300, 308, 310, 311, 312, 314,
    317, 318, 321, 323, 324, 332, 334, 336, 338, 356, 361, 362, 365, 373, 374, 375, 377, 378, 379, 380, 381, 382,
    384, 385, 386, 387, 388, 389, 390, 397, 398, 400, 402, 405, 409, 415, 454, 466, 468, 469, 470, 471, 472, 473,
    474, 475, 476, 477,
];
const EYE_BLINK_LEFT: usize = 9;
const EYE_BLINK_RIGHT: usize = 10;

/// eyeBlinkLeft / eyeBlinkRight. The model centres and scales the points
/// itself, so crop pixels work as well as image pixels.
fn blink(plan: &Plan, pts: &[(f32, f32)]) -> TractResult<(f32, f32)> {
    let input = tract_ndarray::Array3::from_shape_fn((1, BLEND_POINTS.len(), 2), |(_, i, c)| {
        let p = pts[BLEND_POINTS[i]];
        if c == 0 { p.0 } else { p.1 }
    });
    let out = plan.run(tvec!(Tensor::from(input).into()))?;
    let v = out[0].to_plain_array_view::<f32>()?;
    Ok((v[EYE_BLINK_LEFT], v[EYE_BLINK_RIGHT]))
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
/// The crop Face Mesh saw, its points in it, and its face-presence logit.
type MeshRead = (RgbImage, Vec<(f32, f32)>, f32);

fn mesh(plan: &Plan, img: &RgbImage, d: &Detection) -> TractResult<MeshRead> {
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
    let presence = out.get(1).and_then(|t| t.to_plain_array_view::<f32>().ok()?.iter().next().copied()).unwrap_or(0.0);
    Ok((crop, raw.chunks(3).map(|c| (c[0], c[1])).collect(), presence))
}

fn dist(a: (f32, f32), b: (f32, f32)) -> f32 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

fn ear(pts: &[(f32, f32)], e: [usize; 6]) -> f32 {
    let width = dist(pts[e[0]], pts[e[1]]).max(1e-3);
    (dist(pts[e[2]], pts[e[3]]) + dist(pts[e[4]], pts[e[5]])) / (2.0 * width)
}

/// Every face's 478 Face Mesh points, as shares (0–1) of `img` — for Edit
/// foto's people masks (eyes, lips, skin…). The same faces `analyze` keeps.
pub fn landmarks(img: &RgbImage) -> Result<Vec<Vec<(f32, f32)>>, String> {
    let m = models()?;
    let (w, h) = (img.width() as f32, img.height() as f32);
    let mut out = Vec::new();
    for d in detect(&m.detector, img).map_err(|e| e.to_string())? {
        if d.w.max(d.h) < MIN_FACE_PX {
            continue;
        }
        let (_, pts, presence) = mesh(&m.mesh, img, &d).map_err(|e| e.to_string())?;
        if d.score < SURE_SCORE && presence < MIN_PRESENCE {
            continue;
        }
        // Back from the crop Face Mesh saw (see `mesh`) to the picture.
        let (re, le) = (d.kps[0], d.kps[1]);
        let angle = (le.1 - re.1).atan2(le.0 - re.0);
        let (cx, cy) = (d.x + d.w / 2.0, d.y + d.h / 2.0);
        let side = d.w.max(d.h) * 1.5;
        let (sin, cos) = angle.sin_cos();
        out.push(
            pts.iter()
                .map(|&(u, v)| {
                    let (nx, ny) = (u / MESH_SIZE as f32 - 0.5, v / MESH_SIZE as f32 - 0.5);
                    ((cx + (nx * cos - ny * sin) * side) / w, (cy + (nx * sin + ny * cos) * side) / h)
                })
                .collect(),
        );
    }
    Ok(out)
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
        let (crop, pts, presence) = mesh(&m.mesh, img, &d).map_err(|e| e.to_string())?;
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
            blink: blink(&m.blend, &pts).ok(),
            person: None,
            blink_cut: None,
            sharp_ref: None,
            likeness: None,
            presence: Some(presence),
        };
        out.push((face, crop, pts));
    }
    Ok(out)
}

/// Dev aid (`examples/people_debug.rs`): each face aligned for SFace and
/// its vector.
pub fn debug_ids(img: &RgbImage) -> Result<Vec<(RgbImage, Vec<f32>)>, String> {
    let m = models()?;
    let mut out = Vec::new();
    for d in detect(&m.detector, img).map_err(|e| e.to_string())? {
        if d.w < RECOGNISE_MIN_PX {
            continue;
        }
        let v = embed(&m.sface, img, &d).map_err(|e| e.to_string())?;
        let crop = RgbImage::from_fn(SFACE_SIZE as u32, SFACE_SIZE as u32, |u, v| {
            let a = aligned_at(img, &d, u as f32, v as f32);
            image::Rgb([a[0] as u8, a[1] as u8, a[2] as u8])
        });
        out.push((crop, v));
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
        assert!(analyze(&blank).unwrap().0.is_empty());
    }

    #[test]
    fn people_are_grouped_once_per_photo_with_their_own_eyes() {
        let face = |blink: f32| Face {
            x: 0.0,
            y: 0.0,
            w: 0.1,
            h: 0.1,
            score: 0.9,
            left_eye: 0.1,
            right_eye: 0.1,
            smile: None,
            sharpness: Some(100.0),
            px: 120.0,
            blink: Some((blink, blink)),
            person: None,
            blink_cut: None,
            sharp_ref: None,
            likeness: None,
            presence: None,
        };
        let a = |k: f32| Some(vec![1.0, k, 0.0]);
        let b = |k: f32| Some(vec![0.0, k, 1.0]);
        // Five photos of A (narrow eyes: blink 0.45 when open), B in three
        // of them; one more A-like face sits beside A in photo 0.
        let mut faces: Vec<Face> = [0.45, 0.46, 0.44, 0.47, 0.8, 0.2, 0.2, 0.2, 0.3].iter().map(|&k| face(k)).collect();
        let ids = [a(0.0), a(0.1), a(0.05), a(0.02), a(0.08), b(0.0), b(0.1), b(0.05), a(0.03)];
        let photo = [0, 1, 2, 3, 4, 0, 1, 2, 0];
        let mut refs: Vec<&mut Face> = faces.iter_mut().collect();
        assign_people(&mut refs, &ids, &photo);
        let person: Vec<Option<u32>> = faces.iter().map(|f| f.person).collect();
        assert!(person[..5].iter().all(|&p| p == person[0]), "{person:?}");
        assert!(person[5..8].iter().all(|&p| p == person[5]) && person[5] != person[0]);
        assert_ne!(person[8], person[0], "never twice in one photo");
        assert!(faces.iter().all(|f| f.likeness.is_some_and(|l| l > 0.9)), "alike their own person");
        // A's usual blink is 0.46: open at 0.47, shut at 0.8 — for A.
        assert!(!faces[3].eyes_closed() && faces[4].eyes_closed());
        assert_eq!(faces[5].blink_cut, None, "B seen only 3 times: the general cut-off");
    }

    #[test]
    fn closed_needs_both_eyes() {
        let f = |l, r| Face {
            person: None,
            blink_cut: None,
            sharp_ref: None,
            likeness: None,
            presence: None,
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
            blink: None,
        };
        assert!(f(0.01, 0.04).eyes_closed());
        assert!(!f(0.04, 0.045).eyes_closed(), "narrow but not sealed");
        assert!(!f(0.08, 0.1).eyes_closed(), "sipit is open");
        assert!(!f(0.01, 0.3).eyes_closed());
        assert!(!f(0.28, 0.3).eyes_closed());
        let b = |l, r| Face { blink: Some((l, r)), ..f(0.06, 0.05) };
        assert!(b(0.62, 0.68).eyes_closed(), "shut while smiling, lids not sealed");
        assert!(!b(0.44, 0.51).eyes_closed(), "looking down");
        assert!(!b(0.9, 0.2).eyes_closed(), "wink");
        let wide = |l, r| Face { blink: Some((0.93, 0.9)), ..f(l, r) };
        assert!(!wide(0.32, 0.31).eyes_closed(), "lids wide apart: open, whatever the model says");
        assert!(wide(0.12, 0.14).eyes_closed());
    }
}
