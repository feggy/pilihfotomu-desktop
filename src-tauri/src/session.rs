//! A session is one folder that has been culled: its photos, their
//! measurements, the AI's verdicts and the photographer's corrections. It is
//! saved as JSON so reopening a session doesn't analyze it again.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use image::ImageEncoder;
use image::codecs::jpeg::JpegEncoder;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::analyze::{self, Metrics};
use crate::cull::{self, Input, Options, Reason, Status, Verdict};
use crate::faces::{self, Face};
use crate::preview;
use crate::scan::{self, Photo};

/// Long edge the preview is measured at. Larger catches finer focus misses
/// but costs decode time; 1024 keeps eyelashes-level detail on a 24 MP shot.
const ANALYZE_SIDE: u32 = 1024;
const THUMB_SIDE: u32 = 640;
/// Preview size faces are read at: eyelids of a guest in a group shot
/// still span enough pixels.
const FACE_SIDE: u32 = 2048;
/// The loupe view: sharp on a 4K/Retina screen without decoding full size.
const PREVIEW_SIDE: u32 = 2048;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    #[serde(flatten)]
    pub photo: Photo,
    pub name: String,
    pub thumb: Option<PathBuf>,
    pub taken_at: Option<f64>,
    /// Camera body from EXIF; older saved sessions don't have it.
    #[serde(default)]
    pub camera: Option<String>,
    pub metrics: Option<Metrics>,
    /// Faces found, with how open their eyes are.
    #[serde(default)]
    pub faces: Vec<Face>,
    /// Why the file couldn't be analyzed, if it couldn't.
    pub error: Option<String>,
    pub status: Status,
    pub rating: u8,
    pub reasons: Vec<Reason>,
    pub group: Option<u32>,
    /// What the AI decided, kept when the photographer overrides `status`.
    pub auto_status: Status,
    /// The AI's stars. Older saved sessions don't have it.
    #[serde(default)]
    pub auto_rating: Option<u8>,
    /// The photographer set status or stars by hand. Re-culling with other
    /// settings leaves these photos as they are.
    #[serde(default)]
    pub manual: bool,
}

impl Entry {
    /// Changed by hand (sessions saved before `manual` existed only show it
    /// as a status different from the AI's).
    pub fn is_manual(&self) -> bool {
        self.manual || self.status != self.auto_status
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub root: PathBuf,
    pub name: String,
    pub created_at: u64,
    pub duration_ms: u64,
    pub options: Options,
    /// Folders that were analyzed, each on its own ("" = the session folder
    /// itself, "Canon/jpg" = a nested one). Sessions saved before nested
    /// folders could be chosen hold top folders only.
    #[serde(default = "root_only")]
    pub folders: Vec<String>,
    pub exported: bool,
    pub photos: Vec<Entry>,
    /// Names the photographer gave people (`Face::person`). Grouping the
    /// faces again numbers people anew, so it clears them.
    #[serde(default)]
    pub people: std::collections::BTreeMap<u32, String>,
    /// Which version of the face rules the saved verdicts follow (`RULES`).
    #[serde(default)]
    pub rules: u32,
}

/// The face rules now: 1 = face boxes from 0.7 (`faces::MIN_SCORE`) and
/// open lids overruling the blink model (`faces::EAR_OPEN`); 2 = focus judged
/// on whole, sure faces only (`Face::sharp`).
pub const RULES: u32 = 2;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub root: PathBuf,
    pub name: String,
    pub created_at: u64,
    pub duration_ms: u64,
    pub exported: bool,
    pub total: u32,
    pub picks: u32,
    pub maybe: u32,
    pub rejects: u32,
    /// Up to three Pick thumbnails for the session list.
    pub covers: Vec<PathBuf>,
    /// The settings the photos were judged with, shown on the session card.
    pub options: Options,
    /// The session folder is reachable right now (an external drive may be
    /// unplugged — the session itself is still fine).
    pub available: bool,
}

impl Session {
    pub fn summary(&self) -> Summary {
        let count = |s| self.photos.iter().filter(|p| p.status == s).count() as u32;
        Summary {
            id: self.id.clone(),
            root: self.root.clone(),
            name: self.name.clone(),
            created_at: self.created_at,
            duration_ms: self.duration_ms,
            exported: self.exported,
            available: self.root.is_dir(),
            total: self.photos.len() as u32,
            picks: count(Status::Pick),
            maybe: count(Status::Maybe),
            rejects: count(Status::Reject),
            options: self.options,
            covers: self
                .photos
                .iter()
                .filter(|p| p.status == Status::Pick)
                .filter_map(|p| p.thumb.clone())
                .take(3)
                .collect(),
        }
    }

