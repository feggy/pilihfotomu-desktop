//! Turning measurements into Picks / Maybe / Rejects, with a reason for each.

use serde::{Deserialize, Serialize};

use crate::analyze::{Metrics, hamming};
use crate::faces::Face;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Pick,
    Maybe,
    Reject,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Reason {
    Blur,
    SoftFocus,
    /// The frame is sharp somewhere, but the main subject's face isn't.
    SubjectSoft,
    Dark,
    Bright,
    /// Another frame of the same burst was better.
    Duplicate {
        of: u32,
    },
    /// `closed` of the `faces` found have both eyes shut.
    EyesClosed {
        closed: u8,
        faces: u8,
    },
    BestInGroup,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Strictness {
    Loose,
    #[default]
    Balanced,
    Strict,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub strictness: Strictness,
    pub check_blur: bool,
    pub check_exposure: bool,
    pub check_duplicates: bool,
    /// Sessions saved before eye checks existed don't have the field.
    #[serde(default = "yes")]
    pub check_eyes: bool,
    /// Smiles only ever help: they pick the burst keeper and add a star,
    /// never move a photo to Maybe/Reject.
    #[serde(default = "yes")]
    pub check_smile: bool,
}

fn yes() -> bool {
    true
}

impl Default for Options {
    fn default() -> Self {
        Self {
            strictness: Strictness::Balanced,
            check_blur: true,
            check_exposure: true,
            check_duplicates: true,
            check_eyes: true,
            check_smile: true,
        }
    }
}

/// What culling needs to know about one photo.
#[derive(Debug, Clone, Copy)]
pub struct Input<'a> {
    pub id: u32,
    pub taken_at: Option<f64>,
    pub metrics: Metrics,
    pub faces: &'a [Face],
}

/// Closed-eye counts, split into the people the photo is about (faces at
/// least 40 % the size of the largest — the couple, the graduate) and
/// everyone else (guests in the background).
#[derive(Debug, Clone, Copy, Default)]
struct Eyes {
    main_closed: u8,
    other_closed: u8,
    /// Main subjects whose smile could be read, and how many of them smile.
    main_read: u8,
    main_smiling: u8,
}

/// Faces at least 40 % the size of the largest: the people the photo is about.
fn main_faces(faces: &[Face]) -> impl Iterator<Item = &Face> {
    let largest = faces.iter().map(|f| f.w * f.h).fold(0.0, f32::max);
    faces.iter().filter(move |f| f.w * f.h >= largest * 0.4)
}

fn eyes(faces: &[Face]) -> Eyes {
    let largest = faces.iter().map(|f| f.w * f.h).fold(0.0, f32::max);
    let mut e = Eyes::default();
    for f in faces {
        let main = f.w * f.h >= largest * 0.4;
        if f.eyes_closed() {
            if main {
                e.main_closed += 1;
            } else {
                e.other_closed += 1;
            }
        }
        if main && f.smile.is_some() {
            e.main_read += 1;
            e.main_smiling += f.smiling() as u8;
        }
    }
    e
}

