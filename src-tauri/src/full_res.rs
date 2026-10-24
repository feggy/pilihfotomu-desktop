//! Full-resolution pictures for zooming in the loupe.
//!
//! The previews cameras embed are sometimes small (Sony A7C: 1616 px for a
//! 6000 px sensor), which turns soft as soon as you zoom. On macOS the
//! system's own RAW engine (ImageIO, the one Photos and Preview use) decodes
//! the sensor data — about a second for 24 MP, no extra library to ship.
//! The result is written once as a high-quality JPEG and cached.
//!
//! On Windows the same job goes to WIC, the system imaging component, which
//! reads RAW through Microsoft's free "Raw Image Extension" (Microsoft
//! Store). Without it Windows can't open the RAW and the loupe says so.

use std::path::Path;

pub fn supported() -> bool {
    cfg!(any(target_os = "macos", windows))
}

/// Decodes `source` (RAW or JPEG) at full size, upright, into `dest` (JPEG).
///
/// The system RAW engine renders the sensor data as is, without the
/// brightening the camera applies to its own preview (Sony DRO and the
/// like), so it comes out noticeably darker. When `reference` — the camera's
/// preview — is given, each colour channel is scaled so the full picture's
/// average matches it: same look, more pixels.
pub fn render(source: &Path, dest: &Path, reference: Option<&image::DynamicImage>) -> Result<(), String> {
    imp::render(source, dest, reference)?;
    if let Some(r) = reference {
        match_brightness(dest, r)?;
    }
    Ok(())
}

fn to_linear(v: f32) -> f32 {
    (v / 255.0).powf(2.2)
}

/// Mean of each channel in linear light, on a small copy.
fn linear_means(img: &image::DynamicImage) -> [f32; 3] {
    let small = img.thumbnail(512, 512).to_rgb8();
    let mut sum = [0f64; 3];
    for p in small.pixels() {
        for c in 0..3 {
            sum[c] += to_linear(p[c] as f32) as f64;
        }
    }
    let n = small.pixels().len().max(1) as f64;
    sum.map(|s| (s / n) as f32)
}

/// Per-channel gains that bring `full` to `reference`'s average, clamped so
/// a very different crop or a broken preview can't do anything wild.
fn gains(full: [f32; 3], reference: [f32; 3]) -> [f32; 3] {
    std::array::from_fn(|c| (reference[c] / full[c].max(1e-4)).clamp(0.6, 3.0))
}