    pub fn set_status(&mut self, ids: &[u32], status: Status) {
        for e in self.photos.iter_mut().filter(|e| ids.contains(&e.photo.id)) {
            e.manual = true;
            e.status = status;
            e.rating = match status {
                Status::Pick => e.rating.max(4),
                Status::Maybe => 3,
                Status::Reject => 1,
            };
        }
    }

    /// Puts exact status + stars back (undo / redo).
    pub fn set_marks(&mut self, marks: &[Mark]) {
        for m in marks {
            if let Some(e) = self.photos.iter_mut().find(|e| e.photo.id == m.id) {
                e.status = m.status;
                e.rating = m.rating.min(5);
                // Undoing back to the AI's own verdict makes it the AI's again.
                e.manual = e.status != e.auto_status || e.auto_rating.is_some_and(|r| r != e.rating);
            }
        }
    }

    /// Stars 0–5, as the photographer sets them; status stays as it is.
    pub fn set_rating(&mut self, ids: &[u32], rating: u8) {
        for e in self.photos.iter_mut().filter(|e| ids.contains(&e.photo.id)) {
            e.manual = true;
            e.rating = rating.min(5);
        }
    }

    /// Decides again with other settings, from the measurements already
    /// saved — no file is read. Photos changed by hand keep their status and
    /// stars; their reasons and groups are updated. Face checks can only use
    /// faces that were read in the first analysis.
    pub fn recull(&mut self, options: Options) {
        let inputs: Vec<Input> = self.photos.iter().filter_map(input_of).collect();
        let mut out = cull::cull(&inputs, &Options { limit: None, ..options });
        // Picks made by hand fill places among the N first.
        if let Some(n) = options.limit {
            let held: std::collections::HashSet<u32> =
                self.photos.iter().filter(|e| e.is_manual()).map(|e| e.photo.id).collect();
            let hand_picked = self.photos.iter().filter(|e| e.is_manual() && e.status == Status::Pick).count() as u32;
            cull::keep_best(&inputs, &mut out, &options, n.saturating_sub(hand_picked), |id| held.contains(&id));
        }
        let mut verdicts: std::collections::HashMap<u32, Verdict> = out.into_iter().map(|v| (v.id, v)).collect();
        drop(inputs);
        for e in &mut self.photos {
            // Unreadable files have nothing to decide from.
            let Some(v) = verdicts.remove(&e.photo.id) else { continue };
            // Decided before the status changes: a new AI verdict differs
            // from the old `auto_status`, which isn't a change by hand.
            let manual = e.is_manual();
            if !manual {
                e.status = v.status;
                e.rating = v.rating;
            }
            e.manual = manual;
            e.reasons = v.reasons;
            e.group = v.group;
            e.auto_status = v.status;
            e.auto_rating = Some(v.rating);
        }
        self.options = options;
    }
}

/// One photo's faces read again: its id, the faces, their identity vectors.
pub type FacesRead = (u32, Vec<Face>, Vec<faces::Embedding>);

/// Faces read again for every photo of `s` (sessions analyzed before blink
/// scores and people existed), by photo id; files that can't be read are
/// left out. Nothing in `s` changes: `Session::set_faces` applies it.
pub fn read_faces(
    s: &Session,
    cancel: &AtomicBool,
    progress: impl Fn(u32, u32) + Sync,
) -> Result<Vec<FacesRead>, SessionError> {
    faces::ready().map_err(SessionError::Faces)?;
    let total = s.photos.iter().filter(|e| e.metrics.is_some()).count() as u32;
    let done = AtomicU32::new(0);
    let read: Vec<_> = s
        .photos
        .par_iter()
        .filter(|e| e.metrics.is_some())
        .filter_map(|e| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let loaded = preview::load(e.photo.source(), FACE_SIDE).ok();
            progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);
            let (faces, ids) = faces::analyze(&loaded?.image.to_rgb8()).unwrap_or_default();
            Some((e.photo.id, faces, ids))
        })
        .collect();
    if cancel.load(Ordering::Relaxed) {
        return Err(SessionError::Cancelled);
    }
    Ok(read)
}

