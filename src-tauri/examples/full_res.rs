//! Times a full-resolution render: `cargo run --release --example full_res -- <raw> <out.jpg>`
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let t = std::time::Instant::now();
    let reference = pilihfotomu_desktop_lib::preview::load(std::path::Path::new(&a[1]), 1024).unwrap().image;
    pilihfotomu_desktop_lib::full_res::render(
        std::path::Path::new(&a[1]),
        std::path::Path::new(&a[2]),
        Some(&reference),
    )
    .unwrap();
    let (w, h) = image::image_dimensions(&a[2]).unwrap();
    println!("{w}×{h} in {:?}", t.elapsed());
}
