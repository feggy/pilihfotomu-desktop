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
    /// Same pose as `of`, shot again after a pause (not a burst): the
    /// photographer may want only one of them.
    Similar {
        of: u32,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Strictness {
    Loose,
    #[default]
    Balanced,
    Strict,
}

/// What kind of shoot this is. It decides whose eyes and focus matter.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ShootType {
    #[default]
    Auto,
    Wedding,
    Prewedding,
    Lamaran,
    Wisuda,
    Event,
    Keluarga,
    Portrait,
    /// Products, food, places: no people to judge.
    Lainnya,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub strictness: Strictness,
    /// Sessions saved before shoot types mattered don't have the field.
    #[serde(default)]
    pub shoot_type: ShootType,
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
            shoot_type: ShootType::Auto,
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
    /// (series, frame number) from the file name — `IMG_0101` in one folder
    /// is series hash(folder + "IMG_"), frame 101. Groups bursts when the
    /// file has no capture time.
    pub frame: Option<(u64, u32)>,
}

/// Whose face counts, per shoot type.
#[derive(Debug, Clone, Copy)]
struct Profile {
    /// Read faces at all (off for products, food, places).
    faces: bool,
    /// A face at least this share of the largest one is a main subject.
    main_share: f32,
    /// Closed eyes of the other people (guests in the background) count.
    guests: bool,
}

fn profile(t: ShootType) -> Profile {
    match t {
        ShootType::Auto => Profile { faces: true, main_share: 0.4, guests: true },
        // The couple / the person posing matters; guests and passers-by
        // blinking in the background are ignored.
        ShootType::Wedding | ShootType::Lamaran | ShootType::Event | ShootType::Prewedding | ShootType::Portrait => {
            Profile { faces: true, main_share: 0.4, guests: false }
        }
        // Group photos: the grandmother at the edge matters as much as the
        // graduate in the middle, even when her face is smaller.
        ShootType::Wisuda | ShootType::Keluarga => Profile { faces: true, main_share: 0.15, guests: true },
        ShootType::Lainnya => Profile { faces: false, main_share: 0.4, guests: false },
    }
}

/// Closed-eye counts, split into the people the photo is about (faces at
/// least `Profile::main_share` the size of the largest — the couple, the
/// graduate) and everyone else (guests in the background).
#[derive(Debug, Clone, Copy, Default)]
struct Eyes {
    main_closed: u8,
    other_closed: u8,
    /// Main subjects whose smile could be read, and how many of them smile.
    main_read: u8,
    main_smiling: u8,
}

/// Faces at least `share` the size of the largest: the people the photo is about.
fn main_faces(faces: &[Face], share: f32) -> impl Iterator<Item = &Face> {
    let largest = faces.iter().map(|f| f.w * f.h).fold(0.0, f32::max);
    faces.iter().filter(move |f| f.w * f.h >= largest * share)
}

