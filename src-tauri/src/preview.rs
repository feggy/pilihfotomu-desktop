//! Getting pixels and shot metadata out of a photo file without decoding RAW.
//!
//! Every RAW format embeds a camera-rendered JPEG preview (usually full size
//! or close to it). Culling only needs to judge focus, exposure and
//! similarity, so that preview is enough — and it is tens of times faster than
//! demosaicing the sensor data.

use serde::Serialize;
use std::fs;
use std::io::Cursor;
use std::path::Path;

use exif::{In, Reader, Tag, Value};
use image::metadata::Orientation;
use image::{DynamicImage, ImageFormat};

#[derive(Debug, thiserror::Error)]
pub enum PreviewError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("tidak ada preview JPEG di dalam file")]
    NoPreview,
    #[error("preview tidak bisa dibaca: {0}")]
    Decode(#[from] image::ImageError),
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ShotInfo {
    /// Seconds since 1970 in camera local time (cameras store no zone).
    /// Only differences matter here — they are what groups a burst.
    pub taken_at: Option<f64>,
    /// EXIF orientation 1–8.
    pub orientation: Option<u8>,
    /// "Canon EOS R6", "ILCE-7M4" — what the photographer calls "kamera A".
    pub camera: Option<String>,
}

impl ShotInfo {
    fn or(self, other: ShotInfo) -> ShotInfo {
        ShotInfo {
            taken_at: self.taken_at.or(other.taken_at),
            orientation: self.orientation.or(other.orientation),
            camera: self.camera.or(other.camera),
        }
    }
}

pub struct Loaded {
    /// Upright, shrunk to at most `max_side` on the long edge.
    pub image: DynamicImage,
    pub info: ShotInfo,
}

/// Reads `path` (RAW or JPEG) and returns its preview, upright and shrunk.
pub fn load(path: &Path, max_side: u32) -> Result<Loaded, PreviewError> {
    load_data(&fs::read(path)?, max_side)
}

/// `load`, plus the EXIF fields worth carrying into a new JPEG (`exif_block`).
pub fn load_with_exif(path: &Path, max_side: u32) -> Result<(Loaded, Vec<exif::Field>), PreviewError> {
    let data = fs::read(path)?;
    Ok((load_data(&data, max_side)?, exif_fields(&data)))
}

fn load_data(data: &[u8], max_side: u32) -> Result<Loaded, PreviewError> {
    let is_jpeg = data.starts_with(&[0xFF, 0xD8]);
    let jpeg = if is_jpeg { data } else { largest_embedded_jpeg(data).ok_or(PreviewError::NoPreview)? };

    // The RAW container holds the real EXIF; embedded previews often have
    // none, or a copy without orientation.
    let info = if is_jpeg { ShotInfo::default() } else { raw_shot_info(data) }.or(exif_info(jpeg));

    let mut image = image::load_from_memory_with_format(jpeg, ImageFormat::Jpeg)?;
    if image.width().max(image.height()) > max_side {
        image = image.thumbnail(max_side, max_side);
    }
    if let Some(o) = info.orientation.and_then(Orientation::from_exif) {
        image.apply_orientation(o);
    }
    Ok(Loaded { image, info })
}

/// Finds the JPEG inside a RAW file with the most pixels.
///
/// RAWs carry several JPEGs (a 160 px thumbnail, a mid-size preview, often a
/// full-size one). Each candidate is walked marker by marker, so a `FF D9`
/// that merely appears inside compressed data or inside a nested EXIF
/// thumbnail does not end it early.
pub fn largest_embedded_jpeg(data: &[u8]) -> Option<&[u8]> {
    let mut best: Option<(&[u8], u64)> = None;
    let mut i = 0;
    while i + 3 < data.len() {
        if data[i] == 0xFF
            && data[i + 1] == 0xD8
            && data[i + 2] == 0xFF
            && let Some((len, w, h)) = walk_jpeg(&data[i..])
        {
            let area = w as u64 * h as u64;
            if best.is_none_or(|(_, a)| area > a) {
                best = Some((&data[i..i + len], area));
            }
            // Skip past it: nothing inside a valid JPEG is a better candidate.
            i += len;
            continue;
        }
        i += 1;
    }
    best.map(|(b, _)| b)
}

/// Returns (byte length, width, height) of the baseline/progressive JPEG at
/// the start of `d`, or None if it isn't one.
fn walk_jpeg(d: &[u8]) -> Option<(usize, u16, u16)> {
    let mut p = 2; // after SOI
    let mut size = None;
    loop {
        if p + 4 > d.len() || d[p] != 0xFF {
            return None;
        }
        let marker = d[p + 1];
        match marker {
            0xD9 => return size.map(|(w, h)| (p + 2, w, h)),
            0xFF => p += 1, // fill byte
            0x01 | 0xD0..=0xD7 => p += 2,
            _ => {
                let seg = u16::from_be_bytes([d[p + 2], d[p + 3]]) as usize;
                if seg < 2 || p + 2 + seg > d.len() {
                    return None;
                }
                // Frame header with the dimensions. Only baseline, extended and
                // progressive DCT count: CR2 and DNG store the sensor data itself
                // as *lossless* JPEG (SOF3), which is large but not a picture the
                // decoder can show.
                if matches!(marker, 0xC0..=0xC2) && seg >= 7 {
                    let h = u16::from_be_bytes([d[p + 5], d[p + 6]]);
                    let w = u16::from_be_bytes([d[p + 7], d[p + 8]]);
                    if w > 0 && h > 0 {
                        size = Some((w, h));
                    }
                }
                p += 2 + seg;
                if marker == 0xDA {
                    // Entropy-coded data: runs until a marker that isn't a
                    // stuffed zero or a restart marker.
                    while p + 1 < d.len() {
                        if d[p] == 0xFF && d[p + 1] != 0x00 && !(0xD0..=0xD7).contains(&d[p + 1]) {
                            break;
                        }
                        p += 1;
                    }
                }
            }
        }
    }
}

/// Fields a JPEG made from this photo should keep: when, with what, how.
/// Orientation and sizes are left out — they describe the new pixels, and
/// `exif_block` writes them fresh.
const KEEP: &[Tag] = &[
    Tag::Make,
    Tag::Model,
    Tag::Artist,
    Tag::Copyright,
    Tag::DateTime,
    Tag::DateTimeOriginal,
    Tag::DateTimeDigitized,
    Tag::SubSecTimeOriginal,
    Tag::OffsetTimeOriginal,
    Tag::ExposureTime,
    Tag::FNumber,
    Tag::ExposureProgram,
    Tag::PhotographicSensitivity,
    Tag::ExposureBiasValue,
    Tag::MeteringMode,
    Tag::Flash,
    Tag::FocalLength,
    Tag::FocalLengthIn35mmFilm,
    Tag::WhiteBalance,
    Tag::LensMake,
    Tag::LensModel,
    Tag::BodySerialNumber,
];

/// The `KEEP` fields of a RAW or JPEG file. CR3 keeps them in two TIFF
/// blocks (CMT1, CMT2) whose tags all read as IFD0, so fields are matched
/// by number and given their proper tag back.
pub fn exif_fields(data: &[u8]) -> Vec<exif::Field> {
    let mut sources = Vec::new();
    if let Ok(e) = Reader::new().read_from_container(&mut Cursor::new(data)) {
        sources.push(e);
    } else if !data.starts_with(&[0xFF, 0xD8]) {
        let head = &data[..data.len().min(1 << 20)];
        for name in [b"CMT1", b"CMT2"] {
            if let Some(tiff) = iso_box(head, name)
                && let Ok(e) = Reader::new().read_raw(tiff.to_vec())
            {
                sources.push(e);
            }
        }
    }
    let mut out: Vec<exif::Field> = Vec::new();
    for e in &sources {
        for f in e.fields().filter(|f| f.ifd_num == In::PRIMARY) {
            let Some(&tag) = KEEP.iter().find(|t| t.number() == f.tag.number()) else { continue };
            if !out.iter().any(|o| o.tag == tag) {
                out.push(exif::Field { tag, ifd_num: In::PRIMARY, value: f.value.clone() });
            }
        }
    }
    out
}

/// An EXIF TIFF block for a new `width`×`height` upright JPEG with `fields`;
/// None when there is nothing to say.
pub fn exif_block(fields: &[exif::Field], width: u32, height: u32) -> Option<Vec<u8>> {
    if fields.is_empty() {
        return None;
    }
    let extra = [
        exif::Field { tag: Tag::Orientation, ifd_num: In::PRIMARY, value: Value::Short(vec![1]) },
        exif::Field { tag: Tag::PixelXDimension, ifd_num: In::PRIMARY, value: Value::Long(vec![width]) },
        exif::Field { tag: Tag::PixelYDimension, ifd_num: In::PRIMARY, value: Value::Long(vec![height]) },
    ];
    let mut w = exif::experimental::Writer::new();
    for f in fields.iter().chain(&extra) {
        w.push_field(f);
    }
    let mut buf = Cursor::new(Vec::new());
    w.write(&mut buf, false).ok()?;
    Some(buf.into_inner())
}

/// EXIF orientation (1–8) of a RAW or JPEG file.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn orientation(path: &Path) -> Option<u8> {
    let data = fs::read(path).ok()?;
    if data.starts_with(&[0xFF, 0xD8]) { exif_info(&data) } else { raw_shot_info(&data) }.orientation
}

