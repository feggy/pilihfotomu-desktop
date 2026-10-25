//! Saves each face as SFace sees it (aligned, 112 px) with its vector, for
//! checking who-is-who by eye: `cargo run --release --example people_debug -- <out dir> <photo>...`
use pilihfotomu_desktop_lib::{faces, preview};

fn main() {
    let mut args = std::env::args().skip(1);
    let out = std::path::PathBuf::from(args.next().expect("out dir"));
    std::fs::create_dir_all(&out).unwrap();
    let mut vectors = Vec::new();
    for p in args {
        let loaded = preview::load(std::path::Path::new(&p), 2048).expect("load");
        let name = std::path::Path::new(&p).file_stem().unwrap().to_string_lossy().to_string();
        for (i, (crop, v)) in faces::debug_ids(&loaded.image.to_rgb8()).unwrap().into_iter().enumerate() {
            let file = format!("{name}_f{i}.jpg");
            crop.save(out.join(&file)).unwrap();
            vectors.push(serde_json::json!({ "file": file, "v": v }));
        }
    }
    std::fs::write(out.join("vectors.json"), serde_json::to_string(&vectors).unwrap()).unwrap();
}
