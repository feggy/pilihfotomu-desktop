//! Saves each face crop with its eye points drawn, for checking eye
//! decisions by eye: `cargo run --release --example eye_debug -- <out dir> <photo>...`
use pilihfotomu_desktop_lib::{faces, preview};

const EYES: [usize; 12] = [362, 263, 385, 380, 387, 373, 33, 133, 160, 144, 158, 153];

fn main() {
    let mut args = std::env::args().skip(1);
    let out = std::path::PathBuf::from(args.next().expect("out dir"));
    std::fs::create_dir_all(&out).unwrap();
    for p in args {
        let loaded = preview::load(std::path::Path::new(&p), 2048).expect("load");
        let name = std::path::Path::new(&p).file_stem().unwrap().to_string_lossy().to_string();
        for (i, (f, mut crop, pts)) in faces::debug(&loaded.image.to_rgb8()).unwrap().into_iter().enumerate() {
            let iris = |c: usize| (pts[c + 1].0 - pts[c + 3].0).hypot(pts[c + 1].1 - pts[c + 3].1);
            let gap = |a: usize, b: usize| (pts[a].0 - pts[b].0).hypot(pts[a].1 - pts[b].1);
            // Eyelid gap relative to iris size: scale-free and not tied to eye shape.
            let l = (gap(386, 374)) / iris(473).max(1e-3);
            let r = (gap(159, 145)) / iris(468).max(1e-3);
            for (k, &e) in EYES.iter().chain([468usize, 473].iter()).enumerate() {
                let (x, y) = pts[e];
                let color = if k >= 12 { [255, 220, 0] } else { [255, 40, 40] };
                for dx in -1i32..=1 {
                    for dy in -1i32..=1 {
                        let (px, py) = (x as i32 + dx, y as i32 + dy);
                        if (0..256).contains(&px) && (0..256).contains(&py) {
                            crop.put_pixel(px as u32, py as u32, image::Rgb(color));
                        }
                    }
                }
            }
            // Iris visible? Darkest 3×3 patch along the lid gap at the iris
            // centre vs. the skin just below the eye.
            let lum = |x: f32, y: f32| {
                let mut best = f32::MAX;
                for oy in -2..=2 {
                    for ox in -6..=6 {
                        let mut s = 0.0;
                        for dy in -1..=1 {
                            for dx in -1..=1 {
                                let px = crop.get_pixel(
                                    (x as i32 + ox + dx).clamp(0, 255) as u32,
                                    (y as i32 + oy + dy).clamp(0, 255) as u32,
                                );
                                s += 0.299 * px[0] as f32 + 0.587 * px[1] as f32 + 0.114 * px[2] as f32;
                            }
                        }
                        best = best.min(s / 9.0);
                    }
                }
                best
            };
            let skin = |x: f32, y: f32, w: f32| {
                let mut s = 0.0;
                let mut n = 0.0;
                for dx in -4..=4 {
                    let px = crop
                        .get_pixel((x as i32 + dx).clamp(0, 255) as u32, ((y + w * 0.45) as i32).clamp(0, 255) as u32);
                    s += 0.299 * px[0] as f32 + 0.587 * px[1] as f32 + 0.114 * px[2] as f32;
                    n += 1.0;
                }
                s / n
            };
            let wl = gap(362, 263);
            let wr = gap(33, 133);
            let (il, ir) = (pts[473], pts[468]);
            let dark_l = lum(il.0, il.1) / skin(il.0, il.1, wl).max(1.0);
            let dark_r = lum(ir.0, ir.1) / skin(ir.0, ir.1, wr).max(1.0);
            println!("   iris/skin L {dark_l:.2} R {dark_r:.2}");
            let fw = gap(234, 454).max(1e-3);
            let width = gap(61, 291) / fw;
            let lift = ((pts[13].1 + pts[14].1) / 2.0 - (pts[61].1 + pts[291].1) / 2.0) / fw;
            let open = gap(13, 14) / fw;
            println!("   mouth width {width:.3} lift {lift:.3} open {open:.3}");
            let file = out.join(format!("{name}_f{i}.jpg"));
            crop.save(&file).unwrap();
            println!(
                "{name} f{i} size {:.3}  EAR L {:.3} R {:.3}  gap/iris L {:.2} R {:.2}  closed={}  smile {:?}",
                f.w,
                f.left_eye,
                f.right_eye,
                l,
                r,
                f.eyes_closed(),
                f.smile.map(|s| (s * 100.0).round() / 100.0)
            );
        }
    }
}
