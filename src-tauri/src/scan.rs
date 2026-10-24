//! Finding the photos in a session folder.
//!
//! A camera set to RAW+JPEG writes two files per shot (`IMG_0101.CR3` and
//! `IMG_0101.JPG`). They are one photo to the photographer, so they are paired
//! here by folder + file stem and travel together everywhere after this.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const RAW_EXTS: &[&str] = &[
    "cr3", "cr2", "crw", "nef", "nrw", "arw", "srf", "sr2", "raf", "orf", "rw2", "dng", "pef", "srw", "3fr", "iiq",
    "x3f",
];
pub const JPEG_EXTS: &[&str] = &["jpg", "jpeg"];

/// Folders the app writes into itself (copy-to-folder output). Scanning them
/// again would count every pick twice.
pub const SKIP_DIRS: &[&str] = &[
    "picks",
    "dipilih",
    "dipilih jpg",
    "picks jpg",
    "pilihan klien",
    "pilihan klien jpg",
    "client picks",
    "client picks jpg",
    JPEG_MARKED_DIR_LOWER,
];

/// Where XMP export puts marked copies of JPEG-only photos (see `export`).
pub const JPEG_MARKED_DIR: &str = "JPG bertanda";
const JPEG_MARKED_DIR_LOWER: &str = "jpg bertanda";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub id: u32,
    /// File name without extension, as the camera wrote it: `IMG_0101`.
    pub stem: String,
    /// Letters before the frame number: `IMG_`, `DSC`, `_MG_`.
    pub prefix: String,
    /// Frame number, when the name ends in digits: `IMG_0101` → 101.
    pub number: Option<u32>,
    /// Sub-folder relative to the session root ("" for the root itself).
    /// Two cameras dumped into separate folders can both have `IMG_0101`.
    pub folder: String,
    pub raw: Option<PathBuf>,
    pub jpeg: Option<PathBuf>,
}

impl Photo {
    /// Every file that belongs to this photo, RAW first.
    pub fn files(&self) -> impl Iterator<Item = &PathBuf> {
        self.raw.iter().chain(self.jpeg.iter())
    }

    /// The file to read pixels from. The camera JPEG is preferred: it is
    /// smaller to read than the RAW and is what the RAW preview is anyway.
    pub fn source(&self) -> &Path {
        self.jpeg.as_deref().or(self.raw.as_deref()).expect("photo without files")
    }