impl Session {
    /// Puts faces from `read_faces` in, groups the people again and decides
    /// again with the current settings (hand-made changes stay).
    pub fn set_faces(&mut self, read: Vec<FacesRead>) {
        let mut ids: std::collections::HashMap<u32, Vec<faces::Embedding>> = std::collections::HashMap::new();
        for (id, faces, embeddings) in read {
            if let Some(e) = self.photos.iter_mut().find(|e| e.photo.id == id) {
                e.faces = faces;
                ids.insert(id, embeddings);
            }
        }
        // Faces and their vectors lined up, photo by photo; photos not read
        // again have no vectors (they join nobody).
        let mut all: Vec<&mut Face> = Vec::new();
        let mut vectors: Vec<faces::Embedding> = Vec::new();
        let mut photo: Vec<usize> = Vec::new();
        for (i, e) in self.photos.iter_mut().enumerate() {
            let mut v = ids.remove(&e.photo.id).unwrap_or_default();
            v.resize(e.faces.len(), None);
            vectors.extend(v);
            photo.extend(std::iter::repeat_n(i, e.faces.len()));
            all.extend(e.faces.iter_mut());
        }
        faces::assign_people(&mut all, &vectors, &photo);
        self.people.clear();
        let options = self.options;
        self.recull(options);
    }

    /// A session saved under older face rules brought up to date: boxes that
    /// are no longer counted as faces dropped, people's cut-offs and the
    /// verdicts worked out again (hand-made changes stay). Whether it changed.
    pub fn upgrade(&mut self) -> bool {
        if self.rules >= RULES {
            return false;
        }
        for e in &mut self.photos {
            e.faces.retain(|f| f.score >= faces::MIN_SCORE);
        }
        self.rules = RULES;
        self.people_changed();
        true
    }

    /// Names a person; an empty name takes it away.
    pub fn name_person(&mut self, person: u32, name: &str) {
        let name = name.trim();
        if name.is_empty() {
            self.people.remove(&person);
        } else {
            self.people.insert(person, name.to_string());
        }
    }

    /// `from` is the same person as `into`: their faces become `into`'s
    /// (keeping `into`'s name, or taking `from`'s when `into` has none).
    pub fn merge_people(&mut self, from: u32, into: u32) {
        if from == into {
            return;
        }
        for f in self.photos.iter_mut().flat_map(|e| e.faces.iter_mut()) {
            if f.person == Some(from) {
                f.person = Some(into);
            }
        }
        if let Some(name) = self.people.remove(&from) {
            self.people.entry(into).or_insert(name);
        }
        self.people_changed();
    }

    /// Faces (photo id, index of the face) that were put with the wrong
    /// person: moved to `to`, or to a new person of their own; that person.
    pub fn move_faces(&mut self, faces: &[(u32, usize)], to: Option<u32>) -> u32 {
        let to = to.unwrap_or_else(|| {
            self.photos.iter().flat_map(|e| e.faces.iter()).filter_map(|f| f.person).max().map_or(0, |m| m + 1)
        });
        for &(id, i) in faces {
            if let Some(f) = self.photos.iter_mut().find(|e| e.photo.id == id).and_then(|e| e.faces.get_mut(i)) {
                f.person = Some(to);
            }
        }
        self.people_changed();
        to
    }

    /// Who is who changed: each person's own cut-offs are worked out again,
    /// and the photos decided again with them (hand-made changes stay).
    fn people_changed(&mut self) {
        let mut all: Vec<&mut Face> = self.photos.iter_mut().flat_map(|e| e.faces.iter_mut()).collect();
        faces::person_stats(&mut all);
        let options = self.options;
        self.recull(options);
    }
}

