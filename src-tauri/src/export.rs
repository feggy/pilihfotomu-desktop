//! Getting results out: XMP sidecars (Lightroom Classic, Capture One, Photo
//! Mechanic all read the same file), marked copies of JPEG-only photos, and
//! copying files.

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
    /// JPEG-only photos copied with the marks written inside
    /// (`JPEG_MARKED_DIR`), when asked for.
    pub marked_jpeg: u32,
    pub marked_folder: Option<String>,
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
        Status::Pick => "pilih",
        Status::Maybe => "cek",
        Status::Reject => "lewati",
    }
}

fn reason_word(r: &Reason) -> Option<&'static str> {
    Some(match r {
        Reason::Blur => "blur",
        Reason::SoftFocus => "kurang tajam",
        Reason::SubjectSoft => "subjek kurang tajam",
        Reason::Dark => "gelap",
        Reason::Bright => "terang",
        Reason::Duplicate { .. } => "duplikat",
        Reason::EyesClosed { .. } => "mata mungkin terpejam",
        Reason::BestInGroup => "terbaik di grup",
        Reason::Similar { .. } => "pose mirip",
        Reason::OverLimit { .. } => "melebihi batas jumlah",
    })
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Edit foto's settings as Lightroom's Camera Raw settings (`crs:`), worked
/// out by the page (src/edit/lightroom.ts): plain values, and the ordered
/// lists (tone curves) as `rdf:Seq`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Develop {
    pub attrs: Vec<(String, String)>,
    pub seqs: Vec<(String, Vec<String>)>,
}

/// A `crs:` property name as Adobe writes them; anything else is left out.
fn crs_name(n: &str) -> bool {
    !n.is_empty() && n.len() < 64 && n.chars().all(|c| c.is_ascii_alphanumeric())
}

/// The XMP packet for one photo. Lightroom and Capture One read label, stars
/// and keywords; Photo Mechanic also its own Tagged flag (= Pick), which the
/// others ignore.
pub fn xmp_document(m: &Mark, with_reasons: bool) -> String {
    xmp_with_develop(m, with_reasons, None)
}

/// As `xmp_document`, with Edit foto's settings for Lightroom to pick up.
pub fn xmp_with_develop(m: &Mark, with_reasons: bool, develop: Option<&Develop>) -> String {
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
    let (crs_ns, crs_attrs, crs_seqs) = match develop {
        Some(d) => (
            "\n    xmlns:crs=\"http://ns.adobe.com/camera-raw-settings/1.0/\"",
            d.attrs
                .iter()
                .filter(|(n, _)| crs_name(n))
                .map(|(n, v)| format!("\n   crs:{n}=\"{}\"", escape(v)))
                .collect::<String>(),
            d.seqs
                .iter()
                .filter(|(n, _)| crs_name(n))
                .map(|(n, items)| format!("   <crs:{n}>\n    <rdf:Seq>\n{}    </rdf:Seq>\n   </crs:{n}>\n", bag(items)))
                .collect::<String>(),
        ),
        None => ("", String::new(), String::new()),
    };
    format!(
        r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="pilihfotomu">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
    xmlns:photomechanic="http://ns.camerabits.com/photomechanic/1.0/"{crs_ns}
   xmp:Rating="{rating}"
   xmp:Label="{label}"
   photomechanic:Tagged="{tagged}"{crs_attrs}>
{crs_seqs}
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
        tagged = if m.status == Status::Pick { "True" } else { "False" },
        flat = bag(&flat),
        tree = bag(&tree),
    )
}

/// `IMG_0101.CR3` → `IMG_0101.xmp`, the name Lightroom looks for.
pub fn sidecar_path(raw: &Path) -> PathBuf {
    raw.with_extension("xmp")
}