    /// Names this photo's cached thumbnail/preview: changes when the file
    /// does, so a re-shot or replaced file never shows a stale picture.
    pub fn cache_key(&self) -> String {
        let src = self.source();
        let meta = fs::metadata(src).ok();
        let stamp =
            meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok());
        let key = format!("{}|{}|{}", src.display(), meta.map_or(0, |m| m.len()), stamp.map_or(0, |d| d.as_secs()));
        format!("{:016x}", fnv(key.as_bytes()))
    }

    /// (series, frame number): photos of one camera in one folder share a
    /// series, so `IMG_0101` → `IMG_0102` is the next frame.
    pub fn frame(&self) -> Option<(u64, u32)> {
        let series = fnv(format!("{}|{}", self.folder, self.prefix.to_lowercase()).as_bytes());
        self.number.map(|n| (series, n))
    }

    pub fn display_name(&self) -> String {
        let main = self.raw.as_ref().or(self.jpeg.as_ref()).expect("photo without files");
        main.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    #[error("Folder tidak ditemukan: {0}")]
    NotFound(String),
    #[error("Folder tidak bisa dibaca: {0}")]
    Io(#[from] std::io::Error),
}

/// (folder, lowercase stem) → (stem as written, raw, jpeg)
type Found = BTreeMap<(String, String), (String, Option<PathBuf>, Option<PathBuf>)>;

/// Lists the photos under `root`, recursively, sorted by folder then name.
pub fn scan(root: &Path) -> Result<Vec<Photo>, ScanError> {
    if !root.is_dir() {
        return Err(ScanError::NotFound(root.display().to_string()));
    }
    let mut found = Found::new();
    walk(root, root, &mut found)?;

    Ok(found
        .into_iter()
        .filter(|(_, (_, raw, jpeg))| raw.is_some() || jpeg.is_some())
        .enumerate()
        .map(|(i, ((folder, _), (stem, raw, jpeg)))| {
            let (prefix, number) = split_frame_number(&stem);
            Photo { id: i as u32, stem, prefix, number, folder, raw, jpeg }
        })
        .collect())
}

fn walk(root: &Path, dir: &Path, found: &mut Found) -> Result<(), ScanError> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // Hidden files include macOS `._IMG_0101.CR3` resource forks on exFAT cards.
        if name.starts_with('.') {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_dir() {
            if !SKIP_DIRS.contains(&name.to_lowercase().as_str()) {
                walk(root, &path, found)?;
            }
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let Some(ext) = path.extension().map(|e| e.to_string_lossy().to_lowercase()) else { continue };
        let is_raw = RAW_EXTS.contains(&ext.as_str());
        let is_jpeg = JPEG_EXTS.contains(&ext.as_str());
        if !is_raw && !is_jpeg {
            continue;
        }
        let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let folder = dir.strip_prefix(root).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        let slot = found.entry((folder, stem.to_lowercase())).or_insert_with(|| (stem.clone(), None, None));
        if is_raw {
            slot.1 = Some(path);
        } else {
            slot.2 = Some(path);
        }
    }
    Ok(())
}

/// Stable 64-bit hash (FNV-1a). std's hasher may change between Rust
/// versions, and these values name files on disk.
pub fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Keeps the photos sitting directly in one of `folders` ("" = the session
/// folder itself, "Canon/jpg" = that folder at any depth). Each folder is
/// chosen on its own: picking `Canon` doesn't pick `Canon/jpg`. Ids are left
/// as they are, so they mean the same photo whatever is selected.
pub fn select(photos: Vec<Photo>, folders: &[String]) -> Vec<Photo> {
    photos.into_iter().filter(|p| folders.contains(&p.folder)).collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSummary {
    /// Path below the session folder ("" for the folder itself,
    /// "Canon/jpg" for a nested one). Counts are for photos directly in it.
    pub name: String,
    pub photos: u32,
    pub bytes: u64,
    /// "ARW" → 229 …
    pub formats: BTreeMap<String, u32>,
}

/// Photo counts per folder that holds photos, at any depth: the session
/// folder first, then by path.
pub fn summarize(photos: &[Photo]) -> Vec<FolderSummary> {
    let mut by: BTreeMap<String, FolderSummary> = BTreeMap::new();
    for p in photos {
        let f = by.entry(p.folder.clone()).or_insert_with(|| FolderSummary {
            name: p.folder.clone(),
            photos: 0,
            bytes: 0,
            formats: BTreeMap::new(),
        });
        f.photos += 1;
        f.bytes += p.files().filter_map(|x| fs::metadata(x).ok()).map(|m| m.len()).sum::<u64>();
        let main = p.raw.as_ref().or(p.jpeg.as_ref()).unwrap();
        *f.formats
            .entry(main.extension().map(|e| e.to_string_lossy().to_uppercase()).unwrap_or_default())
            .or_default() += 1;
    }
    // BTreeMap already sorts "" first.
    by.into_values().collect()
}

/// `IMG_0101` → ("IMG_", Some(101)); `DSC01234` → ("DSC", Some(1234));
/// `wedding-final` → ("wedding-final", None).
pub fn split_frame_number(stem: &str) -> (String, Option<u32>) {
    let digits = stem.chars().rev().take_while(|c| c.is_ascii_digit()).count();
    if digits == 0 || digits > 9 {
        return (stem.to_string(), None);
    }
    let (prefix, num) = stem.split_at(stem.len() - digits);
    (prefix.to_string(), num.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, rel: &str) {
        let p = dir.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, b"x").unwrap();
    }

    #[test]
    fn splits_frame_numbers() {
        assert_eq!(split_frame_number("IMG_0101"), ("IMG_".into(), Some(101)));
        assert_eq!(split_frame_number("DSC01234"), ("DSC".into(), Some(1234)));
        assert_eq!(split_frame_number("_MG_9999"), ("_MG_".into(), Some(9999)));
        assert_eq!(split_frame_number("cover"), ("cover".into(), None));
    }

    #[test]
    fn pairs_raw_and_jpeg_and_skips_noise() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        touch(d, "IMG_0101.CR3");
        touch(d, "IMG_0101.JPG");
        touch(d, "IMG_0102.cr3");
        touch(d, "._IMG_0103.CR3");
        touch(d, "notes.txt");
        touch(d, "sony/DSC_0101.ARW");
        touch(d, "sony/jpg/DSC_0101.JPG");
        touch(d, "Picks/IMG_0101.CR3");

        let photos = scan(d).unwrap();
        let names: Vec<_> = photos.iter().map(|p| (p.folder.as_str(), p.display_name())).collect();
        assert_eq!(
            names,
            vec![
                ("", "IMG_0101.CR3".into()),
                ("", "IMG_0102.cr3".into()),
                ("sony", "DSC_0101.ARW".into()),
                ("sony/jpg", "DSC_0101.JPG".into())
            ]
        );
        assert!(photos[0].jpeg.is_some() && photos[0].raw.is_some());
        assert_eq!(photos[0].source().extension().unwrap(), "JPG");

        let folders: Vec<_> = summarize(&photos).into_iter().map(|f| (f.name, f.photos)).collect();
        assert_eq!(folders, vec![("".to_string(), 2), ("sony".to_string(), 1), ("sony/jpg".to_string(), 1)]);
        let root_only = select(photos.clone(), &["".into()]);
        assert_eq!(root_only.iter().map(|p| p.id).collect::<Vec<_>>(), vec![0, 1]);
        let sony_only = select(photos.clone(), &["sony".into()]);
        assert_eq!(
            sony_only.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![2],
            "ids stay the same; nested not included"
        );
        let nested = select(photos, &["sony/jpg".into()]);
        assert_eq!(nested.iter().map(|p| p.id).collect::<Vec<_>>(), vec![3]);
    }
}
