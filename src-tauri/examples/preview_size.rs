//! Prints the size of the largest embedded preview: `cargo run --example preview_size -- <raw>...`
fn main() {
    for p in std::env::args().skip(1) {
        let l = pilihfotomu_desktop_lib::preview::load(std::path::Path::new(&p), u32::MAX).unwrap();
        println!("{p}: {}×{}", l.image.width(), l.image.height());
    }
}