/// Shot metadata from the RAW container itself.
/// The lens a photo was taken with, as its EXIF says (Edit foto › Lens
/// Corrections looks it up in lensfun's database).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LensInfo {
    pub make: Option<String>,
    pub model: Option<String>,
    pub lens: Option<String>,
    /// Millimetres, as set.
    pub focal: Option<f64>,
    pub aperture: Option<f64>,
    /// The same field of view on full frame: with `focal`, the sensor's crop factor.
    pub focal35: Option<f64>,
    /// Shown under Edit foto's histogram, as Lightroom does.
    pub iso: Option<f64>,
    /// Seconds.
    pub exposure: Option<f64>,
}

/// `LensInfo` from a photo's bytes (a JPEG, a TIFF-based RAW, or a CR3).
pub fn lens_info(data: &[u8]) -> LensInfo {
    let mut sources = Vec::new();
    if let Ok(e) = Reader::new().read_from_container(&mut Cursor::new(data)) {
        sources.push(e);
    } else if !data.starts_with(&[0xFF, 0xD8]) {
        let head = &data[..data.len().min(1 << 20)];
        for name in [b"CMT1", b"CMT2"] {
            if let Some(tiff) = iso_box(head, name)
                && let Ok(e) = Reader::new().read_raw(tiff.to_vec())
            {
                sources.push(e);
            }
        }
    }
    let text = |tag: Tag| {
        sources.iter().find_map(|e| {
            let f = e.get_field(tag, In::PRIMARY)?;
            let Value::Ascii(ref parts) = f.value else { return None };
            let s = std::str::from_utf8(parts.first()?).ok()?.trim_matches(char::from(0)).trim().to_string();
            (!s.is_empty()).then_some(s)
        })
    };
    let number = |tag: Tag| {
        sources.iter().find_map(|e| {
            let f = e.get_field(tag, In::PRIMARY)?;
            match &f.value {
                Value::Rational(v) => v.first().map(|r| r.to_f64()),
                Value::Short(v) => v.first().map(|&n| n as f64),
                Value::Long(v) => v.first().map(|&n| n as f64),
                _ => None,
            }
            .filter(|v| v.is_finite() && *v > 0.0)
        })
    };
    LensInfo {
        make: text(Tag::Make),
        model: text(Tag::Model),
        lens: text(Tag::LensModel),
        focal: number(Tag::FocalLength),
        aperture: number(Tag::FNumber),
        focal35: number(Tag::FocalLengthIn35mmFilm),
        iso: number(Tag::PhotographicSensitivity),
        exposure: number(Tag::ExposureTime),
    }
}

