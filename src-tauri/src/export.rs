//! Getting results out: XMP sidecars for Lightroom, and copying files.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use image::ImageEncoder;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::cull::{Reason, Status};
use crate::scan::Photo;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Existing {
    /// Leave a sidecar that is already there untouched. It may hold the
    /// photographer's Lightroom edits, which a fresh file would wipe out.
    #[default]
    Skip,
    Overwrite,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub written: u32,
    pub skipped_existing: u32,
    /// JPEG-only photos: Lightroom reads their metadata from inside the
    /// file, not from a sidecar, and originals are never modified.
    pub skipped_jpeg: u32,
    pub failed: Vec<String>,
}

pub struct Mark<'a> {
    pub photo: &'a Photo,
    pub status: Status,
    pub rating: u8,
    pub reasons: &'a [Reason],
}

/// Lightroom's default label set names; a custom set in Lightroom shows
/// these as plain text instead of colors.
fn label(status: Status) -> &'static str {
    match status {
        Status::Pick => "Green",
        Status::Maybe => "Yellow",
        Status::Reject => "Red",
    }
}

fn status_word(status: Status) -> &'static str {
    match status {
        Status::Pick => "pick",
        Status::Maybe => "maybe",
        Status::Reject => "reject",
    }
}

fn reason_word(r: &Reason) -> Option<&'static str> {
    Some(match r {
        Reason::Blur => "blur",
        Reason::SoftFocus => "kurang tajam",
        Reason::Dark => "gelap",
        Reason::Bright => "terang",
        Reason::Duplicate { .. } => "duplikat",
        Reason::EyesClosed { .. } => "mata terpejam",
        Reason::BestInGroup => "terbaik di grup",
    })
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

pub fn xmp_document(m: &Mark, with_reasons: bool) -> String {
    let mut flat = vec!["pilihfotomu".to_string()];
    let mut tree = vec![format!("pilihfotomu|{}", status_word(m.status))];
    if with_reasons {
        for w in m.reasons.iter().filter_map(reason_word) {
            flat.push(w.to_string());
            tree.push(format!("pilihfotomu|{}|{w}", status_word(m.status)));
        }
    }
    let bag =
        |items: &[String]| items.iter().map(|i| format!("     <rdf:li>{}</rdf:li>\n", escape(i))).collect::<String>();
    format!(
        r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="pilihfotomu">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
   xmp:Rating="{rating}"
   xmp:Label="{label}">
   <dc:subject>
    <rdf:Bag>
{flat}    </rdf:Bag>
   </dc:subject>
   <lr:hierarchicalSubject>
    <rdf:Bag>
{tree}    </rdf:Bag>
   </lr:hierarchicalSubject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
"#,
        rating = m.rating.min(5),
        label = label(m.status),
        flat = bag(&flat),
        tree = bag(&tree),
    )
}

/// `IMG_0101.CR3` → `IMG_0101.xmp`, the name Lightroom looks for.
pub fn sidecar_path(raw: &Path) -> PathBuf {
    raw.with_extension("xmp")
}

pub fn write_xmp(marks: &[Mark], existing: Existing, with_reasons: bool) -> ExportReport {
    let mut report = ExportReport::default();
    for m in marks {
        let Some(raw) = &m.photo.raw else {
            report.skipped_jpeg += 1;
            continue;
        };
        let path = sidecar_path(raw);
        if path.exists() && existing == Existing::Skip {
            report.skipped_existing += 1;
            continue;
        }
        match write_atomic(&path, xmp_document(m, with_reasons).as_bytes()) {
            Ok(()) => report.written += 1,
            Err(e) => report.failed.push(format!("{}: {e}", m.photo.display_name())),
        }
    }
    report
}

/// Writes next to the target then renames, so a crash never leaves Lightroom
/// a half-written sidecar.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("xmp.pilihfotomu-tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyReport {
    pub copied: u32,
    pub already_there: u32,
    pub failed: Vec<String>,
    pub folder: String,
}