fn input_of(e: &Entry) -> Option<Input<'_>> {
    e.metrics.map(|metrics| Input {
        id: e.photo.id,
        taken_at: e.taken_at,
        metrics,
        faces: &e.faces,
        frame: e.photo.frame(),
    })
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Mark {
    pub id: u32,
    pub status: Status,
    pub rating: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event")]
pub enum Progress {
    Started {
        total: u32,
    },
    Photo {
        done: u32,
        total: u32,
        id: u32,
        name: String,
        thumb: Option<PathBuf>,
        status: Status,
        reason: Option<Reason>,
    },
    Grouping,
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error(transparent)]
    Scan(#[from] scan::ScanError),
    #[error("Folder ini tidak berisi foto RAW atau JPEG.")]
    Empty,
    #[error("Dibatalkan.")]
    Cancelled,
    #[error("Deteksi mata tidak bisa dijalankan: {0}")]
    Faces(String),
    #[error("Gagal menyimpan sesi: {0}")]
    Io(#[from] std::io::Error),
    #[error("Gagal menyimpan sesi: {0}")]
    Json(#[from] serde_json::Error),
}

/// Stable id for a folder path (FNV-1a; std's hasher may change between
/// Rust versions, and these ids name files on disk).
fn root_only() -> Vec<String> {
    vec![String::new()]
}

pub fn id_for(root: &Path) -> String {
    format!("{:016x}", scan::fnv(root.to_string_lossy().as_bytes()))
}

/// One photo after the pixel pass.
struct Measured {
    photo: Photo,
    info: Option<preview::ShotInfo>,
    metrics: Option<Metrics>,
    faces: Vec<Face>,
    ids: Vec<faces::Embedding>,
    thumb: Option<PathBuf>,
    error: Option<String>,
}

pub fn analyze(
    root: &Path,
    folders: &[String],
    options: Options,
    thumbs_dir: &Path,
    cancel: &AtomicBool,
    progress: impl Fn(Progress) + Sync,
) -> Result<Session, SessionError> {
    let started = Instant::now();
    let photos = scan::select(scan::scan(root)?, folders);
    if photos.is_empty() {
        return Err(SessionError::Empty);
    }
    // Fail once, up front, rather than silently finding no faces anywhere.
    if options.check_eyes || options.check_smile {
        faces::ready().map_err(SessionError::Faces)?;
    }
    let id = id_for(root);
    let thumbs = thumbs_dir.join(&id);
    fs::create_dir_all(&thumbs)?;

    let total = photos.len() as u32;
    progress(Progress::Started { total });
    let done = AtomicU32::new(0);
    // Eyelids need more pixels than focus does: faces are read from a
    // larger preview, everything else from the usual analysis size.
    let load_side = if options.check_eyes || options.check_smile { FACE_SIDE } else { ANALYZE_SIDE };

    let measured: Vec<Measured> = photos
        .into_par_iter()
        .map(|photo| {
            let mut m = Measured { photo, info: None, metrics: None, faces: vec![], ids: vec![], thumb: None, error: None };
            if cancel.load(Ordering::Relaxed) {
                m.error = Some("cancelled".into());
                return m;
            }
            match preview::load(m.photo.source(), load_side) {
                Ok(loaded) => {
                    let small = if loaded.image.width().max(loaded.image.height()) > ANALYZE_SIDE {
                        loaded.image.thumbnail(ANALYZE_SIDE, ANALYZE_SIDE)
                    } else {
                        loaded.image.clone()
                    };
                    m.metrics = Some(analyze::measure(&small));
                    if options.check_eyes || options.check_smile {
                        // A face the models can't read counts as no face.
                        (m.faces, m.ids) = faces::analyze(&loaded.image.to_rgb8()).unwrap_or_default();
                    }
                    let thumb_path = thumbs.join(format!("{}.jpg", m.photo.cache_key()));
                    m.thumb = save_thumb(&small, &thumb_path).ok().map(|_| thumb_path);
                    m.info = Some(loaded.info);
                }
                Err(e) => m.error = Some(e.to_string()),
            }
            // A first opinion from this photo alone; bursts are judged once
            // every frame is in.
            let early = m.metrics.map(|metrics| {
                cull::cull(&[Input { id: m.photo.id, taken_at: None, metrics, faces: &m.faces, frame: None }], &options)
                    .remove(0)
            });
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            progress(Progress::Photo {
                done: n,
                total,
                id: m.photo.id,
                name: m.photo.display_name(),
                thumb: m.thumb.clone(),
                status: early.as_ref().map_or(Status::Maybe, |v| v.status),
                reason: early.and_then(|v| v.reasons.first().copied()),
            });
            m
        })
        .collect();

    if cancel.load(Ordering::Relaxed) {
        return Err(SessionError::Cancelled);
    }
    progress(Progress::Grouping);
    let mut measured = measured;
    {
        let ids: Vec<faces::Embedding> = measured.iter_mut().flat_map(|m| std::mem::take(&mut m.ids)).collect();
        let photo: Vec<usize> = measured.iter().enumerate().flat_map(|(i, m)| std::iter::repeat_n(i, m.faces.len())).collect();
        let mut all: Vec<&mut Face> = measured.iter_mut().flat_map(|m| m.faces.iter_mut()).collect();
        faces::assign_people(&mut all, &ids, &photo);
    }

    let inputs: Vec<Input> = measured
        .iter()
        .filter_map(|m| {
            m.metrics.map(|metrics| Input {
                id: m.photo.id,
                taken_at: m.info.as_ref().and_then(|i| i.taken_at),
                metrics,
                faces: &m.faces,
                frame: m.photo.frame(),
            })
        })
        .collect();
    let mut verdicts: std::collections::HashMap<u32, Verdict> =
        cull::cull(&inputs, &options).into_iter().map(|v| (v.id, v)).collect();
    drop(inputs);

    let entries = measured
        .into_iter()
        .map(|m| {
            // Unreadable files land in Maybe: the photographer decides.
            let v = verdicts.remove(&m.photo.id).unwrap_or(Verdict {
                id: m.photo.id,
                status: Status::Maybe,
                rating: 3,
                reasons: vec![],
                group: None,
            });
            let auto_rating = m.metrics.is_some().then_some(v.rating);
            Entry {
                name: m.photo.display_name(),
                photo: m.photo,
                thumb: m.thumb,
                taken_at: m.info.as_ref().and_then(|i| i.taken_at),
                camera: m.info.and_then(|i| i.camera),
                metrics: m.metrics,
                faces: m.faces,
                error: m.error,
                status: v.status,
                rating: v.rating,
                reasons: v.reasons,
                group: v.group,
                auto_status: v.status,
                auto_rating,
                manual: false,
            }
        })
        .collect();

    Ok(Session {
        id,
        name: root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| root.display().to_string()),
        root: root.to_path_buf(),
        created_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        duration_ms: started.elapsed().as_millis() as u64,
        options,
        folders: folders.to_vec(),
        exported: false,
        photos: entries,
        people: Default::default(),
        rules: RULES,
    })
}

/// Thumbnail for one file outside an analysis (client picks on a folder
/// that was never culled).
/// Makes again the thumbnails of `s` whose files are gone (the cache was
/// cleared, by the app or by macOS) from the photos themselves; how many.
/// Photos whose files can't be read stay without one.
pub fn restore_thumbs(s: &Session) -> usize {
    let gone: Vec<_> = s
        .photos
        .iter()
        .filter_map(|e| e.thumb.as_ref().filter(|t| !t.exists()).map(|t| (e.photo.source(), t)))
        .collect();
    if let Some(dir) = gone.first().and_then(|(_, t)| t.parent()) {
        let _ = fs::create_dir_all(dir);
    }
    gone.par_iter().filter(|(src, t)| src.is_file() && make_thumb(src, t).is_ok()).count()
}

pub fn make_thumb(source: &Path, path: &Path) -> Result<(), String> {
    let loaded = preview::load(source, THUMB_SIDE).map_err(|e| e.to_string())?;
    save_thumb(&loaded.image, path).map_err(|e| e.to_string())
}

/// A large preview for the loupe view, made the first time a photo is opened there.
pub fn make_preview(source: &Path, path: &Path) -> Result<(), String> {
    let loaded = preview::load(source, PREVIEW_SIDE).map_err(|e| e.to_string())?;
    save_jpeg(&loaded.image, path, PREVIEW_SIDE, 88).map_err(|e| e.to_string())
}

fn save_thumb(img: &image::DynamicImage, path: &Path) -> Result<(), image::ImageError> {
    save_jpeg(img, path, THUMB_SIDE, 82)
}

fn save_jpeg(img: &image::DynamicImage, path: &Path, side: u32, quality: u8) -> Result<(), image::ImageError> {
    let small = if img.width().max(img.height()) > side { img.thumbnail(side, side) } else { img.clone() };
    let rgb = small.to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality).write_image(
        &rgb,
        rgb.width(),
        rgb.height(),
        image::ExtendedColorType::Rgb8,
    )?;
    fs::write(path, out)?;
    Ok(())
}

// ── Storage ────────────────────────────────────────────────────────────

pub fn save(dir: &Path, s: &Session) -> Result<(), SessionError> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{}.json.tmp", s.id));
    fs::write(&tmp, serde_json::to_vec(s)?)?;
    fs::rename(tmp, dir.join(format!("{}.json", s.id)))?;
    Ok(())
}

