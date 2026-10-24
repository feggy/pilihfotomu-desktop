pub mod analyze;
mod client_picks;
pub mod cull;
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
use serde::Serialize;
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
    let s = session::load(&sessions_dir(&app)?, &id).ok_or("Sesi tidak ditemukan.")?;
    // Without the folder nothing can be exported, copied or zoomed — say so
    // instead of opening a session that half works.
    if !s.root.is_dir() {
        return Err(format!(
            "Folder “{}” tidak ditemukan. Kalau ada di drive eksternal, sambungkan dulu drivenya lalu coba lagi.",
            s.root.display()
        ));
    }
    *state.current.lock().unwrap() = Some(s.clone());
    Ok(s)
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
    let photo = state.photos(&root)?.into_iter().find(|p| p.id == id).ok_or("Foto tidak ditemukan.")?;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("full").join(session::id_for(&root));
    tauri::async_runtime::spawn_blocking(move || {
        // "-m" = brightness matched to the camera preview; older cached files without it were darker.
        let path = dir.join(format!("{}-m.jpg", photo.cache_key()));
        if !path.exists() {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            // The RAW holds the full sensor; a camera JPEG is already full size.
            let reference = photo.raw.as_ref().and_then(|_| preview::load(photo.source(), 1024).ok()).map(|l| l.image);
            full_res::render(photo.raw.as_deref().unwrap_or(photo.source()), &path, reference.as_ref())?;
        }
        let (width, height) = image::image_dimensions(&path).map_err(|e| e.to_string())?;
        Ok(FullRes { path, width, height })
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
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(photos
            .par_iter()
            .filter(|p| ids.contains(&p.id))
            .map(|p| {
                let path = dir.join(format!("{}.jpg", p.cache_key()));
                let ok = path.exists() || session::make_thumb(p.source(), &path).is_ok();
                (p.id, ok.then_some(path))
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
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
        .manage(AppState::default())
        .menu(menu::build)
        .on_menu_event(|app, event| menu::on_event(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            inspect_folder,
            analyze_folder,
            cancel_analysis,
            list_sessions,
            open_session,
            delete_session,
            relink_session,
            set_status,
            set_rating,
            set_marks,
            recull,
            set_language,
            cache_info,
            clear_cache,
            preview_image,
            full_res_supported,
            full_res_image,
            scan_photos,
            thumbnails,
            resolve_client_picks,
            export_xmp,
            copy_to_folder,
            export_jpegs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
