//! Runs face + eye analysis on photos and prints what it finds (dev aid):
//! `cargo run --release --example probe_models -- <photo.jpg>...`
use pilihfotomu_desktop_lib::faces;

fn main() {
    for p in std::env::args().skip(1) {
        let img = image::open(&p).expect("open").to_rgb8();
        let t = std::time::Instant::now();
        let found = faces::analyze(&img).expect("analyze").0;
        println!("{} ({}×{}) in {:?}", p.rsplit('/').next().unwrap(), img.width(), img.height(), t.elapsed());
        for f in found {
            println!(
                "  face {:.2},{:.2} {:.2}×{:.2} score {:.2}  eyes L {:.3} R {:.3}  closed={}",
                f.x,
                f.y,
                f.w,
                f.h,
                f.score,
                f.left_eye,
                f.right_eye,
                f.eyes_closed()
            );
        }
    }
}