pub fn load(dir: &Path, id: &str) -> Option<Session> {
    // Ids are hex; anything else is not a file this app wrote.
    if !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    serde_json::from_slice(&fs::read(dir.join(format!("{id}.json"))).ok()?).ok()
}

#[derive(Debug, thiserror::Error)]
pub enum RelinkError {
    #[error(transparent)]
    Scan(#[from] scan::ScanError),
    #[error(
        "Folder ini sepertinya bukan sesi yang sama: hanya {found} dari {total} foto yang namanya cocok. Pilih folder lain."
    )]
    Mismatch { found: usize, total: usize },
    #[error(transparent)]
    Save(#[from] SessionError),
}

/// Share of the session's photos that must be found by name in the new
/// folder. Some may have been deleted since; a different shoot won't get close.
const RELINK_MATCH: f32 = 0.8;

/// Points a session at the folder it was moved to. Photos are matched by
/// subfolder + file name; everything decided about them (status, stars,
/// reasons, groups) carries over and ids are remapped to the new scan.
/// Returns the new session (its id changes with its folder); the old one is
/// removed and its thumbnails moved along.
pub fn relink(sessions_dir: &Path, thumbs_dir: &Path, mut s: Session, new_root: &Path) -> Result<Session, RelinkError> {
    let key = |folder: &str, stem: &str| (folder.to_string(), stem.to_lowercase());
    let fresh: std::collections::HashMap<_, Photo> =
        scan::scan(new_root)?.into_iter().map(|p| (key(&p.folder, &p.stem), p)).collect();
    let found = s.photos.iter().filter(|e| fresh.contains_key(&key(&e.photo.folder, &e.photo.stem))).count();
    if (found as f32) < s.photos.len() as f32 * RELINK_MATCH {
        return Err(RelinkError::Mismatch { found, total: s.photos.len() });
    }

    let old_id = s.id.clone();
    let new_id = id_for(new_root);
    let (old_thumbs, new_thumbs) = (thumbs_dir.join(&old_id), thumbs_dir.join(&new_id));
    if old_thumbs.is_dir() && !new_thumbs.exists() {
        let _ = fs::rename(&old_thumbs, &new_thumbs);
    }

    let mut ids = std::collections::HashMap::new();
    s.photos.retain_mut(|e| {
        let Some(p) = fresh.get(&key(&e.photo.folder, &e.photo.stem)) else { return false };
        ids.insert(e.photo.id, p.id);
        e.photo = p.clone();
        e.thumb = e.thumb.as_ref().and_then(|t| t.file_name()).map(|n| new_thumbs.join(n)).filter(|t| t.exists());
        true
    });
    for e in &mut s.photos {
        for r in &mut e.reasons {
            if let Reason::Duplicate { of } | Reason::Similar { of } = r {
                *of = ids.get(of).copied().unwrap_or(*of);
            }
        }
    }
    s.name = new_root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(s.name);
    s.root = new_root.to_path_buf();
    s.id = new_id;
    save(sessions_dir, &s)?;
    if s.id != old_id {
        let _ = fs::remove_file(sessions_dir.join(format!("{old_id}.json")));
    }
    Ok(s)
}