fn eyes(faces: &[Face], share: f32) -> Eyes {
    let largest = faces.iter().map(|f| f.w * f.h).fold(0.0, f32::max);
    let mut e = Eyes::default();
    for f in faces {
        let main = f.w * f.h >= largest * share;
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
/// Without a capture time: consecutive frame numbers, and more alike, since
/// the numbers alone say nothing about the moment.
const BURST_FRAMES: u32 = 2;
const BURST_HAMMING_NO_TIME: u32 = 8;
/// The same pose shot again after a pause: within this long, and far more
/// alike than a burst needs to be (a burst moves, a repeat is posed again).
const SIMILAR_SECONDS: f64 = 90.0;
const SIMILAR_HAMMING: u32 = 6;

pub fn cull(inputs: &[Input], opts: &Options) -> Vec<Verdict> {
    let t = thresholds(opts.strictness);
    let prof = profile(opts.shoot_type);
    let share = prof.main_share;
    let faces: Vec<&[Face]> = inputs.iter().map(|p| if prof.faces { p.faces } else { &[][..] }).collect();
    let mut out: Vec<Verdict> = inputs
        .iter()
        .zip(&faces)
        .map(|(p, &pf)| {
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
            if opts.check_blur && main_faces(pf, share).any(|f| f.soft()) && !reasons.contains(&Reason::Blur) {
                reasons.push(Reason::SubjectSoft);
                if t.reject_eyes {
                    status = Status::Reject;
                } else if status == Status::Pick {
                    status = Status::Maybe;
                }
            }
            if opts.check_eyes {
                let e = eyes(pf, share);
                let closed = e.main_closed + if prof.guests { e.other_closed } else { 0 };
                if closed > 0 {
                    reasons.push(Reason::EyesClosed { closed, faces: pf.len() as u8 });
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
            let open = |i: usize| !opts.check_eyes || eyes(faces[i], share).main_closed == 0;
            let smiles = |i: usize| if opts.check_smile { eyes(faces[i], share).main_smiling } else { 0 };
            // Sharpness that matters is the subject's: when every frame has a
            // readable main face, compare faces (0–100 against the group's
            // sharpest face) — the background may be crisp in all of them.
            let face = |i: usize| subject_sharpness(faces[i]);
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

    if opts.check_duplicates {
        mark_similar(inputs, &faces, &mut out, opts, share);
    }

    for (i, v) in out.iter_mut().enumerate() {
        let smiling = opts.check_smile && eyes(faces[i], share).all_smiling();
        v.rating = match v.status {
            Status::Pick if v.reasons.contains(&Reason::BestInGroup) || smiling => 5,
            Status::Pick => 4,
            Status::Maybe => 3,
            Status::Reject => 1,
        };
    }
    out
}

/// Repeats of the same pose a little later: among photos still in the
/// running (singles and burst keepers), the best of each set stays, the rest
/// are marked `Similar`. Only Strict moves them out of Pick — a repeated pose
/// is often on purpose, with a different expression.
fn mark_similar(inputs: &[Input], faces: &[&[Face]], out: &mut [Verdict], opts: &Options, share: f32) {
    let in_running = |i: usize| {
        out[i].status != Status::Reject && !out[i].reasons.iter().any(|r| matches!(r, Reason::Duplicate { .. }))
    };
    let mut order: Vec<usize> = (0..inputs.len()).filter(|&i| inputs[i].taken_at.is_some() && in_running(i)).collect();
    order.sort_by(|&a, &b| inputs[a].taken_at.unwrap().total_cmp(&inputs[b].taken_at.unwrap()));
    let mut sets: Vec<Vec<usize>> = Vec::new();
    for i in order {
        let t = inputs[i].taken_at.unwrap();
        let home = sets.iter_mut().rev().find(|s| {
            let last = *s.last().unwrap();
            t - inputs[last].taken_at.unwrap() <= SIMILAR_SECONDS
                && out[last].group.is_none_or(|g| out[i].group != Some(g))
                && s.iter().any(|&j| hamming(inputs[i].metrics.dhash, inputs[j].metrics.dhash) <= SIMILAR_HAMMING)
        });
        match home {
            Some(s) => s.push(i),
            None => sets.push(vec![i]),
        }
    }
    let open = |i: usize| !opts.check_eyes || eyes(faces[i], share).main_closed == 0;
    for s in sets.into_iter().filter(|s| s.len() > 1) {
        let best = s
            .iter()
            .copied()
            .max_by(|&a, &b| {
                (out[a].status == Status::Pick)
                    .cmp(&(out[b].status == Status::Pick))
                    .then(open(a).cmp(&open(b)))
                    .then(inputs[a].metrics.sharpness.total_cmp(&inputs[b].metrics.sharpness))
            })
            .unwrap();
        for &i in s.iter().filter(|&&i| i != best) {
            out[i].reasons.push(Reason::Similar { of: inputs[best].id });
            if opts.strictness == Strictness::Strict && out[i].status == Status::Pick {
                out[i].status = Status::Maybe;
            }
        }
    }
}

/// Indices (into `inputs`) of photos that form bursts of 2+ frames: by
/// capture time when the file has one, else by consecutive frame numbers.
fn bursts(inputs: &[Input]) -> Vec<Vec<usize>> {
    let mut order: Vec<usize> = (0..inputs.len()).filter(|&i| inputs[i].taken_at.is_some()).collect();
    order.sort_by(|&a, &b| inputs[a].taken_at.unwrap().total_cmp(&inputs[b].taken_at.unwrap()));
    let mut groups = chain(&order, |prev, i| {
        inputs[i].taken_at.unwrap() - inputs[prev].taken_at.unwrap() <= BURST_SECONDS
            && hamming(inputs[i].metrics.dhash, inputs[prev].metrics.dhash) <= BURST_HAMMING
    });

    let mut untimed: Vec<usize> =
        (0..inputs.len()).filter(|&i| inputs[i].taken_at.is_none() && inputs[i].frame.is_some()).collect();
    untimed.sort_by_key(|&i| inputs[i].frame.unwrap());
    groups.extend(chain(&untimed, |prev, i| {
        let ((sa, na), (sb, nb)) = (inputs[prev].frame.unwrap(), inputs[i].frame.unwrap());
        sa == sb
            && nb.saturating_sub(na) <= BURST_FRAMES
            && hamming(inputs[i].metrics.dhash, inputs[prev].metrics.dhash) <= BURST_HAMMING_NO_TIME
    }));
    groups
}

/// Splits `order` into runs where each item `joins` the one before; keeps runs of 2+.
fn chain(order: &[usize], joins: impl Fn(usize, usize) -> bool) -> Vec<Vec<usize>> {
    let mut groups = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    for &i in order {
        let joined = current.last().is_some_and(|&prev| joins(prev, i));
        if !joined && current.len() > 1 {
            groups.push(std::mem::take(&mut current));
        }
        if !joined {
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
            frame: None,
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
    fn shoot_type_decides_whose_eyes_count() {
        let guest_blink = [face(0.2, 0.3), face(0.08, 0.01)];
        let inputs = [Input { faces: &guest_blink, ..photo(1, 0.0, 80.0, 0) }];
        let with = |shoot_type| cull(&inputs, &Options { shoot_type, ..Options::default() }).remove(0);
        assert_eq!(with(ShootType::Auto).status, Status::Maybe);
        // Wedding: a guest blinking in the background is not the photographer's problem.
        assert_eq!((with(ShootType::Wedding).status, with(ShootType::Wedding).reasons), (Status::Pick, vec![]));
        // Family: the small face at the edge is family too — a main subject.
        let strict = Options { shoot_type: ShootType::Keluarga, strictness: Strictness::Strict, ..Options::default() };
        assert_eq!(cull(&inputs, &strict)[0].status, Status::Reject);
        // Products: faces aren't judged at all.
        let soft = [Face { sharpness: Some(5.0), px: 300.0, ..face(0.2, 0.01) }];
        let inputs = [Input { faces: &soft, ..photo(1, 0.0, 80.0, 0) }];
        let v = cull(&inputs, &Options { shoot_type: ShootType::Lainnya, ..Options::default() });
        assert_eq!((v[0].status, v[0].reasons.clone()), (Status::Pick, vec![]));
    }

    #[test]
    fn groups_bursts_by_frame_number_without_capture_time() {
        let untimed =
            |id, n, sharpness, dhash| Input { taken_at: None, frame: Some((7, n)), ..photo(id, 0.0, sharpness, dhash) };
        let inputs = [
            untimed(1, 101, 70.0, 0b11),
            untimed(2, 102, 90.0, 0b10),
            untimed(3, 110, 80.0, 0b11),                                    // later frame
            Input { frame: Some((8, 103)), ..untimed(4, 103, 60.0, 0b11) }, // other camera
        ];
        let v = cull(&inputs, &Options::default());
        assert_eq!(v[0].reasons, vec![Reason::Duplicate { of: 2 }]);
        assert!(v[1].reasons.contains(&Reason::BestInGroup));
        assert_eq!((v[2].group, v[3].group), (None, None));
    }

    #[test]
    fn repeated_pose_after_a_pause_is_marked_similar() {
        let inputs = [photo(1, 0.0, 70.0, 0b1), photo(2, 30.0, 90.0, 0b11), photo(3, 300.0, 90.0, 0b1)];
        let v = cull(&inputs, &Options::default());
        assert_eq!((v[0].status, v[0].reasons.clone()), (Status::Pick, vec![Reason::Similar { of: 2 }]));
        assert!(v[1].reasons.is_empty() && v[2].reasons.is_empty(), "too far apart");
        let strict = cull(&inputs, &Options { strictness: Strictness::Strict, ..Options::default() });
        assert_eq!(strict[0].status, Status::Maybe);
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