fn raw_shot_info(data: &[u8]) -> ShotInfo {
    // TIFF-based RAWs (CR2, NEF, ARW, DNG, ORF, RW2…) are read directly.
    if let Ok(exif) = Reader::new().read_from_container(&mut Cursor::new(data)) {
        return info_from(&exif);
    }
    // CR3 is an ISO media file; its EXIF lives in TIFF blobs inside the
    // CMT1 (IFD0: orientation) and CMT2 (Exif IFD: capture time) boxes.
    let head = &data[..data.len().min(1 << 20)];
    let mut info = ShotInfo::default();
    for name in [b"CMT1", b"CMT2"] {
        if let Some(tiff) = iso_box(head, name)
            && let Ok(exif) = Reader::new().read_raw(tiff.to_vec())
        {
            info = info.or(info_from(&exif));
        }
    }
    info
}

/// Payload of the first ISO-BMFF box called `name` (searched, not parsed —
/// CR3 nests these boxes inside a vendor `uuid` box).
fn iso_box<'a>(data: &'a [u8], name: &[u8; 4]) -> Option<&'a [u8]> {
    let at = data.windows(4).position(|w| w == name)?;
    let start = at.checked_sub(4)?;
    let size = u32::from_be_bytes(data[start..at].try_into().ok()?) as usize;
    data.get(at + 4..start + size)
}

fn exif_info(jpeg: &[u8]) -> ShotInfo {
    Reader::new().read_from_container(&mut Cursor::new(jpeg)).map(|e| info_from(&e)).unwrap_or_default()
}