/// Writes a sidecar next to every RAW. JPEG-only photos can't have one that
/// Lightroom reads; with `jpeg_copies` (a folder) they are copied there with
/// the marks written inside the copy instead.
pub fn write_xmp(marks: &[Mark], existing: Existing, with_reasons: bool, jpeg_copies: Option<&Path>) -> ExportReport {
    let mut report = ExportReport::default();
    for m in marks {
        let Some(raw) = &m.photo.raw else {
            match (jpeg_copies, &m.photo.jpeg) {
                (Some(dir), Some(jpeg)) => {
                    report.marked_folder = Some(dir.display().to_string());
                    match write_marked_copy(jpeg, dir, &xmp_document(m, with_reasons)) {
                        Ok(()) => report.marked_jpeg += 1,
                        Err(e) => report.failed.push(format!("{}: {e}", m.photo.display_name())),
                    }
                }
                _ => report.skipped_jpeg += 1,
            }
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

/// Edit foto › XMP untuk Lightroom: a sidecar with the marks and the edit
/// next to each RAW. A sidecar this app didn't write (it may hold the
/// photographer's own Lightroom edits) is left alone and counted as skipped.
pub fn write_develop_xmp(items: &[(Mark, Develop)], with_reasons: bool) -> ExportReport {
    let mut report = ExportReport::default();
    for (m, d) in items {
        let Some(raw) = &m.photo.raw else {
            report.skipped_jpeg += 1;
            continue;
        };
        let path = sidecar_path(raw);
        if let Ok(old) = fs::read(&path)
            && !old.windows(OUR_XMP.len()).any(|w| w == OUR_XMP)
        {
            report.skipped_existing += 1;
            continue;
        }
        match write_atomic(&path, xmp_with_develop(m, with_reasons, Some(d)).as_bytes()) {
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

/// Marker of a file this app wrote; only such copies are ever replaced.
const OUR_XMP: &[u8] = br#"x:xmptk="pilihfotomu""#;

/// Copies `jpeg` into `dir` with `xmp` embedded. A copy from an earlier
/// export is replaced (the marks may have changed since); a file with the
/// same name that this app didn't write is left alone.
fn write_marked_copy(jpeg: &Path, dir: &Path, xmp: &str) -> Result<(), String> {
    let name = jpeg.file_name().ok_or("nama file tidak valid")?;
    let target = dir.join(name);
    if let Ok(old) = fs::read(&target)
        && !old.windows(OUR_XMP.len()).any(|w| w == OUR_XMP)
    {
        return Err("sudah ada file lain dengan nama sama di folder tujuan".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let data = fs::read(jpeg).map_err(|e| e.to_string())?;
    let out = jpeg_with_xmp(&data, xmp).ok_or("bukan file JPEG yang bisa dibaca")?;
    let tmp = target.with_extension("jpg.pilihfotomu-tmp");
    fs::write(&tmp, out).and_then(|_| fs::rename(&tmp, &target)).map_err(|e| e.to_string())
}

const XMP_SIG: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const EXIF_SIG: &[u8] = b"Exif\0\0";

/// (marker, whole segment incl. FF xx + length).
type Segment<'a> = (u8, &'a [u8]);

/// Header segments of a JPEG, up to the first one that isn't an APPn/COM;
/// and where the rest starts.
fn header_segments(d: &[u8]) -> Option<(Vec<Segment<'_>>, usize)> {
    if !d.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut segs = Vec::new();
    let mut p = 2;
    while p + 4 <= d.len() && d[p] == 0xFF && (matches!(d[p + 1], 0xE0..=0xEF) || d[p + 1] == 0xFE) {
        let len = u16::from_be_bytes([d[p + 2], d[p + 3]]) as usize;
        if len < 2 || p + 2 + len > d.len() {
            return None;
        }
        segs.push((d[p + 1], &d[p..p + 2 + len]));
        p += 2 + len;
    }
    Some((segs, p))
}

fn app1(sig: &[u8], payload: &[u8]) -> Option<Vec<u8>> {
    let len = u16::try_from(2 + sig.len() + payload.len()).ok()?;
    let mut seg = vec![0xFF, 0xE1];
    seg.extend(len.to_be_bytes());
    seg.extend(sig);
    seg.extend(payload);
    Some(seg)
}

/// Rebuilds a JPEG's header: JFIF first, then `exif` (or the file's own
/// EXIF when None), then `xmp` (or the file's own), then everything else.
/// The image data is copied untouched.
fn rebuild_header(d: &[u8], exif: Option<&[u8]>, xmp: Option<&[u8]>) -> Option<Vec<u8>> {
    let (segs, rest) = header_segments(d)?;
    let is = |seg: &[u8], sig: &[u8]| seg.len() > 4 && seg[4..].starts_with(sig);
    let mut out = vec![0xFF, 0xD8];
    for (m, seg) in &segs {
        if *m == 0xE0 {
            out.extend(*seg);
        }
    }
    match exif {
        Some(e) => out.extend(app1(EXIF_SIG, e)?),
        None => segs.iter().filter(|(m, s)| *m == 0xE1 && is(s, EXIF_SIG)).for_each(|(_, s)| out.extend(*s)),
    }
    match xmp {
        Some(x) => out.extend(app1(XMP_SIG, x)?),
        None => segs.iter().filter(|(m, s)| *m == 0xE1 && is(s, XMP_SIG)).for_each(|(_, s)| out.extend(*s)),
    }
    for (m, seg) in &segs {
        if *m != 0xE0 && !(*m == 0xE1 && (is(seg, EXIF_SIG) || is(seg, XMP_SIG))) {
            out.extend(*seg);
        }
    }
    out.extend(&d[rest..]);
    Some(out)
}

/// `jpeg` with `xmp` as its XMP packet (any older one replaced).
pub fn jpeg_with_xmp(jpeg: &[u8], xmp: &str) -> Option<Vec<u8>> {
    let packet = format!("<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n{xmp}<?xpacket end=\"w\"?>");
    rebuild_header(jpeg, None, Some(packet.as_bytes()))
}

/// `jpeg` with `tiff` (an EXIF TIFF block) as its EXIF.
pub fn jpeg_with_exif(jpeg: &[u8], tiff: &[u8]) -> Option<Vec<u8>> {
    rebuild_header(jpeg, Some(tiff), None)
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
    let (loaded, exif) = crate::preview::load_with_exif(p.source(), u32::MAX).map_err(|e| e.to_string())?;
    // A RAW + JPEG pair: the RAW's EXIF when the camera JPEG has none.
    let exif = if exif.is_empty() && p.jpeg.is_some() {
        p.raw.as_deref().and_then(|r| fs::read(r).ok()).map(|d| crate::preview::exif_fields(&d)).unwrap_or_default()
    } else {
        exif
    };
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
    // Date, camera, lens and settings travel along: galleries sort by them.
    // A JPEG without them is still a good JPEG.
    if let Some(tiff) = crate::preview::exif_block(&exif, rgb.width(), rgb.height())
        && let Some(with) = jpeg_with_exif(&out, &tiff)
    {
        out = with;
    }
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
    fn develop_settings_go_into_the_sidecar_ours_only() {
        let tmp = tempfile::tempdir().unwrap();
        let p = photo(tmp.path(), "IMG_0007", false);
        let d = Develop {
            attrs: vec![("Exposure2012".into(), "+0.35".into()), ("Bad Name\"".into(), "x".into())],
            seqs: vec![("ToneCurvePV2012".into(), vec!["0, 0".into(), "255, 255".into()])],
        };
        let m = Mark { photo: &p, status: Status::Pick, rating: 4, reasons: &[] };
        let doc = xmp_with_develop(&m, false, Some(&d));
        assert!(doc.contains("xmlns:crs=") && doc.contains(r#"crs:Exposure2012="+0.35""#));
        assert!(doc.contains("<crs:ToneCurvePV2012>") && doc.contains("<rdf:li>255, 255</rdf:li>"));
        assert!(!doc.contains("Bad Name"), "only names Adobe would write");

        let r = write_develop_xmp(&[(Mark { photo: &p, status: Status::Pick, rating: 4, reasons: &[] }, d.clone())], false);
        assert_eq!(r.written, 1);
        // Lightroom's own sidecar (the photographer's edits) is left alone.
        let side = sidecar_path(p.raw.as_ref().unwrap());
        fs::write(&side, "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Adobe XMP Core\"/>").unwrap();
        let r = write_develop_xmp(&[(Mark { photo: &p, status: Status::Pick, rating: 4, reasons: &[] }, d)], false);
        assert_eq!((r.written, r.skipped_existing), (0, 1));
        assert!(fs::read_to_string(&side).unwrap().contains("Adobe XMP Core"));
    }

    #[test]
    fn writes_sidecar_and_respects_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let p = photo(tmp.path(), "IMG_0001", false);
        let reasons = [Reason::Duplicate { of: 3 }];
        let mark = Mark { photo: &p, status: Status::Reject, rating: 1, reasons: &reasons };

        let r = write_xmp(std::slice::from_ref(&mark), Existing::Skip, true, None);
        assert_eq!(r.written, 1);
        let xml = fs::read_to_string(tmp.path().join("IMG_0001.xmp")).unwrap();
        assert!(xml.contains(r#"xmp:Rating="1""#));
        assert!(xml.contains(r#"xmp:Label="Red""#));
        assert!(xml.contains("<rdf:li>pilihfotomu|lewati|duplikat</rdf:li>"));
        assert!(xml.contains(r#"photomechanic:Tagged="False""#));

        fs::write(tmp.path().join("IMG_0001.xmp"), "edits from lightroom").unwrap();
        let r = write_xmp(&[mark], Existing::Skip, true, None);
        assert_eq!((r.written, r.skipped_existing), (0, 1));
        assert_eq!(fs::read_to_string(tmp.path().join("IMG_0001.xmp")).unwrap(), "edits from lightroom");
    }

    fn real_jpeg(path: &Path) {
        let img = image::RgbImage::from_pixel(40, 30, image::Rgb([120, 80, 40]));
        let mut bytes = Vec::new();
        JpegEncoder::new_with_quality(&mut bytes, 90)
            .write_image(&img, 40, 30, image::ExtendedColorType::Rgb8)
            .unwrap();
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn jpeg_only_photos_get_a_marked_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("IMG_0005.JPG");
        real_jpeg(&src);
        let original = fs::read(&src).unwrap();
        let p = Photo { raw: None, jpeg: Some(src.clone()), ..photo(tmp.path(), "IMG_0005", false) };
        let mark = Mark { photo: &p, status: Status::Pick, rating: 5, reasons: &[] };
        let dir = tmp.path().join(crate::scan::JPEG_MARKED_DIR);

        let r = write_xmp(std::slice::from_ref(&mark), Existing::Skip, true, Some(&dir));
        assert_eq!((r.marked_jpeg, r.skipped_jpeg), (1, 0));
        let copy = fs::read(dir.join("IMG_0005.JPG")).unwrap();
        let text = String::from_utf8_lossy(&copy);
        assert!(text.contains(r#"xmp:Rating="5""#) && text.contains(r#"photomechanic:Tagged="True""#));
        assert_eq!(image::load_from_memory(&copy).unwrap().width(), 40, "still a valid JPEG");
        assert_eq!(fs::read(&src).unwrap(), original, "original untouched");

        // A second export replaces our own copy, never someone else's file.
        let lewati = Mark { status: Status::Reject, rating: 1, ..mark };
        assert_eq!(write_xmp(std::slice::from_ref(&lewati), Existing::Skip, true, Some(&dir)).marked_jpeg, 1);
        let again = String::from_utf8_lossy(&fs::read(dir.join("IMG_0005.JPG")).unwrap()).into_owned();
        assert!(again.contains(r#"xmp:Rating="1""#) && again.matches("xpacket begin").count() == 1);
        fs::write(dir.join("IMG_0005.JPG"), b"someone else's").unwrap();
        assert_eq!(write_xmp(&[lewati], Existing::Skip, true, Some(&dir)).failed.len(), 1);
        // Without the option they are skipped, as before.
        assert_eq!(write_xmp(&[mark], Existing::Skip, true, None).skipped_jpeg, 1);
    }

    #[test]
    fn new_jpegs_keep_the_camera_exif() {
        use exif::{Field, In, Tag, Value};
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("IMG_0006.JPG");
        real_jpeg(&src);
        let fields = [
            Field { tag: Tag::Model, ifd_num: In::PRIMARY, value: Value::Ascii(vec![b"Canon EOS R6".to_vec()]) },
            Field { tag: Tag::Orientation, ifd_num: In::PRIMARY, value: Value::Short(vec![6]) },
            Field {
                tag: Tag::DateTimeOriginal,
                ifd_num: In::PRIMARY,
                value: Value::Ascii(vec![b"2026:10:12 14:03:22".to_vec()]),
            },
        ];
        let mut w = exif::experimental::Writer::new();
        fields.iter().for_each(|f| w.push_field(f));
        let mut tiff = std::io::Cursor::new(Vec::new());
        w.write(&mut tiff, false).unwrap();
        fs::write(&src, jpeg_with_exif(&fs::read(&src).unwrap(), tiff.get_ref()).unwrap()).unwrap();

        let p = Photo { raw: None, jpeg: Some(src), ..photo(tmp.path(), "IMG_0006", false) };
        let r =
            export_jpegs(&[&p], &tmp.path().join("out"), JpegOptions { scale_percent: 100, quality: 85 }, |_, _| {});
        assert_eq!(r.smallest, Some((30, 40)), "turned upright");
        let out = fs::read(tmp.path().join("out/IMG_0006.jpg")).unwrap();
        let e = exif::Reader::new().read_from_container(&mut std::io::Cursor::new(&out)).unwrap();
        let text = |t| e.get_field(t, In::PRIMARY).unwrap().display_value().to_string();
        assert_eq!(text(Tag::Model), "\"Canon EOS R6\"");
        assert!(text(Tag::DateTimeOriginal).starts_with("2026-10-12 14:03:22"));
        assert_eq!(
            e.get_field(Tag::Orientation, In::PRIMARY).unwrap().value.get_uint(0),
            Some(1),
            "pixels already upright"
        );
        assert!(image::load_from_memory(&out).is_ok());
    }

    #[test]
    fn copies_pairs_once() {
        let tmp = tempfile::tempdir().unwrap();
        let p = photo(tmp.path(), "IMG_0002", true);
        let dest = tmp.path().join("Dipilih");
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