/// Copies every file of `photos` (RAW + JPEG + an existing sidecar) into
/// `dest`. Files already there with the same name and size are left alone,
/// so running it twice is harmless.
pub fn copy_photos(photos: &[&Photo], dest: &Path) -> CopyReport {
    let mut report = CopyReport { folder: dest.display().to_string(), ..Default::default() };
    if let Err(e) = fs::create_dir_all(dest) {
        report.failed.push(format!("{}: {e}", dest.display()));
        return report;
    }
    for p in photos {
        let sidecar = p.raw.as_ref().map(|r| sidecar_path(r)).filter(|s| s.exists());
        for src in p.files().cloned().chain(sidecar) {
            let Some(name) = src.file_name() else { continue };
            let target = dest.join(name);
            let same = fs::metadata(&target).ok().zip(fs::metadata(&src).ok()).is_some_and(|(a, b)| a.len() == b.len());
            if same {
                report.already_there += 1;
                continue;
            }
            match fs::copy(&src, &target) {
                Ok(_) => report.copied += 1,
                Err(e) => report.failed.push(format!("{}: {e}", name.to_string_lossy())),
            }
        }
    }
    report
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JpegOptions {
    /// Long and short edge scale, 10–100 %.
    pub scale_percent: u32,
    /// JPEG quality 50–100.
    pub quality: u8,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JpegReport {
    pub written: u32,
    pub already_there: u32,
    pub failed: Vec<String>,
    pub folder: String,
    /// Smallest and largest output, so a camera with a small embedded
    /// preview (older Sony bodies: ~1600 px) shows up in the summary.
    pub smallest: Option<(u32, u32)>,
    pub largest: Option<(u32, u32)>,
}

/// Writes one JPEG per photo into `dest`, scaled. The pixels come from the
/// camera JPEG when the photo has one, otherwise from the preview the camera
/// embedded in the RAW — colors are exactly what the camera showed, but its
/// size is whatever that camera stores. Existing files are never replaced.
pub fn export_jpegs(
    photos: &[&Photo],
    dest: &Path,
    opts: JpegOptions,
    progress: impl Fn(u32, u32) + Sync,
) -> JpegReport {
    let mut report = JpegReport { folder: dest.display().to_string(), ..Default::default() };
    if let Err(e) = fs::create_dir_all(dest) {
        report.failed.push(format!("{}: {e}", dest.display()));
        return report;
    }
    let scale = opts.scale_percent.clamp(10, 100);
    let quality = opts.quality.clamp(50, 100);
    let total = photos.len() as u32;
    let done = AtomicU32::new(0);
    let shared = Mutex::new(report);

    photos.par_iter().for_each(|p| {
        let target = dest.join(format!("{}.jpg", p.stem));
        let outcome = if target.exists() { Ok(None) } else { render_jpeg(p, &target, scale, quality).map(Some) };
        let mut r = shared.lock().unwrap();
        match outcome {
            Ok(None) => r.already_there += 1,
            Ok(Some((w, h))) => {
                r.written += 1;
                let area = |d: (u32, u32)| d.0 as u64 * d.1 as u64;
                if r.smallest.is_none_or(|s| area((w, h)) < area(s)) {
                    r.smallest = Some((w, h));
                }
                if r.largest.is_none_or(|l| area((w, h)) > area(l)) {
                    r.largest = Some((w, h));
                }
            }
            Err(e) => r.failed.push(format!("{}: {e}", p.display_name())),
        }
        drop(r);
        progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);
    });
    shared.into_inner().unwrap()
}

fn render_jpeg(p: &Photo, target: &Path, scale: u32, quality: u8) -> Result<(u32, u32), String> {
    let loaded = crate::preview::load(p.source(), u32::MAX).map_err(|e| e.to_string())?;
    let mut img = loaded.image;
    if scale < 100 {
        let w = (img.width() * scale / 100).max(1);
        let h = (img.height() * scale / 100).max(1);
        img = img.resize_exact(w, h, FilterType::Lanczos3);
    }
    let rgb = img.to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality)
        .write_image(&rgb, rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    let tmp = target.with_extension("jpg.pilihfotomu-tmp");
    fs::write(&tmp, out).and_then(|_| fs::rename(&tmp, target)).map_err(|e| e.to_string())?;
    Ok((rgb.width(), rgb.height()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn photo(dir: &Path, stem: &str, jpeg: bool) -> Photo {
        let raw = dir.join(format!("{stem}.CR3"));
        fs::write(&raw, b"raw").unwrap();
        let jpg = jpeg.then(|| {
            let j = dir.join(format!("{stem}.JPG"));
            fs::write(&j, b"jpg").unwrap();
            j
        });
        Photo {
            id: 0,
            stem: stem.into(),
            prefix: "IMG_".into(),
            number: Some(1),
            folder: String::new(),
            raw: Some(raw),
            jpeg: jpg,
        }
    }

    #[test]
    fn writes_sidecar_and_respects_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let p = photo(tmp.path(), "IMG_0001", false);
        let reasons = [Reason::Duplicate { of: 3 }];
        let mark = Mark { photo: &p, status: Status::Reject, rating: 1, reasons: &reasons };

        let r = write_xmp(std::slice::from_ref(&mark), Existing::Skip, true);
        assert_eq!(r.written, 1);
        let xml = fs::read_to_string(tmp.path().join("IMG_0001.xmp")).unwrap();
        assert!(xml.contains(r#"xmp:Rating="1""#));
        assert!(xml.contains(r#"xmp:Label="Red""#));
        assert!(xml.contains("<rdf:li>pilihfotomu|reject|duplikat</rdf:li>"));

        fs::write(tmp.path().join("IMG_0001.xmp"), "edits from lightroom").unwrap();
        let r = write_xmp(&[mark], Existing::Skip, true);
        assert_eq!((r.written, r.skipped_existing), (0, 1));
        assert_eq!(fs::read_to_string(tmp.path().join("IMG_0001.xmp")).unwrap(), "edits from lightroom");
    }

    #[test]
    fn copies_pairs_once() {
        let tmp = tempfile::tempdir().unwrap();
        let p = photo(tmp.path(), "IMG_0002", true);
        let dest = tmp.path().join("Picks");
        let first = copy_photos(&[&p], &dest);
        assert_eq!(first.copied, 2);
        let again = copy_photos(&[&p], &dest);
        assert_eq!((again.copied, again.already_there), (0, 2));
    }

    #[test]
    fn exports_scaled_jpegs_once() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("IMG_0003.JPG");
        let img = image::RgbImage::from_pixel(400, 300, image::Rgb([120, 80, 40]));
        let mut bytes = Vec::new();
        JpegEncoder::new_with_quality(&mut bytes, 90)
            .write_image(&img, 400, 300, image::ExtendedColorType::Rgb8)
            .unwrap();
        fs::write(&src, bytes).unwrap();
        let p = Photo {
            id: 0,
            stem: "IMG_0003".into(),
            prefix: "IMG_".into(),
            number: Some(3),
            folder: String::new(),
            raw: None,
            jpeg: Some(src),
        };
        let dest = tmp.path().join("Picks JPG");

        let r = export_jpegs(&[&p], &dest, JpegOptions { scale_percent: 50, quality: 85 }, |_, _| {});
        assert_eq!((r.written, r.smallest), (1, Some((200, 150))));
        let again = export_jpegs(&[&p], &dest, JpegOptions { scale_percent: 50, quality: 85 }, |_, _| {});
        assert_eq!((again.written, again.already_there), (0, 1));
    }
}
