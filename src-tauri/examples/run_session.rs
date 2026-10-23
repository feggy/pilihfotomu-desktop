//! Full analysis of a folder, printing timing and what was flagged:
//! `cargo run --release --example run_session -- <folder> <cache dir>`
use std::sync::atomic::AtomicBool;

use pilihfotomu_desktop_lib::{cull::Options, session};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let cache = std::path::PathBuf::from(&a[2]);
    let t = std::time::Instant::now();
    let s = session::analyze(
        std::path::Path::new(&a[1]),
        &["".into()],
        Options::default(),
        &cache.join("thumbs"),
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    let count = |s: &session::Session, k: &str| {
        s.photos.iter().filter(|p| serde_json::to_string(&p.reasons).unwrap().contains(k)).count()
    };
    println!(
        "{} foto in {:?} · eyesClosed {} · subjectSoft {} · smile★ via faces",
        s.photos.len(),
        t.elapsed(),
        count(&s, "eyesClosed"),
        count(&s, "subjectSoft"),
    );
    for p in s.photos.iter().filter(|p| {
        serde_json::to_string(&p.reasons).unwrap().contains("eyesClosed")
            || serde_json::to_string(&p.reasons).unwrap().contains("subjectSoft")
    }) {
        println!("  {} {:?} {:?}", p.name, p.status, p.reasons);
    }
}
