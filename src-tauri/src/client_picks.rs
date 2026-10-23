//! Reading a client's WhatsApp message ("kak aku pilih IMG_0101, 102, 110-115
//! ya 🙏") and finding the photos it names.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use crate::scan::Photo;

/// Ranges longer than this are almost always a typo ("1-1500").
const MAX_RANGE: u32 = 300;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    /// How it is shown back: "0101", "DSC_0465".
    pub label: String,
    /// Letters typed in front of the number, normalized ("DSC"), if any.
    pub prefix: Option<String>,
    pub number: u32,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickResult {
    /// What the message was read as, for the "Terbaca sebagai" chips.
    pub read_as: Vec<String>,
    pub found: Vec<Found>,
    pub ambiguous: Vec<Ambiguous>,
    pub not_found: Vec<NotFound>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub query: String,
    pub photo_id: u32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ambiguous {
    pub query: String,
    pub candidates: Vec<u32>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotFound {
    pub query: String,
    pub suggestions: Vec<u32>,
}

static TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?ix)
        \b (?P<p1>[a-z_]{0,6}) (?P<n1>\d{1,6})
        (?: \s* (?: - | – | — | s\s*/?\s*d | sampai | sampe | hingga | to ) \s*
            (?P<p2>[a-z_]{0,6}) (?P<n2>\d{1,6}) )?
        ",
    )
    .unwrap()
});

fn norm_prefix(p: &str) -> Option<String> {
    let p: String = p.chars().filter(|c| c.is_ascii_alphabetic()).collect::<String>().to_uppercase();
    (!p.is_empty()).then_some(p)
}

/// Splits the message into photo numbers. Words, emoji and punctuation are
/// ignored; numbers are kept as typed so they can be shown back.
pub fn parse(text: &str) -> (Vec<Query>, Vec<String>, Vec<String>) {
    let mut queries = Vec::new();
    let mut read_as = Vec::new();
    let mut warnings = Vec::new();
    let mut seen = HashSet::new();
    let mut push = |q: Query, queries: &mut Vec<Query>| {
        if seen.insert((q.prefix.clone(), q.number)) {
            queries.push(q);
        }
    };

    for c in TOKEN.captures_iter(text) {
        let whole = c.get(0).unwrap();
        let p1 = c.name("p1").map_or("", |m| m.as_str());
        // ".CR3", ".jpg2" — a file extension, not a photo number.
        if !p1.is_empty() && text[..whole.start()].ends_with('.') {
            continue;
        }
        // "8k2mq…" — digits inside a word (a hash-like file name), not a number.
        if text[whole.end()..].chars().next().is_some_and(|c| c.is_alphanumeric() || c == '_') {
            continue;
        }
        let n1s = c.name("n1").unwrap().as_str();
        let Ok(n1) = n1s.parse::<u32>() else { continue };
        let prefix = norm_prefix(p1);
        let label = |n: &str| match &prefix {
            Some(_) if p1.len() > 1 => format!("{p1}{n}"),
            _ => n.to_string(),
        };

        match c.name("n2") {
            None => {
                read_as.push(label(n1s));
                push(Query { label: label(n1s), prefix: prefix.clone(), number: n1 }, &mut queries);
            }
            Some(m2) => {
                let n2s = m2.as_str();
                let Ok(mut n2) = n2s.parse::<u32>() else { continue };
                // "125-34" is shorthand for 125–134.
                if n2 < n1 && n2s.len() < n1s.len() {
                    let keep = &n1s[..n1s.len() - n2s.len()];
                    n2 = format!("{keep}{n2s}").parse().unwrap_or(n2);
                }
                let (lo, hi) = (n1.min(n2), n1.max(n2));
                if hi - lo + 1 > MAX_RANGE {
                    warnings.push(format!(
                        "Rentang {n1s}–{n2s} terlalu panjang ({} foto), dilewati. Salah ketik?",
                        hi - lo + 1
                    ));
                    continue;
                }
                let width = n1s.len();
                read_as.push(format!("{}–{:0width$}", label(n1s), hi));
                for n in lo..=hi {
                    let s = format!("{n:0width$}");
                    push(Query { label: label(&s), prefix: prefix.clone(), number: n }, &mut queries);
                }
            }
        }
    }
    (queries, read_as, warnings)
}

/// More hits than this for a partial name means the text was too vague to
/// be a pick ("Image", "Gemini").
const MAX_NAME_HITS: usize = 8;

const EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "heic", "tif", "tiff"];

/// "“Gemini_Generated_Image_abc.jpg”," → "Gemini_Generated_Image_abc".
fn clean_token(raw: &str) -> &str {
    let t = raw.trim_matches(|c: char| !(c.is_alphanumeric() || c == '_' || c == '-'));
    match t.rsplit_once('.') {
        Some((stem, ext))
            if EXTENSIONS.contains(&ext.to_lowercase().as_str())
                || crate::scan::RAW_EXTS.contains(&ext.to_lowercase().as_str()) =>
        {
            stem
        }
        _ => t,
    }
}

/// Names that don't end in a frame number (phone exports, AI images,
/// renamed files) still look like file names: letters, digits, separators.
fn looks_like_file_name(t: &str) -> bool {
    t.len() >= 8
        && t.chars().any(|c| c.is_alphabetic())
        && t.chars().any(|c| c.is_ascii_digit())
        && t.contains(['_', '-'])
}

/// Parses `text` and looks every photo it names up in `photos`: whole or
/// partial file names first, then frame numbers in whatever is left.
pub fn resolve(text: &str, photos: &[Photo]) -> PickResult {
    let mut out = PickResult::default();
    let mut taken: HashSet<u32> = HashSet::new();
    // Everything not claimed by a file name goes on to the number parser,
    // in order, so "110 - 115" still reads as a range.
    let mut rest = String::with_capacity(text.len());

    for raw in text.split(|c: char| c.is_whitespace() || matches!(c, ',' | ';')) {
        let tok = clean_token(raw);
        let lower = tok.to_lowercase();
        let numeric = !parse(tok).0.is_empty();
        let exact: Vec<u32> = photos.iter().filter(|p| p.stem.to_lowercase() == lower).map(|p| p.id).collect();
        // Partial names only when the token isn't a frame number already —
        // "IMG_01" must not match a hundred files.
        let hits = if !exact.is_empty() || numeric || tok.len() < 6 || !tok.chars().any(|c| c.is_alphabetic()) {
            exact
        } else {
            photos.iter().filter(|p| p.stem.to_lowercase().contains(&lower)).map(|p| p.id).collect()
        };
        match hits.len() {
            0 if looks_like_file_name(tok) && !numeric => {
                out.read_as.push(tok.to_string());
                out.not_found.push(NotFound { query: tok.to_string(), suggestions: vec![] });
            }
            0 => {
                rest.push_str(raw);
                rest.push(' ');
            }
            1 => {
                out.read_as.push(tok.to_string());
                if taken.insert(hits[0]) {
                    out.found.push(Found { query: tok.to_string(), photo_id: hits[0] });
                }
            }
            n if n <= MAX_NAME_HITS => {
                out.read_as.push(tok.to_string());
                out.ambiguous.push(Ambiguous { query: tok.to_string(), candidates: hits });
            }
            _ => {
                rest.push_str(raw);
                rest.push(' ');
            }
        }
    }

    let (queries, read_as, warnings) = parse(&rest);
    out.read_as.extend(read_as);
    out.warnings = warnings;
    let known: HashSet<String> = photos.iter().filter_map(|p| norm_prefix(&p.prefix)).collect();

    for q in queries {
        // A prefix only narrows the search when it is a real camera prefix;
        // "jpg101" or "foto101" just mean photo 101.
        let want = q.prefix.as_ref().filter(|p| known.contains(*p));
        let fits = |p: &Photo| want.is_none_or(|w| norm_prefix(&p.prefix).as_ref() == Some(w));
        let hits: Vec<u32> = photos.iter().filter(|p| p.number == Some(q.number) && fits(p)).map(|p| p.id).collect();
        match hits.len() {
            0 => {
                let target = format!("{:04}", q.number);
                let mut near: Vec<&Photo> = photos
                    .iter()
                    .filter(|p| fits(p) && p.number.is_some_and(|n| edit_distance_1(&format!("{n:04}"), &target)))
                    .collect();
                near.sort_by_key(|p| p.number.unwrap().abs_diff(q.number));
                out.not_found
                    .push(NotFound { query: q.label, suggestions: near.iter().take(3).map(|p| p.id).collect() });
            }
            1 => {
                if taken.insert(hits[0]) {
                    out.found.push(Found { query: q.label, photo_id: hits[0] });
                }
            }
            _ => out.ambiguous.push(Ambiguous { query: q.label, candidates: hits }),
        }
    }
    out
}

