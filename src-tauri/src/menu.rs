//! The native menu bar (macOS top bar, Windows window menu), in Indonesian.
//! App-specific items don't act here: they emit `menu` with their id and the
//! UI decides, since only it knows which screen is open.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, text);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };
    let about = AboutMetadataBuilder::new()
        .name(Some("pilihfotomu"))
        .version(Some(app.package_info().version.to_string()))
        .comments(Some("Pilih foto otomatis, offline."))
        .build();

    let app_menu = SubmenuBuilder::new(app, "pilihfotomu")
        .item(&PredefinedMenuItem::about(app, Some("Tentang pilihfotomu"), Some(about))?)
        .separator()
        .item(&item("settings", "Pengaturan…", Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Sembunyikan pilihfotomu"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("Sembunyikan yang lain"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("Tampilkan semua"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Keluar dari pilihfotomu"))?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("open-folder", "Buka folder sesi…", Some("CmdOrCtrl+O"))?)
        .item(&item("client-picks", "Tempel pilihan klien…", Some("CmdOrCtrl+Shift+V"))?)
        .item(&item("export", "Ekspor…", Some("CmdOrCtrl+E"))?)
        .separator()
        .item(&item("home", "Beranda", Some("CmdOrCtrl+Shift+H"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some("Tutup jendela"))?)
        .build()?;

    // Without these, ⌘C / ⌘V / ⌘A don't work in text fields on macOS.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, Some("Urungkan"))?)
        .item(&PredefinedMenuItem::redo(app, Some("Ulangi"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("Potong"))?)
        .item(&PredefinedMenuItem::copy(app, Some("Salin"))?)
        .item(&PredefinedMenuItem::paste(app, Some("Tempel"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("Pilih semua"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "Tampilan")
        .item(&PredefinedMenuItem::fullscreen(app, Some("Layar penuh"))?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Jendela")
        .item(&PredefinedMenuItem::minimize(app, Some("Kecilkan"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("Perbesar"))?)
        .build()?;

    let help = SubmenuBuilder::new(app, "Bantuan").item(&item("shortcuts", "Pintasan keyboard", None)?).build()?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("menu", id.to_string());
}
