pub mod analyze;
mod client_picks;
mod errlog;
mod inpaint_ai;
pub mod cull;
pub mod cutout;
pub mod denoise;
pub mod depth;
pub mod superres;
mod export;
pub mod faces;
pub mod full_res;
mod menu;
pub mod preview;
pub mod scan;
pub mod session;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use cull::{Options, Status};
use scan::Photo;
use session::{Progress, Session, Summary};

/// Errors cross into JavaScript as their message; the UI shows it as is.
type CmdResult<T> = Result<T, String>;

#[derive(Default)]
struct AppState {
    /// The session open in the review screen. Edits go here first, then to disk.
    current: Mutex<Option<Session>>,
    /// Folders scanned without being analyzed (client picks straight from
    /// the home screen). Photo ids match an analysis of the same folder.
    scanned: Mutex<HashMap<PathBuf, Vec<Photo>>>,
    cancel: AtomicBool,
}

impl AppState {
    /// Every photo under `root`, all subfolders included, from the last scan
    /// (scanning now if there was none). Ids match the open session's, which
    /// was analyzed from a selection of this same list.
    fn photos(&self, root: &Path) -> CmdResult<Vec<Photo>> {
        let mut cache = self.scanned.lock().unwrap();
        if let Some(p) = cache.get(root) {
            return Ok(p.clone());
        }
        let photos = scan::scan(root).map_err(|e| e.to_string())?;
        cache.insert(root.to_path_buf(), photos.clone());
        Ok(photos)
    }
}

fn sessions_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    app.path().app_data_dir().map(|d| d.join("sessions")).map_err(|e| e.to_string())
}

fn thumbs_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    app.path().app_cache_dir().map(|d| d.join("thumbs")).map_err(|e| e.to_string())
}

fn previews_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    app.path().app_cache_dir().map(|d| d.join("previews")).map_err(|e| e.to_string())
}

/// A folder the app writes into: a plain name inside the session folder,
/// never a path the UI could point elsewhere with "../".
fn output_dir(root: &Path, name: &str) -> CmdResult<PathBuf> {
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err("Nama folder tidak valid.".into());
    }
    Ok(root.join(name))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderInfo {
    root: PathBuf,
    name: String,
    /// The session folder itself first (name ""), then each subfolder that
    /// holds photos: `edited/`, `jpg/`, `Canon/`…
    folders: Vec<scan::FolderSummary>,
}

#[tauri::command]
fn inspect_folder(state: State<'_, AppState>, path: PathBuf) -> CmdResult<FolderInfo> {
    let photos = scan::scan(&path).map_err(|e| e.to_string())?;
    let info = FolderInfo {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        root: path.clone(),
        folders: scan::summarize(&photos),
    };
    state.scanned.lock().unwrap().insert(path, photos);
    Ok(info)
}