fn match_brightness(path: &Path, reference: &image::DynamicImage) -> Result<(), String> {
    use image::ImageEncoder;
    let full = image::open(path).map_err(|e| e.to_string())?;
    let g = gains(linear_means(&full), linear_means(reference));
    if g.iter().all(|x| (x - 1.0).abs() < 0.03) {
        return Ok(());
    }
    let lut: [[u8; 256]; 3] = std::array::from_fn(|c| {
        std::array::from_fn(|v| {
            let lin = to_linear(v as f32) * g[c];
            // Soft shoulder instead of a hard clip, so brightened highlights roll off.
            let lin = if lin > 0.8 { 0.8 + 0.2 * (1.0 - (-(lin - 0.8) / 0.2).exp()) } else { lin };
            (lin.powf(1.0 / 2.2) * 255.0).round().clamp(0.0, 255.0) as u8
        })
    });
    let mut rgb = full.to_rgb8();
    for p in rgb.pixels_mut() {
        for c in 0..3 {
            p[c] = lut[c][p[c] as usize];
        }
    }
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 92)
        .write_image(&rgb, rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    std::fs::write(path, out).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;
    use std::path::Path;

    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::{CFString, CFStringRef};
    use core_foundation::url::{CFURL, CFURLRef};

    type Ref = *const c_void;

    #[link(name = "ImageIO", kind = "framework")]
    unsafe extern "C" {
        fn CGImageSourceCreateWithURL(url: CFURLRef, options: Ref) -> Ref;
        fn CGImageSourceCreateThumbnailAtIndex(src: Ref, index: usize, options: Ref) -> Ref;
        fn CGImageDestinationCreateWithURL(url: CFURLRef, kind: CFStringRef, count: usize, options: Ref) -> Ref;
        fn CGImageDestinationAddImage(dest: Ref, image: Ref, properties: Ref);
        fn CGImageDestinationFinalize(dest: Ref) -> bool;
        static kCGImageSourceCreateThumbnailFromImageAlways: CFStringRef;
        static kCGImageSourceCreateThumbnailWithTransform: CFStringRef;
        static kCGImageSourceThumbnailMaxPixelSize: CFStringRef;
        static kCGImageSourceShouldCacheImmediately: CFStringRef;
        static kCGImageDestinationLossyCompressionQuality: CFStringRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(cf: Ref);
    }

    /// Releases a +1 Core Foundation object when dropped.
    struct Owned(Ref);
    impl Drop for Owned {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }

    fn url(p: &Path) -> Result<CFURL, String> {
        CFURL::from_path(p, false).ok_or_else(|| format!("path tidak valid: {}", p.display()))
    }

    pub fn render(source: &Path, dest: &Path, _reference: Option<&image::DynamicImage>) -> Result<(), String> {
        let src_url = url(source)?;
        let src = Owned(unsafe { CGImageSourceCreateWithURL(src_url.as_concrete_TypeRef(), std::ptr::null()) });
        if src.0.is_null() {
            return Err("file tidak bisa dibuka oleh macOS".into());
        }
        // A "thumbnail" as large as the sensor, built from the RAW itself
        // (not the embedded preview) and rotated upright.
        let key = |k: CFStringRef| unsafe { CFString::wrap_under_get_rule(k) };
        let yes = CFBoolean::true_value().as_CFType();
        let opts: CFDictionary<CFString, CFType> = unsafe {
            CFDictionary::from_CFType_pairs(&[
                (key(kCGImageSourceCreateThumbnailFromImageAlways), yes.clone()),
                (key(kCGImageSourceCreateThumbnailWithTransform), yes.clone()),
                (key(kCGImageSourceShouldCacheImmediately), yes),
                (key(kCGImageSourceThumbnailMaxPixelSize), CFNumber::from(100_000i64).as_CFType()),
            ])
        };
        let image = Owned(unsafe { CGImageSourceCreateThumbnailAtIndex(src.0, 0, opts.as_concrete_TypeRef().cast()) });
        if image.0.is_null() {
            return Err("RAW tidak bisa di-decode oleh macOS".into());
        }

        let tmp = dest.with_extension("jpg.pilihfotomu-tmp");
        let dst_url = url(&tmp)?;
        let jpeg = CFString::from_static_string("public.jpeg");
        let out = Owned(unsafe {
            CGImageDestinationCreateWithURL(
                dst_url.as_concrete_TypeRef(),
                jpeg.as_concrete_TypeRef(),
                1,
                std::ptr::null(),
            )
        });
        if out.0.is_null() {
            return Err("file hasil tidak bisa dibuat".into());
        }
        let props: CFDictionary<CFString, CFType> = unsafe {
            CFDictionary::from_CFType_pairs(&[(
                key(kCGImageDestinationLossyCompressionQuality),
                CFNumber::from(0.9f64).as_CFType(),
            )])
        };
        unsafe { CGImageDestinationAddImage(out.0, image.0, props.as_concrete_TypeRef().cast()) };
        if !unsafe { CGImageDestinationFinalize(out.0) } {
            return Err("gagal menulis JPEG".into());
        }
        std::fs::rename(&tmp, dest).map_err(|e| e.to_string())
    }
}

/// Writes `img` to `dest` as a high-quality JPEG, through a temporary file.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn save(img: &image::RgbImage, dest: &Path) -> Result<(), String> {
    use image::ImageEncoder;
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90)
        .write_image(img, img.width(), img.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    let tmp = dest.with_extension("jpg.pilihfotomu-tmp");
    std::fs::write(&tmp, out).and_then(|_| std::fs::rename(&tmp, dest)).map_err(|e| e.to_string())
}

/// Turns sensor-orientation pixels upright. A quarter turn is only applied
/// when the picture's shape disagrees with the (upright) camera preview, in
/// case a RAW codec already turned it.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn upright(
    img: image::DynamicImage,
    orientation: Option<u8>,
    reference: Option<&image::DynamicImage>,
) -> image::DynamicImage {
    let Some(o) = orientation.and_then(image::metadata::Orientation::from_exif) else { return img };
    let quarter = matches!(orientation, Some(5..=8));
    if quarter
        && let Some(r) = reference
        && (img.width() > img.height()) == (r.width() > r.height())
    {
        return img;
    }
    let mut img = img;
    img.apply_orientation(o);
    img
}

#[cfg(windows)]
mod imp {
    use std::path::Path;

