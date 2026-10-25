//! Saves the Hapus latar mask of photos, for checking by eye:
//! `cargo run --release --example cutout_debug -- <out dir> <potret|objek> <photo>...`
use pilihfotomu_desktop_lib::cutout::{self, Mode, OBJECT_SIDE};

fn main() {
    let mut args = std::env::args().skip(1);
    let out = std::path::PathBuf::from(args.next().expect("out dir"));
    let mode = Mode::parse(&args.next().expect("mode")).expect("potret or objek");
    std::fs::create_dir_all(&out).unwrap();
    for p in args {
        let img = image::open(&p).expect("open").to_rgb8();
        let (w, h) = match mode {
            Mode::Portrait => {
                let k = 512.0 / img.width().min(img.height()) as f32;
                let r = |v: u32| (((v as f32 * k) / 32.0).round() as u32).max(1) * 32;
                (r(img.width()), r(img.height()))
            }
            Mode::Object => (OBJECT_SIDE, OBJECT_SIDE),
        };
        let small = image::imageops::resize(&img, w, h, image::imageops::FilterType::Triangle);
        let t = std::time::Instant::now();
        let alpha = cutout::mask(mode, w, h, small.as_raw()).expect("mask");
        let name = std::path::Path::new(&p).file_stem().unwrap().to_string_lossy().to_string();
        // Raw alpha bytes, `w`×`h` (the image crate here builds without PNG).
        std::fs::write(out.join(format!("{name}-{w}x{h}.alpha")), &alpha).unwrap();
        println!("{name}: {w}×{h} in {:?}", t.elapsed());
    }
}
