//! Face vs whole-frame sharpness, for calibration:
//! `cargo run --release --example face_sharp -- <photo>...`
use pilihfotomu_desktop_lib::{analyze, faces, preview};

fn main() {
    for p in std::env::args().skip(1) {
        let l = preview::load(std::path::Path::new(&p), 2048).unwrap();
        let g = l.image.to_luma8();
        let frame = analyze::measure(&l.image.thumbnail(1024, 1024)).sharpness;
        let fs = faces::analyze(&l.image.to_rgb8()).unwrap();
        let name = std::path::Path::new(&p).file_stem().unwrap().to_string_lossy().to_string();
        let parts: Vec<String> = fs
            .iter()
            .map(|f| {
                format!("{:.0}px var {:.0}", f.w * g.width() as f32, analyze::face_variance(&g, f.x, f.y, f.w, f.h))
            })
            .collect();
        println!("{name} frame {frame:.0} | {}", parts.join(" | "));
    }
}
