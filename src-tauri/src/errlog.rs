//! Errors kept on this computer only: the app is offline, so when something
//! goes wrong for a photographer the only way to see it is a file they can
//! copy from Pengaturan › Tentang and send. A crash in Rust lands here too.
//! Nothing is ever sent anywhere by the app.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

/// Past this the log starts over (the previous one kept as errors.old.log).
const MAX_BYTES: u64 = 512 * 1024;
/// Lines of the log in a copied report: the latest errors, not the whole history.
const REPORT_LINES: usize = 80;

static DIR: OnceLock<PathBuf> = OnceLock::new();

fn log_path() -> Option<PathBuf> {
    DIR.get().map(|d| d.join("errors.log"))
}

/// Where the log lives, and a crash (a Rust panic) written there before the default report.
pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = DIR.set(dir.join("logs"));
    }
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let place = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        let what = info.payload().downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_else(|| "panic".into());
        append("rust", &format!("{what}{place}"));
        default(info);
    }));
}

/// "2026-10-29 14:05:09 UTC" for now, without a date library.
fn now() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    let (y, m, d) = civil(days);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} UTC", rem / 3600, rem / 60 % 60, rem % 60)
}

/// The calendar date `days` after 1970-01-01 (Howard Hinnant's algorithm).
fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// One error, one line (its own line breaks folded), the source in brackets.
pub fn append(source: &str, message: &str) {
    let Some(path) = log_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = std::fs::rename(&path, path.with_file_name("errors.old.log"));
    }
    let line = message.trim().replace(['\r', '\n'], " ⏎ ");
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} [{}] {}", now(), source, line.chars().take(4000).collect::<String>());
    }
}

/// An error from the UI (an uncaught one, or one shown to the photographer).
#[tauri::command]
pub fn log_error(source: String, message: String) {
    append(&source, &message);
}

/// What to send when asking for help: version, system, and the latest errors.
#[tauri::command]
pub fn error_report(app: AppHandle) -> String {
    let version = app.package_info().version.to_string();
    let log = log_path().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
    let lines: Vec<&str> = log.lines().collect();
    let latest = &lines[lines.len().saturating_sub(REPORT_LINES)..];
    let mut out = format!("pilihfotomu {version} · {} {} · {}\n", std::env::consts::OS, std::env::consts::ARCH, now());
    if latest.is_empty() {
        out.push_str("Tidak ada error tercatat.\n");
    } else {
        out.push_str(&format!("{} error terakhir (dari {}):\n", latest.len(), lines.len()));
        for l in latest {
            out.push_str(l);
            out.push('\n');
        }
    }
    out
}

/// How many errors are logged, for Pengaturan › Tentang.
#[tauri::command]
pub fn error_count() -> usize {
    log_path().and_then(|p| std::fs::read_to_string(p).ok()).map(|s| s.lines().count()).unwrap_or(0)
}

/// Starts the log over (after the report was sent, say).
#[tauri::command]
pub fn clear_error_log() {
    if let Some(p) = log_path() {
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(p.with_file_name("errors.old.log"));
    }
}

#[cfg(test)]
mod tests {
    use super::civil;

    #[test]
    fn dates_from_days_since_1970() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_755), (2026, 10, 29));
        assert_eq!(civil(11_016), (2000, 2, 29));
        assert_eq!(civil(-1), (1969, 12, 31));
    }
}