/// True when `a` becomes `b` by one substitution, insertion, deletion, or
/// swap of neighbours — the usual slips when typing a number.
fn edit_distance_1(a: &str, b: &str) -> bool {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if a == b {
        return false;
    }
    if a.len() == b.len() {
        let diff: Vec<usize> = (0..a.len()).filter(|&i| a[i] != b[i]).collect();
        return diff.len() == 1
            || (diff.len() == 2 && diff[1] == diff[0] + 1 && a[diff[0]] == b[diff[1]] && a[diff[1]] == b[diff[0]]);
    }
    let (long, short) = if a.len() > b.len() { (&a, &b) } else { (&b, &a) };
    if long.len() - short.len() != 1 {
        return false;
    }
    (0..long.len()).any(|skip| long.iter().enumerate().filter(|&(i, _)| i != skip).map(|(_, c)| c).eq(short.iter()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn photo(id: u32, stem: &str) -> Photo {
        let (prefix, number) = crate::scan::split_frame_number(stem);
        Photo {
            id,
            stem: stem.into(),
            prefix,
            number,
            folder: String::new(),
            raw: Some(PathBuf::from(format!("{stem}.CR3"))),
            jpeg: None,
        }
    }

    fn numbers(text: &str) -> Vec<u32> {
        parse(text).0.into_iter().map(|q| q.number).collect()
    }

    #[test]
    fn reads_whatsapp_style_messages() {
        assert_eq!(numbers("kak aku pilih ini ya 🙏\nIMG_0101, 102, 103"), vec![101, 102, 103]);
        assert_eq!(numbers("0110-0113"), vec![110, 111, 112, 113]);
        assert_eq!(numbers("110 sampai 112, 120 s/d 121"), vec![110, 111, 112, 120, 121]);
        assert_eq!(numbers("jpg 120 sama jpg121 dan foto122"), vec![120, 121, 122]);
        assert_eq!(numbers("125-28"), vec![125, 126, 127, 128]);
        assert_eq!(numbers("0101 dan 101 lagi"), vec![101]);
        assert_eq!(numbers("IMG_0101.CR3, 0102.jpg"), vec![101, 102]);
    }

    #[test]
    fn skips_huge_ranges() {
        let (q, _, warnings) = parse("1-1500");
        assert!(q.is_empty());
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn resolves_found_ambiguous_and_missing() {
        let photos = vec![photo(0, "IMG_0101"), photo(1, "IMG_0120"), photo(2, "DSC_0120"), photo(3, "DSC_0456")];
        let r = resolve("IMG_0101, 120, DSC_0465, DSC_0120", &photos);
        assert_eq!(
            r.found,
            vec![Found { query: "IMG_0101".into(), photo_id: 0 }, Found { query: "DSC_0120".into(), photo_id: 2 }]
        );
        assert_eq!(r.ambiguous, vec![Ambiguous { query: "120".into(), candidates: vec![1, 2] }]);
        assert_eq!(r.not_found, vec![NotFound { query: "DSC_0465".into(), suggestions: vec![3] }]);
    }

    #[test]
    fn typo_distance() {
        assert!(edit_distance_1("0465", "0456"));
        assert!(edit_distance_1("0465", "0466"));
        assert!(!edit_distance_1("0465", "0100"));
    }

    #[test]
    fn matches_whole_and_partial_file_names() {
        let photos = vec![
            photo(0, "Gemini_Generated_Image_25vqbx25vqbx25vq"),
            photo(1, "Gemini_Generated_Image_8k2mq18k2mq18k2m"),
            photo(2, "Gemini_Generated_Image_zz91kdzz91kdzz91"),
            photo(3, "IMG_0101"),
        ];
        let r = resolve(
            "kak mau ini ya:\nGemini_Generated_Image_25vqbx25vqbx25vq.jpg\n8k2mq18k2m, IMG_0101\nGemini_Generated_Image_tidakada99",
            &photos,
        );
        let ids: Vec<u32> = r.found.iter().map(|f| f.photo_id).collect();
        assert_eq!(ids, vec![0, 1, 3]);
        assert_eq!(
            r.not_found,
            vec![NotFound { query: "Gemini_Generated_Image_tidakada99".into(), suggestions: vec![] }]
        );
        // Too vague to be a pick: matches every Gemini file.
        let vague = resolve("Gemini", &photos);
        assert!(vague.found.is_empty() && vague.ambiguous.len() == 1);
    }
}
