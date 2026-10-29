//! The native menu bar (macOS top bar, Windows window menu), in Indonesian
//! or English — the UI says which (`set_language`) and the bar is rebuilt.
//! App-specific items don't act here: they emit `menu` with their id and the
//! UI decides, since only it knows which screen is open.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

/// AppKit adds AutoFill, Start Dictation and Emoji & Symbols to whatever
/// menu is called "Edit". They do nothing useful here; these app-level
/// defaults (read when the menu is first shown) switch them off.
#[cfg(target_os = "macos")]
pub fn hide_system_edit_items() {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::string::{CFString, CFStringRef};

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFPreferencesCurrentApplication: CFStringRef;
        fn CFPreferencesSetAppValue(key: CFStringRef, value: *const std::ffi::c_void, app: CFStringRef);
    }
    for key in ["NSDisabledDictationMenuItem", "NSDisabledCharacterPaletteMenuItem", "NSDisabledAutoFillMenuItem"] {
        let k = CFString::new(key);
        unsafe {
            CFPreferencesSetAppValue(
                k.as_concrete_TypeRef(),
                CFBoolean::true_value().as_CFTypeRef(),
                kCFPreferencesCurrentApplication,
            )
        };
    }
}

#[cfg(not(target_os = "macos"))]
pub fn hide_system_edit_items() {}

/// Built in Indonesian at start; the UI switches it right after loading.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    build_in(app, false)
}

pub fn build_in<R: Runtime>(app: &AppHandle<R>, en: bool) -> tauri::Result<Menu<R>> {
    hide_system_edit_items();
    let l = |id: &'static str, english: &'static str| if en { english } else { id };
    // A shortcut written in the item's name, for items whose keys the page handles.
    let keys = |mac: &'static str, other: &'static str| if cfg!(target_os = "macos") { mac } else { other };
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
        .comments(Some(l("Pilih foto otomatis, offline.", "Automatic photo culling, offline.")))
        .build();

    let app_menu = SubmenuBuilder::new(app, "pilihfotomu")
        .item(&PredefinedMenuItem::about(app, Some(l("Tentang pilihfotomu", "About pilihfotomu")), Some(about))?)
        .separator()
        .item(&item("settings", l("Pengaturan…", "Settings…"), Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(l("Sembunyikan pilihfotomu", "Hide pilihfotomu")))?)
        .item(&PredefinedMenuItem::hide_others(app, Some(l("Sembunyikan yang lain", "Hide Others")))?)
        .item(&PredefinedMenuItem::show_all(app, Some(l("Tampilkan semua", "Show All")))?)
        .separator()
        // Not the system's Quit: the UI saves an open Buat konten design first (`quit_app`).
        .item(&item("quit", l("Keluar dari pilihfotomu", "Quit pilihfotomu"), Some("CmdOrCtrl+Q"))?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("open-folder", l("Buka folder sesi…", "Open Session Folder…"), Some("CmdOrCtrl+O"))?)
        .item(&item("open-last", l("Lanjutkan sesi terakhir", "Continue Last Session"), Some("CmdOrCtrl+Shift+O"))?)
        .item(&item("client-picks", l("Tempel pilihan klien…", "Paste Client Picks…"), Some("CmdOrCtrl+Shift+V"))?)
        .item(&item("export", l("Ekspor…", "Export…"), Some("CmdOrCtrl+E"))?)
        .separator()
        .item(&item("home", l("Beranda", "Home"), Some("CmdOrCtrl+Shift+H"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some(l("Tutup jendela", "Close Window")))?)
        .build()?;

    // Without these, ⌘C / ⌘V / ⌘A don't work in text fields on macOS.
    let edit = SubmenuBuilder::new(app, "Edit")
        // Custom, not the system items: in a text field they undo typing,
        // elsewhere the design or the culling (the UI decides). No shortcut
        // here: on macOS a menu shortcut takes ⌘Z before the page sees it, so
        // the page handles ⌘Z / ⇧⌘Z itself (app.tsx) and these are for clicking.
        .item(&item("undo", &format!("{}  {}", l("Urungkan", "Undo"), keys("⌘Z", "Ctrl+Z")), None)?)
        .item(&item("redo", &format!("{}  {}", l("Ulangi", "Redo"), keys("⇧⌘Z", "Ctrl+Shift+Z")), None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some(l("Potong", "Cut")))?)
        .item(&PredefinedMenuItem::copy(app, Some(l("Salin", "Copy")))?)
        .item(&PredefinedMenuItem::paste(app, Some(l("Tempel", "Paste")))?)
        // Likewise ⌘A: all the text in a field, all the photos in Review, all
        // the layers in Buat konten — the page decides.
        .item(&item("select-all", &format!("{}  {}", l("Pilih semua", "Select All"), keys("⌘A", "Ctrl+A")), None)?)
        .build()?;

    let view = SubmenuBuilder::new(app, l("Tampilan", "View"))
        .item(&PredefinedMenuItem::fullscreen(app, Some(l("Layar penuh", "Enter Full Screen")))?)
        .build()?;

    let window = SubmenuBuilder::new(app, l("Jendela", "Window"))
        .item(&PredefinedMenuItem::minimize(app, Some(l("Kecilkan", "Minimize")))?)
        .item(&PredefinedMenuItem::maximize(app, Some(l("Perbesar", "Zoom")))?)
        .build()?;

    let help = SubmenuBuilder::new(app, l("Bantuan", "Help"))
        .item(&item("shortcuts", l("Pintasan keyboard", "Keyboard Shortcuts"), None)?)
        .build()?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("menu", id.to_string());
    if id == "quit" {
        // The UI quits once its design is saved; should it not answer, quit anyway.
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            app.exit(0);
        });
    }
}