impl Eyes {
    /// Every readable main subject smiles (and there is at least one).
    fn all_smiling(&self) -> bool {
        self.main_read > 0 && self.main_smiling == self.main_read
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    pub id: u32,
    pub status: Status,
    pub rating: u8,
    pub reasons: Vec<Reason>,
    /// Burst this photo belongs to, when it has siblings.
    pub group: Option<u32>,
}

struct Thresholds {
    blur_reject: f32,
    blur_maybe: f32,
    /// Duplicates go to Rejects (true) or stay in Maybe (false).
    reject_duplicates: bool,
    reject_eyes: bool,
}

fn thresholds(s: Strictness) -> Thresholds {
    match s {
        Strictness::Loose => {
            Thresholds { blur_reject: 15.0, blur_maybe: 30.0, reject_duplicates: false, reject_eyes: false }
        }
        Strictness::Balanced => {
            Thresholds { blur_reject: 25.0, blur_maybe: 42.0, reject_duplicates: true, reject_eyes: false }
        }
        Strictness::Strict => {
            Thresholds { blur_reject: 35.0, blur_maybe: 55.0, reject_duplicates: true, reject_eyes: true }
        }
    }
}

/// In a burst, a face under this share of the sharpest face is out of focus.
/// Galvin JPG00932 read 8 against 105–115 for the frames beside it.
const SUBJECT_SOFT_RATIO: f32 = 0.35;

/// Sharpness of the largest face, if it was big enough to read.
fn subject_sharpness(faces: &[Face]) -> Option<f32> {
    faces.iter().max_by(|a, b| (a.w * a.h).total_cmp(&(b.w * b.h))).and_then(|f| f.sharpness)
}

/// Within a burst, frames this close to the sharpest still compete on smiles.
const SHARP_SLACK: f32 = 12.0;

/// Frames this close in time, and this alike, are one burst.
const BURST_SECONDS: f64 = 2.5;
const BURST_HAMMING: u32 = 12;

pub fn cull(inputs: &[Input], opts: &Options) -> Vec<Verdict> {
    let t = thresholds(opts.strictness);
    let mut out: Vec<Verdict> = inputs
        .iter()
        .map(|p| {
            let m = &p.metrics;
            let mut status = Status::Pick;
            let mut reasons = Vec::new();
            if opts.check_blur {
                if m.sharpness < t.blur_reject {
                    status = Status::Reject;
                    reasons.push(Reason::Blur);
                } else if m.sharpness < t.blur_maybe {
                    status = Status::Maybe;
                    reasons.push(Reason::SoftFocus);
                }
            }
            if opts.check_exposure {
                let dark = m.brightness < 35.0 || m.shadows_clipped > 0.45;
                let bright = m.brightness > 225.0 || m.highlights_clipped > 0.30;
                // Near-black frames (lens cap, missed flash) are never worth a look.
                if m.brightness < 12.0 {
                    status = Status::Reject;
                }
                if dark || bright {
                    reasons.push(if dark { Reason::Dark } else { Reason::Bright });
                    if status == Status::Pick {
                        status = Status::Maybe;
                    }
                }
            }
            // Focus on the background, not the person: only main faces big
            // enough to judge (see `faces::SHARP_MIN_PX`).
            if opts.check_blur && main_faces(p.faces).any(|f| f.soft()) && !reasons.contains(&Reason::Blur) {
                reasons.push(Reason::SubjectSoft);
                if t.reject_eyes {
                    status = Status::Reject;
                } else if status == Status::Pick {
                    status = Status::Maybe;
                }
            }
            if opts.check_eyes {
                let e = eyes(p.faces);
                let closed = e.main_closed + e.other_closed;
                if closed > 0 {
                    reasons.push(Reason::EyesClosed { closed, faces: p.faces.len() as u8 });
                    // Eye calls aren't certain (narrow eyes, squints), so they
                    // only reject in Strict; otherwise the photographer decides.
                    if e.main_closed > 0 && t.reject_eyes {
                        status = Status::Reject;
                    } else if status == Status::Pick {
                        status = Status::Maybe;
                    }
                }
            }
            Verdict { id: p.id, status, rating: 0, reasons, group: None }
        })
        .collect();

    if opts.check_duplicates {
        for (gi, group) in bursts(inputs).into_iter().enumerate() {
            // The keeper, among frames not already rejected: everyone's eyes
            // open first; then, among frames about as sharp as the sharpest,
            // the one where most of the main subjects smile; then sharpness.
            let open = |i: usize| !opts.check_eyes || eyes(inputs[i].faces).main_closed == 0;
            let smiles = |i: usize| if opts.check_smile { eyes(inputs[i].faces).main_smiling } else { 0 };
            // Sharpness that matters is the subject's: when every frame has a
            // readable main face, compare faces (0–100 against the group's
            // sharpest face) — the background may be crisp in all of them.
            let face = |i: usize| subject_sharpness(inputs[i].faces);
            let by_face = group.iter().all(|&i| face(i).is_some());
            let best_face = group.iter().filter_map(|&i| face(i)).fold(0.0, f32::max).max(1e-3);
            let sharp = |i: usize| {
                if by_face { face(i).unwrap_or(0.0) / best_face * 100.0 } else { inputs[i].metrics.sharpness }
            };
            let top = group.iter().map(|&i| sharp(i)).fold(0.0, f32::max);
            let sharp_enough = |i: usize| sharp(i) >= top - SHARP_SLACK;
            let best = group
                .iter()
                .copied()
                .filter(|&i| out[i].status != Status::Reject)
                .max_by(|&a, &b| {
                    open(a)
                        .cmp(&open(b))
                        .then(sharp_enough(a).cmp(&sharp_enough(b)))
                        .then(smiles(a).cmp(&smiles(b)))
                        .then(sharp(a).total_cmp(&sharp(b)))
                })
                .unwrap_or(group[0]);
            for &i in &group {
                out[i].group = Some(gi as u32);
                // Far softer face than the same person a moment later: focus missed.
                if opts.check_blur
                    && by_face
                    && sharp(i) < SUBJECT_SOFT_RATIO * 100.0
                    && !out[i].reasons.iter().any(|r| matches!(r, Reason::Blur | Reason::SubjectSoft))
                {
                    out[i].reasons.push(Reason::SubjectSoft);
                }
                if i == best {
                    out[i].reasons.push(Reason::BestInGroup);
                } else if out[i].status != Status::Reject {
                    out[i].reasons.push(Reason::Duplicate { of: inputs[best].id });
                    out[i].status = if t.reject_duplicates { Status::Reject } else { Status::Maybe };
                }
            }
        }
    }

    for (i, v) in out.iter_mut().enumerate() {
        let smiling = opts.check_smile && eyes(inputs[i].faces).all_smiling();
        v.rating = match v.status {
            Status::Pick if v.reasons.contains(&Reason::BestInGroup) || smiling => 5,
            Status::Pick => 4,
            Status::Maybe => 3,
            Status::Reject => 1,
        };
    }
    out
}

/// Indices (into `inputs`) of photos that form bursts of 2+ frames.
fn bursts(inputs: &[Input]) -> Vec<Vec<usize>> {
    let mut order: Vec<usize> = (0..inputs.len()).filter(|&i| inputs[i].taken_at.is_some()).collect();
    order.sort_by(|&a, &b| inputs[a].taken_at.unwrap().total_cmp(&inputs[b].taken_at.unwrap()));
    let mut groups = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    for i in order {
        let joins = current.last().is_some_and(|&prev| {
            inputs[i].taken_at.unwrap() - inputs[prev].taken_at.unwrap() <= BURST_SECONDS
                && hamming(inputs[i].metrics.dhash, inputs[prev].metrics.dhash) <= BURST_HAMMING
        });
        if !joins && current.len() > 1 {
            groups.push(std::mem::take(&mut current));
        }
        if !joins {
            current.clear();
        }
        current.push(i);
    }
    if current.len() > 1 {
        groups.push(current);
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    fn photo(id: u32, t: f64, sharpness: f32, dhash: u64) -> Input<'static> {
        Input {
            id,
            taken_at: Some(t),
            metrics: Metrics { sharpness, brightness: 120.0, shadows_clipped: 0.0, highlights_clipped: 0.0, dhash },
            faces: &[],
        }
    }

    fn face(size: f32, ear: f32) -> Face {
        Face {
            x: 0.1,
            y: 0.1,
            w: size,
            h: size,
            score: 0.9,
            left_eye: ear,
            right_eye: ear,
            smile: Some(0.1),
            sharpness: Some(90.0),
            px: 150.0,
        }
    }

    #[test]
    fn burst_keeper_prefers_a_smile_when_about_as_sharp() {
        let neutral = [face(0.2, 0.3)];
        let smiling = [Face { smile: Some(0.8), ..face(0.2, 0.3) }];
        let inputs =
            [Input { faces: &neutral, ..photo(1, 0.0, 90.0, 0) }, Input { faces: &smiling, ..photo(2, 0.4, 82.0, 0) }];
        let v = cull(&inputs, &Options::default());
        assert!(v[1].reasons.contains(&Reason::BestInGroup));
        assert_eq!(v[1].rating, 5);
        // …but not over a frame whose face is clearly sharper.
        let sharp_neutral = [Face { sharpness: Some(100.0), ..face(0.2, 0.3) }];
        let soft_smiling = [Face { smile: Some(0.8), sharpness: Some(60.0), ..face(0.2, 0.3) }];
        let inputs = [
            Input { faces: &sharp_neutral, ..photo(1, 0.0, 90.0, 0) },
            Input { faces: &soft_smiling, ..photo(2, 0.4, 90.0, 0) },
        ];
        let v = cull(&inputs, &Options::default());
        assert!(v[0].reasons.contains(&Reason::BestInGroup));
    }

    #[test]
    fn soft_subject_on_a_sharp_frame_goes_to_check() {
        let soft = [Face { sharpness: Some(20.0), px: 180.0, ..face(0.2, 0.3) }];
        let inputs = [Input { faces: &soft, ..photo(1, 0.0, 91.0, 0) }];
        let v = cull(&inputs, &Options::default());
        assert_eq!((v[0].status, v[0].reasons.clone()), (Status::Maybe, vec![Reason::SubjectSoft]));
        let strict = cull(&inputs, &Options { strictness: Strictness::Strict, ..Options::default() });
        assert_eq!(strict[0].status, Status::Reject);
    }

    #[test]
    fn burst_keeper_is_the_sharpest_face_not_the_sharpest_frame() {
        // Like Galvin JPG00932–34: background crisp in all, the first misses the face.
        let missed = [Face { sharpness: Some(8.0), ..face(0.2, 0.3) }];
        let hit = [Face { sharpness: Some(110.0), ..face(0.2, 0.3) }];
        let inputs =
            [Input { faces: &missed, ..photo(1, 0.0, 91.0, 0) }, Input { faces: &hit, ..photo(2, 0.5, 78.0, 0) }];
        let v = cull(&inputs, &Options { strictness: Strictness::Loose, ..Options::default() });
        assert!(v[1].reasons.contains(&Reason::BestInGroup));
        assert!(v[0].reasons.contains(&Reason::SubjectSoft));
    }

    #[test]
    fn smile_adds_a_star_but_never_demotes() {
        let smiling = [Face { smile: Some(0.8), ..face(0.2, 0.3) }];
        let neutral = [face(0.2, 0.3)];
        let inputs = [
            Input { faces: &smiling, ..photo(1, 0.0, 80.0, 1) },
            Input { faces: &neutral, ..photo(2, 50.0, 80.0, u64::MAX) },
        ];
        let v = cull(&inputs, &Options::default());
        assert_eq!((v[0].status, v[0].rating), (Status::Pick, 5));
        assert_eq!((v[1].status, v[1].rating), (Status::Pick, 4));
    }

    #[test]
    fn blinking_subject_is_maybe_rejected_only_when_strict() {
        let couple_blink = [face(0.2, 0.3), face(0.2, 0.01)];
        let guest_blink = [face(0.2, 0.3), face(0.05, 0.01)];
        let inputs = [
            Input { faces: &couple_blink, ..photo(1, 0.0, 80.0, 0) },
            Input { faces: &guest_blink, ..photo(2, 100.0, 80.0, u64::MAX) },
        ];
        let v = cull(&inputs, &Options::default());
        assert_eq!(v[0].status, Status::Maybe, "balanced never rejects on eyes alone");
        assert_eq!(v[0].reasons, vec![Reason::EyesClosed { closed: 1, faces: 2 }]);
        assert_eq!(v[1].status, Status::Maybe);
        let strict = cull(&inputs, &Options { strictness: Strictness::Strict, ..Options::default() });
        assert_eq!(strict[0].status, Status::Reject);
        assert_eq!(strict[1].status, Status::Maybe);
    }

    #[test]
    fn burst_keeper_has_eyes_open_even_if_slightly_softer() {
        let blink = [face(0.2, 0.01)];
        let open = [face(0.2, 0.3)];
        let inputs =
            [Input { faces: &blink, ..photo(1, 0.0, 90.0, 0) }, Input { faces: &open, ..photo(2, 0.4, 75.0, 0) }];
        let v = cull(&inputs, &Options { strictness: Strictness::Loose, ..Options::default() });
        assert!(v[1].reasons.contains(&Reason::BestInGroup));
        assert_ne!(v[0].status, Status::Pick);
    }

    #[test]
    fn keeps_sharpest_of_a_burst_and_rejects_the_rest() {
        let inputs = [
            photo(1, 0.0, 70.0, 0b1111),
            photo(2, 0.4, 90.0, 0b1110),
            photo(3, 0.8, 60.0, 0b1111),
            photo(4, 30.0, 80.0, u64::MAX), // different moment
        ];
        let v = cull(&inputs, &Options::default());
        assert_eq!(v[1].status, Status::Pick);
        assert!(v[1].reasons.contains(&Reason::BestInGroup));
        assert_eq!(v[1].rating, 5);
        assert_eq!(v[0].status, Status::Reject);
        assert_eq!(v[0].reasons, vec![Reason::Duplicate { of: 2 }]);
        assert_eq!(v[2].group, v[1].group);
        assert_eq!(v[3].group, None);
        assert_eq!(v[3].status, Status::Pick);
    }

    #[test]
    fn loose_keeps_duplicates_as_maybe() {
        let inputs = [photo(1, 0.0, 70.0, 0), photo(2, 0.5, 90.0, 0)];
        let v = cull(&inputs, &Options { strictness: Strictness::Loose, ..Options::default() });
        assert_eq!(v[0].status, Status::Maybe);
    }

    #[test]
    fn blur_and_dark_frames() {
        let mut dark = photo(2, 100.0, 80.0, 1);
        dark.metrics.brightness = 20.0;
        let inputs = [photo(1, 0.0, 10.0, 0), dark];
        let v = cull(&inputs, &Options::default());
        assert_eq!((v[0].status, v[0].reasons.clone()), (Status::Reject, vec![Reason::Blur]));
        assert_eq!((v[1].status, v[1].reasons.clone()), (Status::Maybe, vec![Reason::Dark]));
    }
}