#[tauri::command]
async fn analyze_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    path: PathBuf,
    folders: Vec<String>,
    options: Options,
    on_progress: Channel<Progress>,
) -> CmdResult<Session> {
    state.cancel.store(false, Ordering::Relaxed);
    let thumbs = thumbs_dir(&app)?;
    let dir = sessions_dir(&app)?;
    let app2 = app.clone();
    // Pixel work runs on rayon's pool; keep it off the async runtime.
    let session = tauri::async_runtime::spawn_blocking(move || {
        let state = app2.state::<AppState>();
        session::analyze(&path, &folders, options, &thumbs, &state.cancel, |p| {
            let _ = on_progress.send(p);
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    session::save(&dir, &session).map_err(|e| e.to_string())?;
    *state.current.lock().unwrap() = Some(session.clone());
    Ok(session)
}

/// How far `reread_faces` is.
#[derive(Clone, serde::Serialize)]
struct RereadProgress {
    done: u32,
    total: u32,
}

/// Reads the faces of the open session again (blink scores, people) and
/// decides again; hand-made changes stay. Cancelled like an analysis.
#[tauri::command]
async fn reread_faces(app: AppHandle, state: State<'_, AppState>, on_progress: Channel<RereadProgress>) -> CmdResult<Session> {
    state.cancel.store(false, Ordering::Relaxed);
    let s = state.current.lock().unwrap().clone().ok_or("Belum ada sesi yang dibuka.")?;
    let app2 = app.clone();
    let read = tauri::async_runtime::spawn_blocking(move || {
        let state = app2.state::<AppState>();
        session::read_faces(&s, &state.cancel, |done, total| {
            let _ = on_progress.send(RereadProgress { done, total });
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    with_current(&app, &state, |s| {
        s.set_faces(read);
        s.clone()
    })
}

#[tauri::command]
fn cancel_analysis(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn list_sessions(app: AppHandle) -> CmdResult<Vec<Summary>> {
    Ok(session::list(&sessions_dir(&app)?))
}

#[tauri::command]
fn open_session(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<Session> {
    let mut s = session::load(&sessions_dir(&app)?, &id).ok_or("Sesi tidak ditemukan.")?;
    // Without the folder nothing can be exported, copied or zoomed — say so
    // instead of opening a session that half works.
    if !s.root.is_dir() {
        return Err(format!(
            "Folder “{}” tidak ditemukan. Kalau ada di drive eksternal, sambungkan dulu drivenya lalu coba lagi.",
            s.root.display()
        ));
    }
    if s.upgrade() {
        session::save(&sessions_dir(&app)?, &s).map_err(|e| e.to_string())?;
    }
    *state.current.lock().unwrap() = Some(s.clone());
    Ok(s)
}

/// A saved session read for its photos (Buat konten's source), leaving the
/// open session as it is.
#[tauri::command]
fn read_session(app: AppHandle, id: String) -> CmdResult<Session> {
    let mut s = session::load(&sessions_dir(&app)?, &id).ok_or("Sesi tidak ditemukan.")?;
    if !s.root.is_dir() {
        return Err(format!(
            "Folder “{}” tidak ditemukan. Kalau ada di drive eksternal, sambungkan dulu drivenya lalu coba lagi.",
            s.root.display()
        ));
    }
    s.upgrade();
    Ok(s)
}

/// Thumbnails of a saved session made again where their cache files are gone;
/// nothing to do while its folder is unreachable.
#[tauri::command]
async fn restore_thumbs(app: AppHandle, id: String) -> CmdResult<usize> {
    let s = session::load(&sessions_dir(&app)?, &id).ok_or("Sesi tidak ditemukan.")?;
    if !s.root.is_dir() {
        return Ok(0);
    }
    tauri::async_runtime::spawn_blocking(move || session::restore_thumbs(&s)).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_session(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let mut current = state.current.lock().unwrap();
    if current.as_ref().is_some_and(|s| s.id == id) {
        *current = None;
    }
    session::delete(
        &sessions_dir(&app)?,
        &[thumbs_dir(&app)?, previews_dir(&app)?, app.path().app_cache_dir().map_err(|e| e.to_string())?.join("full")],
        &id,
    )
    .map_err(|e| e.to_string())
}

/// A session whose folder moved: point it at `path` and open it there.
#[tauri::command]
fn relink_session(app: AppHandle, state: State<'_, AppState>, id: String, path: PathBuf) -> CmdResult<Session> {
    let dir = sessions_dir(&app)?;
    let s = session::load(&dir, &id).ok_or("Sesi tidak ditemukan.")?;
    let s = session::relink(&dir, &thumbs_dir(&app)?, s, &path).map_err(|e| e.to_string())?;
    state.scanned.lock().unwrap().remove(&path);
    *state.current.lock().unwrap() = Some(s.clone());
    Ok(s)
}

/// Runs `f` on the open session and saves it.
fn with_current<T>(app: &AppHandle, state: &AppState, f: impl FnOnce(&mut Session) -> T) -> CmdResult<T> {
    let mut guard = state.current.lock().unwrap();
    let s = guard.as_mut().ok_or("Belum ada sesi yang dibuka.")?;
    let out = f(s);
    session::save(&sessions_dir(app)?, s).map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
fn set_status(app: AppHandle, state: State<'_, AppState>, ids: Vec<u32>, status: Status) -> CmdResult<()> {
    with_current(&app, &state, |s| s.set_status(&ids, status))
}

#[tauri::command]
fn set_marks(app: AppHandle, state: State<'_, AppState>, marks: Vec<session::Mark>) -> CmdResult<()> {
    with_current(&app, &state, |s| s.set_marks(&marks))
}

/// Decides the open session again with other settings, from the saved
/// measurements (instant; no file is read). Hand-made changes stay.
#[tauri::command]
fn set_edits(app: AppHandle, state: State<'_, AppState>, edits: Vec<(u32, Option<serde_json::Value>)>) -> CmdResult<()> {
    with_current(&app, &state, |s| s.set_edits(edits))
}

#[tauri::command]
fn name_person(app: AppHandle, state: State<'_, AppState>, person: u32, name: String) -> CmdResult<Session> {
    with_current(&app, &state, |s| {
        s.name_person(person, &name);
        s.clone()
    })
}

#[tauri::command]
fn merge_people(app: AppHandle, state: State<'_, AppState>, from: u32, into: u32) -> CmdResult<Session> {
    with_current(&app, &state, |s| {
        s.merge_people(from, into);
        s.clone()
    })
}

#[tauri::command]
fn move_faces(app: AppHandle, state: State<'_, AppState>, faces: Vec<(u32, usize)>, to: Option<u32>) -> CmdResult<Session> {
    with_current(&app, &state, |s| {
        s.move_faces(&faces, to);
        s.clone()
    })
}

#[tauri::command]
fn recull(app: AppHandle, state: State<'_, AppState>, options: Options) -> CmdResult<Session> {
    with_current(&app, &state, |s| {
        s.recull(options);
        s.clone()
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheInfo {
    dir: PathBuf,
    /// Loupe previews and full-resolution pictures: made again on demand.
    previews: u64,
    full: u64,
    /// Thumbnails of saved sessions (kept: the grid shows them).
    thumbs: u64,
    /// Thumbnails no saved session uses (deleted sessions, folders opened
    /// only for client picks).
    unused_thumbs: u64,
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .filter_map(|e| e.ok())
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

/// Thumbnail folders (one per session id) no saved session uses.
fn unused_thumb_dirs(app: &AppHandle) -> CmdResult<Vec<PathBuf>> {
    let sessions = sessions_dir(app)?;
    let Ok(entries) = std::fs::read_dir(thumbs_dir(app)?) else { return Ok(vec![]) };
    Ok(entries
        .filter_map(|e| e.ok())
        .filter(|e| !sessions.join(format!("{}.json", e.file_name().to_string_lossy())).exists())
        .map(|e| e.path())
        .collect())
}

#[tauri::command]
fn cache_info(app: AppHandle) -> CmdResult<CacheInfo> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let unused_thumbs = unused_thumb_dirs(&app)?.iter().map(|d| dir_size(d)).sum();
    Ok(CacheInfo {
        previews: dir_size(&previews_dir(&app)?),
        full: dir_size(&dir.join("full")),
        thumbs: dir_size(&thumbs_dir(&app)?) - unused_thumbs,
        unused_thumbs,
        dir,
    })
}

/// Frees what is made again when needed: loupe previews, full-resolution
/// pictures, unused thumbnails. Thumbnails of saved sessions stay. Returns
/// the bytes freed.
#[tauri::command]
fn clear_cache(app: AppHandle) -> CmdResult<u64> {
    let full = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("full");
    let mut dirs = vec![previews_dir(&app)?, full];
    dirs.extend(unused_thumb_dirs(&app)?);
    let mut freed = 0;
    for d in dirs {
        let size = dir_size(&d);
        if std::fs::remove_dir_all(&d).is_ok() {
            freed += size;
        }
    }
    Ok(freed)
}

#[tauri::command]
fn set_rating(app: AppHandle, state: State<'_, AppState>, ids: Vec<u32>, rating: u8) -> CmdResult<()> {
    with_current(&app, &state, |s| s.set_rating(&ids, rating))
}

/// Large preview of one photo for the loupe view; cached after the first time.
#[tauri::command]
async fn preview_image(app: AppHandle, state: State<'_, AppState>, root: PathBuf, id: u32) -> CmdResult<PathBuf> {
    let photo = state.photos(&root)?.into_iter().find(|p| p.id == id).ok_or("Foto tidak ditemukan.")?;
    let dir = previews_dir(&app)?.join(session::id_for(&root));
    tauri::async_runtime::spawn_blocking(move || {
        let path = dir.join(format!("{}.jpg", photo.cache_key()));
        if !path.exists() {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            session::make_preview(photo.source(), &path)?;
        }
        Ok(path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FullRes {
    path: PathBuf,
    width: u32,
    height: u32,
}

/// Can this OS make full-resolution pictures? (macOS yes, others not yet.)
#[tauri::command]
fn full_res_supported() -> bool {
    full_res::supported()
}

/// Full-resolution picture of one photo for zooming; ~1 s the first time,
/// cached after that.
#[tauri::command]
async fn full_res_image(app: AppHandle, state: State<'_, AppState>, root: PathBuf, id: u32) -> CmdResult<FullRes> {
    let (photo, dir) = full_res_of(&app, &state, &root, id)?;
    tauri::async_runtime::spawn_blocking(move || full_res_file(&photo, &dir)).await.map_err(|e| e.to_string())?
}

/// The photo and the cache folder its full-size picture goes in.
fn full_res_of(app: &AppHandle, state: &AppState, root: &Path, id: u32) -> CmdResult<(Photo, PathBuf)> {
    let photo = state.photos(root)?.into_iter().find(|p| p.id == id).ok_or("Foto tidak ditemukan.")?;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("full").join(session::id_for(root));
    Ok((photo, dir))
}

/// The full-size picture of `photo`, made once (blocking: a RAW takes seconds).
fn full_res_file(photo: &Photo, dir: &Path) -> CmdResult<FullRes> {
    // "-m" = brightness matched to the camera preview; older cached files without it were darker.
    let path = dir.join(format!("{}-m.jpg", photo.cache_key()));
    if !path.exists() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        // The RAW holds the full sensor; a camera JPEG is already full size.
        let reference = photo.raw.as_ref().and_then(|_| preview::load(photo.source(), 1024).ok()).map(|l| l.image);
        full_res::render(photo.raw.as_deref().unwrap_or(photo.source()), &path, reference.as_ref())?;
    }
    let (width, height) = image::image_dimensions(&path).map_err(|e| e.to_string())?;
    Ok(FullRes { path, width, height })
}

/// Edit foto from a folder: its session if it has one (culled or edited
/// before, with everything kept), else a new one for editing only.
#[tauri::command]
async fn open_for_edit(app: AppHandle, state: State<'_, AppState>, root: PathBuf) -> CmdResult<Session> {
    let dir = sessions_dir(&app)?;
    let id = session::id_for(&root);
    let s = match session::load(&dir, &id) {
        Some(mut s) => {
            if s.upgrade() {
                session::save(&dir, &s).map_err(|e| e.to_string())?;
            }
            s
        }
        None => {
            let root2 = root.clone();
            let s = tauri::async_runtime::spawn_blocking(move || session::for_edit(&root2))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
            session::save(&dir, &s).map_err(|e| e.to_string())?;
            s
        }
    };
    *state.current.lock().unwrap() = Some(s.clone());
    Ok(s)
}

/// Edit foto › Masking › Orang: each face's Face Mesh points on the photo's
/// preview (shares of it), for drawing eyes, lips, skin…
#[tauri::command]
async fn face_landmarks(state: State<'_, AppState>, root: PathBuf, id: u32) -> CmdResult<Vec<Vec<(f32, f32)>>> {
    let photo = state.photos(&root)?.into_iter().find(|p| p.id == id).ok_or("Foto tidak ditemukan.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let loaded = preview::load(photo.source(), 2048).map_err(|e| e.to_string())?;
        faces::landmarks(&loaded.image.to_rgb8())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
struct DenoiseProgress {
    done: u32,
    total: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Denoised {
    /// The full-size picture cleaned, and a 2048 px copy for the editor.
    full: PathBuf,
    preview: PathBuf,
    width: u32,
    height: u32,
    /// How noisy the photo read (0–255): under 4 it was clean already.
    sigma: f32,
}

/// Edit foto › AI Denoise: the photo cleaned (FFDNet, `denoise.rs`), kept in
/// the cache next to its full-size picture; asked again, it is there.
#[tauri::command]
async fn denoise_photo(
    app: AppHandle,
    state: State<'_, AppState>,
    root: PathBuf,
    id: u32,
    on_progress: Channel<DenoiseProgress>,
) -> CmdResult<Denoised> {
    let (photo, dir) = full_res_of(&app, &state, &root, id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let full = full_res_file(&photo, &dir)?;
        let out = dir.join(format!("{}-dn.jpg", photo.cache_key()));
        let small = dir.join(format!("{}-dn-2048.jpg", photo.cache_key()));
        let sigma_file = dir.join(format!("{}-dn.sigma", photo.cache_key()));
        if !(out.exists() && small.exists() && sigma_file.exists()) {
            let img = image::open(&full.path).map_err(|e| e.to_string())?.to_rgb8();
            let (w, h) = (img.width() as usize, img.height() as usize);
            let sigma = denoise::estimate_sigma(img.as_raw(), w, h);
            let clean = denoise::denoise(img.as_raw(), w, h, sigma, |done, total| {
                let _ = on_progress.send(DenoiseProgress { done, total });
            })?;
            let clean = image::RgbImage::from_raw(w as u32, h as u32, clean).ok_or("Data gambar tidak terbaca.")?;
            let save = |img: &image::RgbImage, path: &Path, q: u8| -> CmdResult<()> {
                let mut f = std::io::BufWriter::new(std::fs::File::create(path).map_err(|e| e.to_string())?);
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut f, q).encode_image(img).map_err(|e| e.to_string())
            };
            save(&clean, &out, 95)?;
            let k = 2048.0 / w.max(h) as f32;
            let preview = if k < 1.0 {
                image::imageops::resize(&clean, (w as f32 * k).round() as u32, (h as f32 * k).round() as u32, image::imageops::FilterType::Triangle)
            } else {
                clean
            };
            save(&preview, &small, 92)?;
            std::fs::write(&sigma_file, sigma.to_string()).map_err(|e| e.to_string())?;
        }
        let sigma = std::fs::read_to_string(&sigma_file).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0.0);
        Ok(Denoised { full: out, preview: small, width: full.width, height: full.height, sigma })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Edit foto › Lens Blur: the photo's depth (`depth.rs`), worked out once
/// and kept beside its full-size picture: width and height (u32, little
/// endian) then one nearness byte per pixel (255 nearest).
#[tauri::command]
async fn depth_map(app: AppHandle, state: State<'_, AppState>, root: PathBuf, id: u32) -> CmdResult<tauri::ipc::Response> {
    let (photo, dir) = full_res_of(&app, &state, &root, id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let file = dir.join(format!("{}.depth", photo.cache_key()));
        if let Ok(bytes) = std::fs::read(&file) {
            return Ok(tauri::ipc::Response::new(bytes));
        }
        let loaded = preview::load(photo.source(), 1024).map_err(|e| e.to_string())?;
        let (d, w, h) = depth::depth(&loaded.image.to_rgb8())?;
        let mut bytes = Vec::with_capacity(8 + d.len());
        bytes.extend((w as u32).to_le_bytes());
        bytes.extend((h as u32).to_le_bytes());
        bytes.extend(d);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let _ = std::fs::write(&file, &bytes);
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Edit foto › Lens Corrections: the camera and lens the photo was taken
/// with, and how (focal length, aperture), from its EXIF.
#[tauri::command]
async fn lens_info(state: State<'_, AppState>, root: PathBuf, id: u32) -> CmdResult<preview::LensInfo> {
    let photo = state.photos(&root)?.into_iter().find(|p| p.id == id).ok_or("Foto tidak ditemukan.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let data = std::fs::read(photo.raw.as_deref().unwrap_or(photo.source())).map_err(|e| e.to_string())?;
        Ok(preview::lens_info(&data))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct Upscaled {
    width: u32,
    height: u32,
}

/// Edit foto › Super Resolution: a JPG this app just exported (`save_export`)
/// rewritten at twice the width and height (`superres.rs`). Only a .jpg.
#[tauri::command]
async fn super_resolve(path: PathBuf, on_progress: Channel<DenoiseProgress>) -> CmdResult<Upscaled> {
    let is_jpg = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg"));
    if !is_jpg || !path.is_file() {
        return Err("Foto tidak bisa dibaca.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let img = image::open(&path).map_err(|e| e.to_string())?.to_rgb8();
        let (w, h) = (img.width() as usize, img.height() as usize);
        let big = superres::upscale(img.as_raw(), w, h, |done, total| {
            let _ = on_progress.send(DenoiseProgress { done, total });
        })?;
        let (bw, bh) = ((w * superres::SCALE) as u32, (h * superres::SCALE) as u32);
        let big = image::RgbImage::from_raw(bw, bh, big).ok_or("Data gambar tidak terbaca.")?;
        // Written beside, then put in place: a failure leaves the first one.
        let tmp = path.with_extension("sr-tmp");
        {
            let mut f = std::io::BufWriter::new(std::fs::File::create(&tmp).map_err(|e| e.to_string())?);
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut f, 95).encode_image(&big).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        Ok(Upscaled { width: bw, height: bh })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Photo list of a folder that hasn't been analyzed (rescans every time, so
/// files added since are seen).
#[tauri::command]
fn scan_photos(state: State<'_, AppState>, root: PathBuf) -> CmdResult<Vec<Photo>> {
    let photos = scan::scan(&root).map_err(|e| e.to_string())?;
    state.scanned.lock().unwrap().insert(root, photos.clone());
    Ok(photos)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedFiles {
    /// Key for thumbnails/previews of these photos (not a real folder).
    root: PathBuf,
    /// Where results go: the folder holding the first photo.
    dir: PathBuf,
    photos: Vec<Photo>,
}

/// Photos picked file by file, kept like a scanned folder under a key of
/// their own, so thumbnails and previews work as for a folder.
#[tauri::command]
fn open_files(state: State<'_, AppState>, paths: Vec<PathBuf>) -> CmdResult<PickedFiles> {
    let first = paths.first().ok_or("Belum ada foto yang dipilih.")?;
    let dir = first.parent().map(Path::to_path_buf).ok_or("Lokasi foto tidak valid.")?;
    // Their common parent, so photos keep readable folders ("a", "b").
    let mut base = dir.clone();
    while !paths.iter().all(|p| p.starts_with(&base)) {
        if !base.pop() {
            break;
        }
    }
    let photos = scan::from_files(&base, &paths);
    if photos.is_empty() {
        return Err("File yang dipilih bukan foto RAW atau JPEG.".into());
    }
    let mut key: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    key.sort();
    let root = base.join(format!(".pilihfotomu-pilihan-{:016x}", scan::fnv(key.join("\n").as_bytes())));
    state.scanned.lock().unwrap().insert(root.clone(), photos.clone());
    Ok(PickedFiles { root, dir, photos })
}

/// Files dragged in from Finder, added to the photos of `root` (a folder, a
/// session or picked files) with new ids after the last one, so the photos
/// already placed keep theirs. A file added before keeps its id; the same
/// files added again in the same order (a draft reopened) get the same ids.
#[tauri::command]
fn add_files(state: State<'_, AppState>, root: PathBuf, paths: Vec<PathBuf>) -> CmdResult<Vec<Photo>> {
    state.photos(&root)?;
    let first = paths.first().ok_or("Belum ada foto yang dipilih.")?;
    let mut base = first.parent().map(Path::to_path_buf).ok_or("Lokasi foto tidak valid.")?;
    while !paths.iter().all(|p| p.starts_with(&base)) {
        if !base.pop() {
            break;
        }
    }
    let found = scan::from_files(&base, &paths);
    if found.is_empty() {
        return Err("File yang diseret bukan foto RAW atau JPEG.".into());
    }
    let mut cache = state.scanned.lock().unwrap();
    let list = cache.get_mut(&root).ok_or("Folder foto tidak ditemukan.")?;
    let mut next = list.iter().map(|p| p.id + 1).max().unwrap_or(0);
    let mut out = Vec::new();
    for mut p in found {
        if let Some(known) = list.iter().find(|e| e.source() == p.source()) {
            out.push(known.clone());
            continue;
        }
        p.id = next;
        next += 1;
        list.push(p.clone());
        out.push(p);
    }
    Ok(out)
}

/// Thumbnails for some photos of a folder, made on demand and cached in the
/// same place an analysis puts them.
#[tauri::command]
async fn thumbnails(
    app: AppHandle,
    state: State<'_, AppState>,
    root: PathBuf,
    ids: Vec<u32>,
) -> CmdResult<HashMap<u32, Option<PathBuf>>> {
    let photos = state.photos(&root)?;
    let dir = thumbs_dir(&app)?.join(session::id_for(&root));
    let made: HashMap<u32, Option<PathBuf>> = tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok::<_, String>(
            photos
                .par_iter()
                .filter(|p| ids.contains(&p.id))
                .map(|p| {
                    let path = dir.join(format!("{}.jpg", p.cache_key()));
                    let ok = path.exists() || session::make_thumb(p.source(), &path).is_ok();
                    (p.id, ok.then_some(path))
                })
                .collect(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    // The open session's photos without one (a folder opened in Edit foto) keep them.
    let mut guard = state.current.lock().unwrap();
    if let Some(s) = guard.as_mut().filter(|s| s.root == root) {
        let mut changed = false;
        for e in s.photos.iter_mut().filter(|e| e.thumb.is_none()) {
            if let Some(Some(p)) = made.get(&e.photo.id) {
                e.thumb = Some(p.clone());
                changed = true;
            }
        }
        if changed {
            let _ = session::save(&sessions_dir(&app)?, s);
        }
    }
    Ok(made)
}

#[tauri::command]
fn resolve_client_picks(
    state: State<'_, AppState>,
    root: PathBuf,
    folders: Vec<String>,
    text: String,
) -> CmdResult<client_picks::PickResult> {
    Ok(client_picks::resolve(&text, &scan::select(state.photos(&root)?, &folders)))
}

#[tauri::command]
fn export_xmp(
    app: AppHandle,
    state: State<'_, AppState>,
    existing: export::Existing,
    with_reasons: bool,
    jpeg_copies: bool,
) -> CmdResult<export::ExportReport> {
    with_current(&app, &state, |s| {
        let copies = jpeg_copies.then(|| s.root.join(scan::JPEG_MARKED_DIR));
        let marks: Vec<export::Mark> = s
            .photos
            .iter()
            .map(|e| export::Mark { photo: &e.photo, status: e.status, rating: e.rating, reasons: &e.reasons })
            .collect();
        let report = export::write_xmp(&marks, existing, with_reasons, copies.as_deref());
        if report.written + report.marked_jpeg > 0 {
            s.exported = true;
        }
        report
    })
}

#[derive(Deserialize)]
struct DevelopXmp {
    id: u32,
    develop: export::Develop,
}

#[tauri::command]
fn write_develop_xmp(
    app: AppHandle,
    state: State<'_, AppState>,
    items: Vec<DevelopXmp>,
    with_reasons: Option<bool>,
) -> CmdResult<export::ExportReport> {
    with_current(&app, &state, |s| {
        let marks: Vec<(export::Mark, export::Develop)> = items
            .into_iter()
            .filter_map(|it| {
                let e = s.photos.iter().find(|e| e.photo.id == it.id)?;
                Some((export::Mark { photo: &e.photo, status: e.status, rating: e.rating, reasons: &e.reasons }, it.develop))
            })
            .collect();
        export::write_develop_xmp(&marks, with_reasons.unwrap_or(false))
    })
}

/// Lightroom presets (.xmp) to import: the files chosen, and the .xmp files
/// in the folders chosen (a few levels down). Path and text of each.
#[tauri::command]
fn read_presets(paths: Vec<PathBuf>) -> CmdResult<Vec<(String, String)>> {
    const MAX_FILES: usize = 500;
    const MAX_BYTES: u64 = 1 << 20;
    let mut files = Vec::new();
    fn walk(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        let mut list: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
        list.sort();
        for p in list {
            if p.is_dir() && depth > 0 {
                walk(&p, depth - 1, out);
            } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("xmp")) {
                out.push(p);
            }
        }
    }
    for p in paths {
        if p.is_dir() {
            walk(&p, 3, &mut files);
        } else {
            files.push(p);
        }
    }
    Ok(files
        .into_iter()
        .take(MAX_FILES)
        .filter(|p| std::fs::metadata(p).is_ok_and(|m| m.len() <= MAX_BYTES))
        .filter_map(|p| Some((p.display().to_string(), std::fs::read_to_string(&p).ok()?)))
        .collect())
}

#[tauri::command]
fn copy_to_folder(
    state: State<'_, AppState>,
    root: PathBuf,
    ids: Vec<u32>,
    folder_name: String,
) -> CmdResult<export::CopyReport> {
    let dest = output_dir(&root, &folder_name)?;
    let photos = state.photos(&root)?;
    let chosen: Vec<&Photo> = photos.iter().filter(|p| ids.contains(&p.id)).collect();
    Ok(export::copy_photos(&chosen, &dest))
}

#[derive(Clone, Serialize)]
struct JpegProgress {
    done: u32,
    total: u32,
}

#[tauri::command]
async fn export_jpegs(
    state: State<'_, AppState>,
    root: PathBuf,
    ids: Vec<u32>,
    folder_name: String,
    options: export::JpegOptions,
    on_progress: Channel<JpegProgress>,
) -> CmdResult<export::JpegReport> {
    let dest = output_dir(&root, &folder_name)?;
    let photos = state.photos(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let chosen: Vec<&Photo> = photos.iter().filter(|p| ids.contains(&p.id)).collect();
        export::export_jpegs(&chosen, &dest, options, |done, total| {
            let _ = on_progress.send(JpegProgress { done, total });
        })
    })
    .await
    .map_err(|e| e.to_string())
}

/// Where Buat konten keeps its files: drafts in `<app data>/kreasi/`, the
/// photographer's own templates (`shelf: "templates"`) in `kreasi/templates/`.
fn drafts_dir(app: &AppHandle, shelf: Option<&str>) -> CmdResult<PathBuf> {
    let dir = app.path().app_data_dir().map(|d| d.join("kreasi")).map_err(|e| e.to_string())?;
    match shelf {
        None => Ok(dir),
        Some("templates") => Ok(dir.join("templates")),
        Some(_) => Err("Tempat simpan tidak dikenal.".into()),
    }
}

/// Draft ids are made by the UI; anything but [a-z0-9-] is refused so an id
/// can never point outside the drafts folder.
fn draft_path(app: &AppHandle, shelf: Option<&str>, id: &str) -> CmdResult<PathBuf> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Id draf tidak valid.".into());
    }
    Ok(drafts_dir(app, shelf)?.join(format!("{id}.json")))
}

/// A picture element made in Buat konten (a photo with its background
/// removed), as `<app data>/kreasi/assets/<id>.png`; ids as for drafts.
fn asset_path(app: &AppHandle, id: &str) -> CmdResult<PathBuf> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Id gambar tidak valid.".into());
    }
    Ok(drafts_dir(app, None)?.join("assets").join(format!("{id}.png")))
}

/// Saves a picture element: PNG bytes as the raw body, its id as a header.
#[tauri::command]
fn save_asset(app: AppHandle, request: tauri::ipc::Request<'_>) -> CmdResult<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Data gambar tidak terbaca.".into());
    };
    let id = request.headers().get("id").and_then(|v| v.to_str().ok()).ok_or("Id gambar tidak valid.")?;
    let path = asset_path(&app, id)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("png.tmp");
    std::fs::write(&tmp, bytes).and_then(|_| std::fs::rename(&tmp, &path)).map_err(|e| e.to_string())
}

/// A picture element's PNG bytes.
#[tauri::command]
fn load_asset(app: AppHandle, id: String) -> CmdResult<tauri::ipc::Response> {
    let bytes = std::fs::read(asset_path(&app, &id)?).map_err(|_| "Gambar elemen tidak ditemukan.".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ── Kelola Bisnis ────────────────────────────────────────────────

/// Kelola Bisnis keeps everything (bookings, clients, packages, money) in one
/// JSON file the UI writes, `<app data>/bisnis/data.json`; offline only.
fn bisnis_path(app: &AppHandle) -> CmdResult<PathBuf> {
    app.path().app_data_dir().map(|d| d.join("bisnis").join("data.json")).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_bisnis(app: AppHandle) -> CmdResult<Option<String>> {
    let path = bisnis_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Written whole and swapped in, so a crash mid-write never leaves half a file;
/// the one before is kept as `data.prev.json`, one step back.
#[tauri::command]
fn save_bisnis(app: AppHandle, json: String) -> CmdResult<()> {
    let path = bisnis_path(&app)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    if path.exists() {
        let _ = std::fs::copy(&path, path.with_file_name("data.prev.json"));
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Kinds of file the UI may write where the person chose (a save dialog, a backup folder).
const USER_FILE_KINDS: &[&str] = &["pdf", "csv", "json", "ics", "png"];

fn user_file(path: &str) -> CmdResult<PathBuf> {
    let p = PathBuf::from(path);
    let ok = p.is_absolute() && p.extension().and_then(|e| e.to_str()).is_some_and(|e| USER_FILE_KINDS.contains(&e.to_ascii_lowercase().as_str()));
    if ok { Ok(p) } else { Err("Jenis file ini tidak bisa disimpan.".into()) }
}

/// An invoice, report, export or backup: the bytes as the raw body, the path as a header.
#[tauri::command]
fn write_user_file(request: tauri::ipc::Request<'_>) -> CmdResult<String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Data file tidak terbaca.".into());
    };
    let path = request.headers().get("path").and_then(|v| v.to_str().ok()).ok_or("Lokasi file tidak valid.")?;
    let path = user_file(&percent_decode(path)?)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// A backup the person picked, to restore from.
#[tauri::command]
fn read_user_file(path: String) -> CmdResult<String> {
    std::fs::read_to_string(user_file(&path)?).map_err(|e| e.to_string())
}

/// The day of a daily Kelola Bisnis backup copy ("pilihfotomu-bisnis-2026-10-29.json"), or None for any other file.
fn backup_day(name: &str) -> Option<&str> {
    let day = name.strip_prefix("pilihfotomu-bisnis-")?.strip_suffix(".json")?;
    let b = day.as_bytes();
    let ok = b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    ok.then_some(day)
}

/// Daily copies to let go: older than `keep_from` ("YYYY-MM-DD"), except the last of each month.
fn backups_to_prune(names: &[String], keep_from: &str) -> Vec<String> {
    let mut old: Vec<(&str, &String)> = names.iter().filter_map(|n| backup_day(n).map(|d| (d, n))).filter(|(d, _)| *d < keep_from).collect();
    old.sort();
    let mut out = Vec::new();
    for (i, (day, name)) in old.iter().enumerate() {
        let last_of_month = old.get(i + 1).is_none_or(|(next, _)| next[..7] != day[..7]);
        if !last_of_month {
            out.push((*name).clone());
        }
    }
    out
}

/// Thins the backup folder: daily copies older than `keep_from` go, but for the last of each month.
/// Only files named as the app names its daily copies are ever touched.
#[tauri::command]
fn prune_backups(dir: String, keep_from: String) -> CmdResult<u32> {
    let dir = PathBuf::from(dir);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err("Folder backup tidak ditemukan.".into());
    }
    let names: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    let mut gone = 0;
    for name in backups_to_prune(&names, &keep_from) {
        if std::fs::remove_file(dir.join(&name)).is_ok() {
            gone += 1;
        }
    }
    Ok(gone)
}

/// Quits, once the UI has saved what it had open (the menu's Quit).
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Pictures brought in from the computer (asset ids starting `unggah-`),
/// newest first: "Gambar saya", to use again in any design.
#[tauri::command]
fn list_uploads(app: AppHandle) -> CmdResult<Vec<String>> {
    let Ok(entries) = std::fs::read_dir(drafts_dir(&app, None)?.join("assets")) else { return Ok(vec![]) };
    let mut found: Vec<(std::time::SystemTime, String)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let id = name.strip_suffix(".png")?.to_string();
            let when = e.metadata().ok()?.modified().ok()?;
            id.starts_with("unggah-").then_some((when, id))
        })
        .collect();
    found.sort_by_key(|f| std::cmp::Reverse(f.0));
    Ok(found.into_iter().map(|(_, id)| id).collect())
}

/// Takes a picture out of "Gambar saya" for good: its file, uploads only.
#[tauri::command]
fn delete_upload(app: AppHandle, id: String) -> CmdResult<()> {
    if !id.starts_with("unggah-") {
        return Err("Hanya gambar unggahan yang bisa dihapus.".into());
    }
    match std::fs::remove_file(asset_path(&app, &id)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Saves a Buat konten design (JSON made by the UI) as `<app data>/kreasi/<id>.json`.
#[tauri::command]
fn save_draft(app: AppHandle, id: String, json: String, shelf: Option<String>) -> CmdResult<()> {
    let path = draft_path(&app, shelf.as_deref(), &id)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).and_then(|_| std::fs::rename(&tmp, &path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_draft(app: AppHandle, id: String, shelf: Option<String>) -> CmdResult<String> {
    std::fs::read_to_string(draft_path(&app, shelf.as_deref(), &id)?).map_err(|_| "Draf tidak ditemukan.".to_string())
}

/// Every saved draft as its JSON text, newest first (the UI reads the summary fields).
#[tauri::command]
fn list_drafts(app: AppHandle, shelf: Option<String>) -> CmdResult<Vec<String>> {
    let Ok(entries) = std::fs::read_dir(drafts_dir(&app, shelf.as_deref())?) else { return Ok(vec![]) };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .filter_map(|p| Some((std::fs::metadata(&p).ok()?.modified().ok()?, p)))
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    Ok(files.into_iter().filter_map(|(_, p)| std::fs::read_to_string(p).ok()).collect())
}

#[tauri::command]
fn delete_draft(app: AppHandle, id: String, shelf: Option<String>) -> CmdResult<()> {
    match std::fs::remove_file(draft_path(&app, shelf.as_deref(), &id)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Saves a picture made in the UI (Buat konten export) into `<root>/<folder>/`.
/// Hapus latar: the subject's mask of a picture the page sends at the model's
/// size (RGB bytes as the raw body; `mode`, `width`, `height` as headers),
/// one alpha byte per pixel back. Runs off the main thread.
#[tauri::command]
async fn cutout_mask(request: tauri::ipc::Request<'_>) -> CmdResult<tauri::ipc::Response> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Data gambar tidak terbaca.".into());
    };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let mode = header("mode").as_deref().and_then(cutout::Mode::parse).ok_or("Data gambar tidak terbaca.")?;
    let size = |k: &str| header(k).and_then(|v| v.parse::<u32>().ok()).filter(|&v| v > 0 && v <= 4096);
    let (w, h) = (size("width").ok_or("Data gambar tidak terbaca.")?, size("height").ok_or("Data gambar tidak terbaca.")?);
    let rgb = bytes.clone();
    let alpha = tauri::async_runtime::spawn_blocking(move || cutout::mask(mode, w, h, &rgb)).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(alpha))
}

/// Edit foto › Hapus objek: a 512 × 512 part of the photo (RGB) followed by
/// its mask (one byte a pixel, not 0 = fill), as the raw body; the part
/// filled in comes back (`inpaint_ai.rs`).
#[tauri::command]
async fn inpaint_ai(request: tauri::ipc::Request<'_>) -> CmdResult<tauri::ipc::Response> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Data gambar tidak terbaca.".into());
    };
    let n = inpaint_ai::SIDE * inpaint_ai::SIDE;
    if bytes.len() != n * 4 {
        return Err("Data gambar tidak terbaca.".into());
    }
    let data = bytes.clone();
    let out = tauri::async_runtime::spawn_blocking(move || inpaint_ai::fill(&data[..n * 3], &data[n * 3..])).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(out))
}

/// The bytes come as the raw request body; root, folder and file name as
/// URI-encoded headers. Never overwrites: a name already taken gets " (2)".
#[tauri::command]
fn save_export(request: tauri::ipc::Request<'_>) -> CmdResult<PathBuf> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Data gambar tidak terbaca.".into());
    };
    let header = |k: &str| -> CmdResult<String> {
        let v = request.headers().get(k).and_then(|v| v.to_str().ok()).ok_or("Permintaan simpan tidak lengkap.")?;
        percent_decode(v)
    };
    let root = PathBuf::from(header("root")?);
    if !root.is_dir() {
        return Err(format!("Folder “{}” tidak ditemukan.", root.display()));
    }
    let dir = output_dir(&root, &header("folder")?)?;
    let name = header("name")?;
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return Err("Nama file tidak valid.".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = free_name(&dir, name);
    let tmp = path.with_extension("pilihfotomu-tmp");
    std::fs::write(&tmp, bytes).and_then(|_| std::fs::rename(&tmp, &path)).map_err(|e| e.to_string())?;
    Ok(path)
}

/// `name` in `dir`, or "stem (2).ext", "stem (3).ext"… when taken.
fn free_name(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap()
}

/// Decodes `%XX` escapes (what `encodeURIComponent` makes).
fn percent_decode(s: &str) -> CmdResult<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).map_err(|e| e.to_string())?;
            out.push(u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| e.to_string())
}

/// The UI's language ("id" / "en"): rebuilds the menu bar in it.
#[tauri::command]
fn set_language(app: AppHandle, lang: String) -> CmdResult<()> {
    let menu = menu::build_in(&app, lang == "en").map_err(|e| e.to_string())?;
    app.set_menu(menu).map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::default())
        .setup(|app| {
            errlog::init(app.handle());
            Ok(())
        })
        .menu(menu::build)
        .on_menu_event(|app, event| menu::on_event(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            inspect_folder,
            analyze_folder,
            cancel_analysis,
            reread_faces,
            list_sessions,
            open_session,
            read_session,
            restore_thumbs,
            delete_session,
            relink_session,
            set_status,
            set_rating,
            set_marks,
            recull,
            name_person,
            set_edits,
            write_develop_xmp,
            read_presets,
            denoise_photo,
            super_resolve,
            depth_map,
            lens_info,
            face_landmarks,
            open_for_edit,
            merge_people,
            move_faces,
            set_language,
            save_export,
            save_draft,
            load_draft,
            list_drafts,
            delete_draft,
            cache_info,
            clear_cache,
            preview_image,
            full_res_supported,
            full_res_image,
            scan_photos,
            open_files,
            add_files,
            cutout_mask,
            inpaint_ai,
            save_asset,
            load_asset,
            list_uploads,
            quit_app,
            load_bisnis,
            save_bisnis,
            write_user_file,
            read_user_file,
            prune_backups,
            errlog::log_error,
            errlog::error_report,
            errlog::error_count,
            errlog::clear_error_log,
            delete_upload,
            thumbnails,
            resolve_client_picks,
            export_xmp,
            copy_to_folder,
            export_jpegs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prunes_old_daily_backups_but_one_a_month() {
        let names: Vec<String> = [
            "pilihfotomu-bisnis-2026-08-03.json",
            "pilihfotomu-bisnis-2026-08-31.json",
            "pilihfotomu-bisnis-2026-09-01.json",
            "pilihfotomu-bisnis-2026-09-15.json",
            "pilihfotomu-bisnis-2026-09-29.json",
            "pilihfotomu-bisnis-2026-09-30.json",
            "pilihfotomu-bisnis-2026-10-28.json",
            "pilihfotomu-bisnis.json",
            "pilihfotomu-bisnis-2026-08-0x.json",
            "catatan.json",
        ]
        .map(String::from)
        .to_vec();
        let mut gone = backups_to_prune(&names, "2026-09-29");
        gone.sort();
        // August keeps its last (31st); September before the 29th keeps its last too (15th); from the 29th all stay.
        assert_eq!(gone, ["pilihfotomu-bisnis-2026-08-03.json", "pilihfotomu-bisnis-2026-09-01.json"]);
        assert_eq!(backup_day("pilihfotomu-bisnis.json"), None);
        assert_eq!(backup_day("pilihfotomu-bisnis-2026-10-29.json"), Some("2026-10-29"));
    }

    #[test]
    fn decodes_headers_and_never_overwrites() {
        assert_eq!(percent_decode("Wedding%20Rina%20%26%20Dimas").unwrap(), "Wedding Rina & Dimas");
        assert_eq!(percent_decode("caf%C3%A9").unwrap(), "café");
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(free_name(tmp.path(), "a.jpg"), tmp.path().join("a.jpg"));
        std::fs::write(tmp.path().join("a.jpg"), b"x").unwrap();
        std::fs::write(tmp.path().join("a (2).jpg"), b"x").unwrap();
        assert_eq!(free_name(tmp.path(), "a.jpg"), tmp.path().join("a (3).jpg"));
    }
}