/// Forgets a session: its saved results and its cached pictures. The
/// photos, XMP sidecars and copied folders are the photographer's files and
/// are never touched.
pub fn delete(sessions_dir: &Path, cache_dirs: &[PathBuf], id: &str) -> Result<(), SessionError> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(());
    }
    match fs::remove_file(sessions_dir.join(format!("{id}.json"))) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
        _ => {}
    }
    for dir in cache_dirs {
        let _ = fs::remove_dir_all(dir.join(id));
    }
    Ok(())
}

pub fn list(dir: &Path) -> Vec<Summary> {
    let Ok(entries) = fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<Summary> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_slice::<Session>(&fs::read(e.path()).ok()?).ok())
        .map(|s| s.summary())
        .collect();
    out.sort_by_key(|s| std::cmp::Reverse(s.created_at));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GrayImage, Luma, RgbImage, imageops};

    fn save_jpeg(path: &Path, img: &GrayImage) {
        let rgb = RgbImage::from_fn(img.width(), img.height(), |x, y| {
            let v = img.get_pixel(x, y)[0];
            image::Rgb([v, v, v])
        });
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, 90)
            .write_image(&rgb, rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
            .unwrap();
        fs::write(path, out).unwrap();
    }

    #[test]
    fn people_are_named_merged_and_split_by_hand() {
        let tmp = tempfile::tempdir().unwrap();
        let shots = tmp.path().join("shoot");
        fs::create_dir(&shots).unwrap();
        let img = GrayImage::from_fn(300, 200, |x, y| Luma([if (x / 6 + y / 6) % 2 == 0 { 40 } else { 210 }]));
        for i in 0..5 {
            save_jpeg(&shots.join(format!("IMG_000{i}.JPG")), &img);
        }
        let cancel = AtomicBool::new(false);
        let mut s = analyze(&shots, &["".into()], Options::default(), &tmp.path().join("thumbs"), &cancel, |_| {}).unwrap();
        let face = |person: u32, blink: f32| Face {
            x: 0.1, y: 0.1, w: 0.2, h: 0.2, score: 0.9, left_eye: 0.3, right_eye: 0.3, smile: None,
            sharpness: Some(90.0), px: 150.0, blink: Some((blink, blink)), person: Some(person), blink_cut: None, sharp_ref: None,
        };
        // Four photos of person 0, the fifth taken for someone else (person 1).
        for (i, e) in s.photos.iter_mut().enumerate() {
            e.faces = vec![face(if i < 4 { 0 } else { 1 }, 0.1)];
        }
        let person = |s: &Session, i: usize| s.photos[i].faces[0].person;

        s.name_person(1, " Rina ");
        assert_eq!(s.people.get(&1).map(String::as_str), Some("Rina"));
        s.merge_people(1, 0);
        assert!((0..5).all(|i| person(&s, i) == Some(0)));
        assert_eq!(s.people.get(&0).map(String::as_str), Some("Rina"), "the name goes along");
        assert!(s.photos[0].faces[0].blink_cut.is_some(), "five faces: their own cut-off");

        let ids = [s.photos[3].photo.id, s.photos[4].photo.id];
        let new = s.move_faces(&[(ids[0], 0), (ids[1], 0)], None);
        assert_eq!((new, person(&s, 3), person(&s, 4)), (1, Some(1), Some(1)));
        assert!(s.photos[4].faces[0].blink_cut.is_none(), "two faces are too few for a cut-off of their own");
        s.move_faces(&[(ids[1], 0)], Some(0));
        assert_eq!(person(&s, 4), Some(0));
        s.name_person(0, "");
        assert!(s.people.is_empty());

        // Saved under the old rules: a hand at 0.61 was a "face" then.
        s.photos[0].faces.push(Face { score: 0.61, person: Some(9), ..face(9, 0.9) });
        s.rules = 0;
        assert!(s.upgrade());
        assert_eq!(s.photos[0].faces.len(), 1);
        assert!(!s.upgrade(), "once");
    }

    #[test]
    fn analyzes_a_folder_end_to_end() {
        let tmp = tempfile::tempdir().unwrap();
        let shots = tmp.path().join("shoot");
        fs::create_dir(&shots).unwrap();
        let sharp = GrayImage::from_fn(900, 600, |x, y| Luma([if (x / 6 + y / 6) % 2 == 0 { 40 } else { 210 }]));
        save_jpeg(&shots.join("IMG_0001.JPG"), &sharp);
        save_jpeg(&shots.join("IMG_0002.JPG"), &imageops::blur(&sharp, 8.0));
        save_jpeg(&shots.join("IMG_0003.JPG"), &GrayImage::from_pixel(900, 600, Luma([4])));
        fs::write(shots.join("IMG_0004.JPG"), b"not a jpeg").unwrap();

        let cancel = AtomicBool::new(false);
        let events = std::sync::Mutex::new(0);
        let s = analyze(&shots, &["".into()], Options::default(), &tmp.path().join("thumbs"), &cancel, |_| {
            *events.lock().unwrap() += 1
        })
        .unwrap();

        let status = |name: &str| s.photos.iter().find(|p| p.name == name).unwrap();
        assert_eq!(status("IMG_0001.JPG").status, Status::Pick);
        assert_eq!(status("IMG_0002.JPG").status, Status::Reject);
        assert_eq!(status("IMG_0003.JPG").status, Status::Reject);
        let broken = status("IMG_0004.JPG");
        assert_eq!(broken.status, Status::Maybe);
        assert!(broken.error.is_some());
        assert!(status("IMG_0001.JPG").thumb.as_ref().unwrap().exists());
        // started + one per photo + grouping
        assert_eq!(*events.lock().unwrap(), 6);

        let dir = tmp.path().join("sessions");
        save(&dir, &s).unwrap();
        assert_eq!(load(&dir, &s.id).unwrap().photos.len(), 4);
        assert_eq!(list(&dir)[0].picks, 1);

        let mut s = s;
        // Settings are the AI's call, not the photographer's: going back
        // brings the photo back.
        s.recull(Options { limit: Some(0), ..Options::default() });
        assert_eq!((s.photos[0].status, s.photos[0].manual), (Status::Maybe, false));
        s.recull(Options::default());
        assert_eq!((s.photos[0].status, s.photos[0].manual), (Status::Pick, false));

        let first = s.photos[0].photo.id;
        s.set_rating(&[first], 9);
        assert_eq!(s.photos[0].rating, 5);

        // Re-culling with other settings keeps what was changed by hand.
        let blurry = s.photos.iter().position(|p| p.name == "IMG_0002.JPG").unwrap();
        let id2 = s.photos[blurry].photo.id;
        s.set_status(&[id2], Status::Pick);
        s.recull(Options { strictness: cull::Strictness::Strict, ..Options::default() });
        assert_eq!((s.photos[0].rating, s.photos[blurry].status), (5, Status::Pick), "manual changes are kept");
        assert_eq!(s.photos[blurry].auto_status, Status::Reject);
        assert_eq!(s.options.strictness, cull::Strictness::Strict);
        s.set_marks(&[Mark { id: id2, status: Status::Reject, rating: 1 }]);
        assert!(!s.photos[blurry].manual, "undone back to the AI's verdict");
        assert!(load(&dir, "../etc").is_none());

        let thumbs = tmp.path().join("thumbs");
        delete(&dir, std::slice::from_ref(&thumbs), &s.id).unwrap();
        assert!(load(&dir, &s.id).is_none() && !thumbs.join(&s.id).exists());
        assert!(shots.join("IMG_0001.JPG").exists(), "photos are never deleted");
        delete(&dir, std::slice::from_ref(&thumbs), "../../etc").unwrap(); // ignored, not an id

        // Moved folder: relinks, keeps decisions; a different folder is refused.
        let s = analyze(&shots, &["".into()], Options::default(), &thumbs, &cancel, |_| {}).unwrap();
        save(&dir, &s).unwrap();
        let moved = tmp.path().join("moved shoot");
        fs::rename(&shots, &moved).unwrap();
        let mut s = load(&dir, &s.id).unwrap();
        s.photos[0].rating = 2;
        let old_id = s.id.clone();
        let r = relink(&dir, &thumbs, s, &moved).unwrap();
        assert_eq!((r.name.as_str(), r.photos.len(), r.photos[0].rating), ("moved shoot", 4, 2));
        assert!(r.photos[0].photo.source().starts_with(&moved));
        assert!(load(&dir, &old_id).is_none() && load(&dir, &r.id).is_some());
        assert!(r.photos.iter().filter_map(|p| p.thumb.as_ref()).all(|t| t.exists()));

        // Cache cleared: thumbnails are made again from the photos.
        fs::remove_dir_all(thumbs.join(&r.id)).unwrap();
        let had = r.photos.iter().filter(|p| p.thumb.is_some()).count();
        assert!(had > 0);
        assert_eq!(restore_thumbs(&r), had);
        assert!(r.photos.iter().filter_map(|p| p.thumb.as_ref()).all(|t| t.exists()));
        assert_eq!(restore_thumbs(&r), 0, "nothing left to make");

        let other = tmp.path().join("other");
        fs::create_dir(&other).unwrap();
        fs::write(other.join("DSC_9999.JPG"), b"x").unwrap();
        assert!(matches!(relink(&dir, &thumbs, r, &other), Err(RelinkError::Mismatch { found: 0, total: 4 })));
    }
}
