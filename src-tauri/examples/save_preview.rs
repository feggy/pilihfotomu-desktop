//! Saves the embedded preview: `cargo run --example save_preview -- <raw> <out.jpg>`
fn main() {
    let a: Vec<String> = std::env::args().collect();
    pilihfotomu_desktop_lib::preview::load(std::path::Path::new(&a[1]), 4000).unwrap().image.save(&a[2]).unwrap();
}