fn info_from(exif: &exif::Exif) -> ShotInfo {
    let orientation = exif
        .get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .and_then(|v| u8::try_from(v).ok())
        .filter(|v| (1..=8).contains(v));
    let taken_at = [Tag::DateTimeOriginal, Tag::DateTime].iter().find_map(|tag| {
        let field = exif.get_field(*tag, In::PRIMARY)?;
        let Value::Ascii(ref parts) = field.value else { return None };
        let dt = exif::DateTime::from_ascii(parts.first()?).ok()?;
        let sub = exif
            .get_field(Tag::SubSecTimeOriginal, In::PRIMARY)
            .and_then(|f| match &f.value {
                Value::Ascii(v) => v
                    .first()
                    .and_then(|s| std::str::from_utf8(s).ok()?.trim().parse::<u32>().ok().map(|n| (n, s.len()))),
                _ => None,
            })
            .map(|(n, digits)| n as f64 / 10f64.powi(digits as i32))
            .unwrap_or(0.0);
        Some(
            epoch_seconds(dt.year as i64, dt.month as i64, dt.day as i64)
                + dt.hour as f64 * 3600.0
                + dt.minute as f64 * 60.0
                + dt.second as f64
                + sub,
        )
    });
    let text = |tag| match &exif.get_field(tag, In::PRIMARY)?.value {
        Value::Ascii(v) => {
            let s = std::str::from_utf8(v.first()?).ok()?.trim_matches(|c: char| c == '\0' || c.is_whitespace());
            (!s.is_empty()).then(|| s.to_string())
        }
        _ => None,
    };
    let camera = camera_name(text(Tag::Make), text(Tag::Model));
    ShotInfo { taken_at, orientation, camera }
}

/// "Canon" + "Canon EOS R6" → "Canon EOS R6"; "SONY" + "ILCE-7M4" → "SONY ILCE-7M4";
/// "NIKON CORPORATION" + "NIKON Z 6_2" → "NIKON Z 6_2".
fn camera_name(make: Option<String>, model: Option<String>) -> Option<String> {
    let brand = make.map(|m| m.split_whitespace().next().unwrap_or_default().to_string()).filter(|b| !b.is_empty());
    match (brand, model) {
        (Some(b), Some(m)) if m.to_lowercase().starts_with(&b.to_lowercase()) => Some(m),
        (Some(b), Some(m)) => Some(format!("{b} {m}")),
        (None, m) => m,
        (b, None) => b,
    }
}

/// Seconds from 1970-01-01 to the given civil date (days-from-civil, H. Hinnant).
fn epoch_seconds(y: i64, m: i64, d: i64) -> f64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    ((era * 146_097 + doe - 719_468) * 86_400) as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageEncoder, RgbImage, codecs::jpeg::JpegEncoder};

    fn jpeg_of(w: u32, h: u32) -> Vec<u8> {
        let img = RgbImage::from_fn(w, h, |x, y| image::Rgb([(x * 7) as u8, (y * 3) as u8, 90]));
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, 80).write_image(&img, w, h, image::ExtendedColorType::Rgb8).unwrap();
        out
    }

    #[test]
    fn picks_the_largest_embedded_preview() {
        let small = jpeg_of(32, 24);
        let big = jpeg_of(320, 240);
        // Fake RAW: header junk, thumbnail, sensor-ish noise with stray FF D8/FF D9, preview.
        let mut raw = b"II*\0junkjunk".to_vec();
        raw.extend(&small);
        raw.extend([0x12, 0xFF, 0xD8, 0x00, 0xFF, 0xD9, 0x55]);
        raw.extend(&big);
        raw.extend(b"trailing sensor data");

        let found = largest_embedded_jpeg(&raw).unwrap();
        assert_eq!(found, &big[..]);

        // CR2-style sensor data: a lossless (SOF3) JPEG far larger than the preview.
        let mut lossless =
            vec![0xFF, 0xD8, 0xFF, 0xC3, 0x00, 0x0B, 0x0E, 0x10, 0x00, 0x20, 0x00, 0x01, 0x01, 0x11, 0x00];
        lossless.extend([0xFF, 0xDA, 0x00, 0x02, 0x12, 0x34, 0xFF, 0xD9]);
        raw.extend(&lossless);
        assert_eq!(largest_embedded_jpeg(&raw).unwrap(), &big[..]);
    }

    #[test]
    fn names_cameras() {
        let n = |a: &str, b: &str| camera_name(Some(a.into()), Some(b.into())).unwrap();
        assert_eq!(n("Canon", "Canon EOS R6"), "Canon EOS R6");
        assert_eq!(n("SONY", "ILCE-7M4"), "SONY ILCE-7M4");
        assert_eq!(n("NIKON CORPORATION", "NIKON Z 6_2"), "NIKON Z 6_2");
    }

    #[test]
    fn computes_epoch_seconds() {
        assert_eq!(epoch_seconds(1970, 1, 1), 0.0);
        assert_eq!(epoch_seconds(2026, 10, 12), 1_791_763_200.0);
    }
}