    use windows::Win32::Foundation::GENERIC_READ;
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_WICPixelFormat24bppRGB, IWICImagingFactory, WICBitmapDitherTypeNone,
        WICBitmapPaletteTypeCustom, WICDecodeMetadataCacheOnDemand,
    };
    use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
    use windows::core::HSTRING;

    /// WINCODEC_ERR_COMPONENTNOTFOUND: no codec for this file type.
    const NO_CODEC: i32 = 0x88982F50_u32 as i32;

    pub fn render(source: &Path, dest: &Path, reference: Option<&image::DynamicImage>) -> Result<(), String> {
        let is_jpeg =
            source.extension().is_some_and(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg"));
        if is_jpeg {
            // A camera JPEG is already full size; no system codec needed.
            let loaded = crate::preview::load(source, u32::MAX).map_err(|e| e.to_string())?;
            return super::save(&loaded.image.to_rgb8(), dest);
        }
        let (w, h, pixels) = decode(source).map_err(|e| {
            if e.code().0 == NO_CODEC {
                "Windows belum bisa membaca RAW ini. Pasang “Raw Image Extension” (gratis) dari Microsoft Store, lalu coba lagi."
                    .to_string()
            } else {
                format!("RAW tidak bisa di-decode oleh Windows: {}", e.message())
            }
        })?;
        let img = image::RgbImage::from_raw(w, h, pixels).ok_or("hasil decode tidak lengkap")?;
        let orientation = crate::preview::orientation(source);
        let img = super::upright(image::DynamicImage::ImageRgb8(img), orientation, reference);
        super::save(&img.to_rgb8(), dest)
    }

    fn decode(source: &Path) -> windows::core::Result<(u32, u32, Vec<u8>)> {
        unsafe {
            // Already initialised on this thread (any mode) is fine too.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let factory: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
            let path = HSTRING::from(source.as_os_str());
            let decoder =
                factory.CreateDecoderFromFilename(&path, None, GENERIC_READ, WICDecodeMetadataCacheOnDemand)?;
            let frame = decoder.GetFrame(0)?;
            let converter = factory.CreateFormatConverter()?;
            converter.Initialize(
                &frame,
                &GUID_WICPixelFormat24bppRGB,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            )?;
            let (mut w, mut h) = (0, 0);
            converter.GetSize(&mut w, &mut h)?;
            let stride = w * 3;
            let mut pixels = vec![0u8; stride as usize * h as usize];
            converter.CopyPixels(std::ptr::null(), stride, &mut pixels)?;
            Ok((w, h, pixels))
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod imp {
    use std::path::Path;

    pub fn render(_source: &Path, _dest: &Path, _reference: Option<&image::DynamicImage>) -> Result<(), String> {
        Err("Kualitas penuh belum tersedia di sistem operasi ini.".into())
    }
}

#[cfg(test)]
mod orientation_tests {
    use super::*;

    #[test]
    fn turns_upright_once() {
        let sensor = image::DynamicImage::new_rgb8(60, 40);
        let preview_portrait = image::DynamicImage::new_rgb8(20, 30);
        let turned = upright(sensor.clone(), Some(6), Some(&preview_portrait));
        assert_eq!((turned.width(), turned.height()), (40, 60));
        // Codec already turned it: shape matches the preview, left alone.
        let already = image::DynamicImage::new_rgb8(40, 60);
        let same = upright(already, Some(6), Some(&preview_portrait));
        assert_eq!((same.width(), same.height()), (40, 60));
        assert_eq!(upright(sensor, None, None).width(), 60);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use image::{ImageEncoder, RgbImage, codecs::jpeg::JpegEncoder};

    #[test]
    fn renders_a_jpeg_at_full_size() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("in.jpg");
        let img = RgbImage::from_pixel(1200, 800, image::Rgb([90, 120, 150]));
        let mut bytes = Vec::new();
        JpegEncoder::new_with_quality(&mut bytes, 90)
            .write_image(&img, 1200, 800, image::ExtendedColorType::Rgb8)
            .unwrap();
        std::fs::write(&src, bytes).unwrap();
        let out = tmp.path().join("out.jpg");
        render(&src, &out, None).unwrap();
        let back = image::open(&out).unwrap();
        assert_eq!((back.width(), back.height()), (1200, 800));

        // A darker render is pulled up to the reference's brightness.
        let bright = image::DynamicImage::ImageRgb8(RgbImage::from_pixel(300, 200, image::Rgb([150, 170, 190])));
        render(&src, &out, Some(&bright)).unwrap();
        let px = image::open(&out).unwrap().to_rgb8().get_pixel(600, 400).0;
        assert!(px.iter().zip([150u8, 170, 190]).all(|(a, b)| a.abs_diff(b) <= 6), "{px:?}");
    }
}
