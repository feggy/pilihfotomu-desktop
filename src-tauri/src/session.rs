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
    /// Top folders that were analyzed ("" = the session folder itself).
    #[serde(default = "root_only")]
    pub folders: Vec<String>,
    pub exported: bool,
    pub photos: Vec<Entry>,
}

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
            }
        }
    }

    /// Stars 0–5, as the photographer sets them; status stays as it is.
    pub fn set_rating(&mut self, ids: &[u32], rating: u8) {
        for e in self.photos.iter_mut().filter(|e| ids.contains(&e.photo.id)) {
            e.rating = rating.min(5);
        }
    }
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
            let mut m = Measured { photo, info: None, metrics: None, faces: vec![], thumb: None, error: None };
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
                        m.faces = faces::analyze(&loaded.image.to_rgb8()).unwrap_or_default();
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
                cull::cull(&[Input { id: m.photo.id, taken_at: None, metrics, faces: &m.faces }], &options).remove(0)
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

    if cancel.load(Ordering::Relaxed) {
        return Err(SessionError::Cancelled);
    }
    progress(Progress::Grouping);

    let inputs: Vec<Input> = measured
        .iter()
        .filter_map(|m| {
            m.metrics.map(|metrics| Input {
                id: m.photo.id,
                taken_at: m.info.as_ref().and_then(|i| i.taken_at),
                metrics,
                faces: &m.faces,
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
    })
}

/// Thumbnail for one file outside an analysis (client picks on a folder
/// that was never culled).
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
            if let Reason::Duplicate { of } = r {
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
        let first = s.photos[0].photo.id;
        s.set_rating(&[first], 9);
        assert_eq!(s.photos[0].rating, 5);
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
        let other = tmp.path().join("other");
        fs::create_dir(&other).unwrap();
        fs::write(other.join("DSC_9999.JPG"), b"x").unwrap();
        assert!(matches!(relink(&dir, &thumbs, r, &other), Err(RelinkError::Mismatch { found: 0, total: 4 })));
    }
}
