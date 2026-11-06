//! Reads and edits .docx resumes while keeping their formatting.
//!
//! A .docx is a zip with the text in `word/document.xml`. Each paragraph
//! (`<w:p>`) is one line or bullet. SONNY's edits target paragraphs by number:
//! - replace: new text goes into the paragraph's first text run, so the
//!   paragraph style, bullet, font and size stay the same
//! - insert_after: copies the paragraph (same bullet/style) with new text
//! - delete: removes the paragraph
//! - move_after: moves the paragraph (with any new text) to right after another one,
//!   e.g. to put the most relevant bullet first
//! Lines with tabs, links or fields (like "Company<tab>2024–2025") are marked
//! locked, because rewriting them would scramble their layout.
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read, Write};

#[derive(Debug, Clone)]
pub struct Para {
    pub start: usize,
    pub end: usize,
    pub text: String,
    pub locked: bool,
    pub in_table: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Edit {
    /// Paragraph number from `paragraphs()`.
    pub p: usize,
    /// "replace" | "insert_after" | "delete" | "move_after"
    pub op: String,
    #[serde(default)]
    pub text: Option<String>,
    /// For "move_after": the paragraph this one should come right after.
    #[serde(default)]
    pub after: Option<usize>,
    /// SONNY's reason, shown to the user when reviewing.
    #[serde(default)]
    pub why: Option<String>,
}

pub fn document_xml(bytes: &[u8]) -> Result<String, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "That file isn't a valid .docx.".to_string())?;
    let mut f = zip
        .by_name("word/document.xml")
        .map_err(|_| "That .docx has no document text.".to_string())?;
    let mut s = String::new();
    f.read_to_string(&mut s).map_err(|_| "Couldn't read the .docx.".to_string())?;
    Ok(s)
}

fn is_p_open(xml: &str, i: usize) -> bool {
    xml[i..].starts_with("<w:p") && matches!(xml.as_bytes().get(i + 4), Some(b'>') | Some(b' ') | Some(b'/'))
}

/// Innermost paragraphs in document order (a paragraph holding a text box
/// isn't itself editable; the paragraphs inside the box are).
pub fn paragraphs(xml: &str) -> Vec<Para> {
    let mut out = Vec::new();
    // stack of (start, has_child)
    let mut stack: Vec<(usize, bool)> = Vec::new();
    let mut i = 0;
    while let Some(off) = xml[i..].find('<') {
        let at = i + off;
        if is_p_open(xml, at) {
            let close = xml[at..].find('>').map(|o| at + o).unwrap_or(xml.len() - 1);
            if xml.as_bytes()[close - 1] == b'/' {
                // <w:p/>: empty paragraph
                if let Some(top) = stack.last_mut() {
                    top.1 = true;
                }
                out.push(make_para(xml, at, close + 1));
            } else {
                if let Some(top) = stack.last_mut() {
                    top.1 = true;
                }
                stack.push((at, false));
            }
            i = close + 1;
        } else if xml[at..].starts_with("</w:p>") {
            let end = at + "</w:p>".len();
            if let Some((start, has_child)) = stack.pop() {
                if !has_child {
                    out.push(make_para(xml, start, end));
                }
            }
            i = end;
        } else {
            i = at + 1;
        }
    }
    out.sort_by_key(|p| p.start);
    out
}

fn make_para(xml: &str, start: usize, end: usize) -> Para {
    let body = &xml[start..end];
    let locked = body.contains("<w:tab/>")
        || body.contains("<w:tab ")
        || body.contains("<w:hyperlink")
        || body.contains("<w:fldChar")
        || body.contains("<w:fldSimple");
    // inside a table cell if there are more <w:tc> opens than closes before it
    let before = &xml[..start];
    let opens = before.matches("<w:tc>").count() + before.matches("<w:tc ").count();
    let closes = before.matches("</w:tc>").count();
    Para { start, end, text: para_text(body), locked, in_table: opens > closes }
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Text runs (`<w:t>`) of a paragraph: (open-tag start, content start, content end, close end).
fn text_runs(body: &str) -> Vec<(usize, usize, usize, usize)> {
    let mut v = Vec::new();
    let mut i = 0;
    while let Some(off) = body[i..].find("<w:t") {
        let at = i + off;
        let next = body.as_bytes().get(at + 4).copied();
        if !matches!(next, Some(b'>') | Some(b' ')) {
            i = at + 4;
            continue;
        }
        let Some(gt) = body[at..].find('>').map(|o| at + o) else { break };
        if body.as_bytes()[gt - 1] == b'/' {
            i = gt + 1; // <w:t/>
            continue;
        }
        let Some(close) = body[gt..].find("</w:t>").map(|o| gt + o) else { break };
        v.push((at, gt + 1, close, close + "</w:t>".len()));
        i = close + "</w:t>".len();
    }
    v
}

fn para_text(body: &str) -> String {
    let mut s = String::new();
    let mut i = 0;
    let runs = text_runs(body);
    let mut r = 0;
    while i < body.len() {
        if r < runs.len() && runs[r].0 == i {
            s.push_str(&unescape(&body[runs[r].1..runs[r].2]));
            i = runs[r].3;
            r += 1;
            continue;
        }
        if body[i..].starts_with("<w:tab/>") || body[i..].starts_with("<w:tab ") {
            s.push('\t');
        } else if body[i..].starts_with("<w:br/>") || body[i..].starts_with("<w:br ") {
            s.push('\n');
        }
        // advance to next tag
        i = match body[i + 1..].find('<') {
            Some(o) => i + 1 + o,
            None => body.len(),
        };
    }
    s
}

/// Puts `text` in the first run and empties the rest, keeping all formatting tags.
fn set_text(body: &str, text: &str) -> String {
    let runs = text_runs(body);
    if runs.is_empty() {
        // paragraph with no text yet: add a plain run before </w:p>
        let insert = format!("<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r>", escape(text));
        return match body.rfind("</w:p>") {
            Some(pos) => format!("{}{}{}", &body[..pos], insert, &body[pos..]),
            None => body.to_string(),
        };
    }
    let mut out = String::with_capacity(body.len() + text.len());
    let mut last = 0;
    for (k, (open, cstart, cend, _cl)) in runs.iter().enumerate() {
        out.push_str(&body[last..*open]);
        if k == 0 {
            out.push_str("<w:t xml:space=\"preserve\">");
            out.push_str(&escape(text));
        } else {
            out.push_str(&body[*open..*cstart]);
        }
        last = *cend;
    }
    out.push_str(&body[last..]);
    out
}

/// A copy of a paragraph for inserting: same style, but without ids that must stay unique.
fn clone_para(body: &str) -> String {
    let mut s = body.to_string();
    for attr in ["w14:paraId=\"", "w14:textId=\"", "w:rsidR=\"", "w:rsidRDefault=\"", "w:rsidP=\""] {
        while let Some(pos) = s.find(attr) {
            let end = s[pos + attr.len()..].find('"').map(|o| pos + attr.len() + o + 1).unwrap_or(s.len());
            s.replace_range(pos..end, "");
        }
    }
    for tag in ["<w:bookmarkStart", "<w:bookmarkEnd", "<w:commentRangeStart", "<w:commentRangeEnd"] {
        while let Some(pos) = s.find(tag) {
            let end = s[pos..].find("/>").map(|o| pos + o + 2).unwrap_or(s.len());
            s.replace_range(pos..end, "");
        }
    }
    s
}

/// Plain text of the whole resume, one paragraph per line (what the agents read).
pub fn text_of(bytes: &[u8]) -> Result<String, String> {
    let xml = document_xml(bytes)?;
    Ok(paragraphs(&xml)
        .iter()
        .map(|p| p.text.trim_end().to_string())
        .filter(|t| !t.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n"))
}

/// Applies edits and returns the new .docx bytes. Everything else in the file
/// (styles, fonts, headers, images) is copied over untouched.
pub fn apply(bytes: &[u8], edits: &[Edit]) -> Result<Vec<u8>, String> {
    let xml = document_xml(bytes)?;
    let paras = paragraphs(&xml);
    // Which paragraphs move, and where. Locked lines and table cells never move, and a
    // move whose chain of targets loops back on itself is ignored (so no text is lost).
    let mut moves: std::collections::HashMap<usize, usize> = edits
        .iter()
        .filter(|e| e.op == "move_after")
        .filter_map(|e| e.after.map(|a| (e.p, a)))
        .filter(|(p, a)| p != a && *p < paras.len() && *a < paras.len())
        .filter(|(p, a)| !paras[*p].locked && !paras[*p].in_table && !paras[*a].in_table)
        .collect();
    let looping: Vec<usize> = moves
        .keys()
        .copied()
        .filter(|&start| {
            let mut cur = start;
            for _ in 0..=moves.len() {
                match moves.get(&cur) {
                    Some(&next) if next == start => return true,
                    Some(&next) => cur = next,
                    None => return false,
                }
            }
            true
        })
        .collect();
    for p in looping {
        moves.remove(&p);
    }

    // One paragraph's output: its (possibly edited) text, inserted lines, then anything moved after it.
    fn render(idx: usize, xml: &str, paras: &[Para], edits: &[Edit], moves: &std::collections::HashMap<usize, usize>, out: &mut String) {
        let p = &paras[idx];
        let body = &xml[p.start..p.end];
        let mine: Vec<&Edit> = edits.iter().filter(|e| e.p == idx).collect();
        let replace = mine.iter().find(|e| e.op == "replace").and_then(|e| e.text.as_deref());
        let delete = mine.iter().any(|e| e.op == "delete");
        if p.locked && (replace.is_some() || delete) {
            out.push_str(body); // never touch locked lines
        } else if delete {
            if p.in_table {
                out.push_str(&set_text(body, "")); // a table cell must keep one paragraph
            }
        } else if let Some(t) = replace {
            out.push_str(&set_text(body, t));
        } else {
            out.push_str(body);
        }
        for e in mine.iter().filter(|e| e.op == "insert_after") {
            if let Some(t) = e.text.as_deref() {
                out.push_str(&set_text(&clone_para(body), t));
            }
        }
        let mut followers: Vec<usize> = moves.iter().filter(|(_, &a)| a == idx).map(|(&m, _)| m).collect();
        followers.sort();
        for m in followers {
            render(m, xml, paras, edits, moves, out);
        }
    }

    let mut out = String::with_capacity(xml.len() + 4096);
    let mut pos = 0;
    for (idx, p) in paras.iter().enumerate() {
        out.push_str(&xml[pos..p.start]);
        if !moves.contains_key(&idx) {
            render(idx, &xml, &paras, edits, &moves, &mut out);
        }
        pos = p.end;
    }
    out.push_str(&xml[pos..]);

    // Rebuild the zip with the new document.xml.
    let mut src = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let mut buf = Cursor::new(Vec::new());
    {
        let mut w = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for i in 0..src.len() {
            let mut f = src.by_index(i).map_err(|e| e.to_string())?;
            let name = f.name().map_err(|e| e.to_string())?.to_string();
            if f.is_dir() {
                continue;
            }
            let mut data = Vec::new();
            f.read_to_end(&mut data).map_err(|e| e.to_string())?;
            w.start_file(name.as_str(), opts).map_err(|e| e.to_string())?;
            if name == "word/document.xml" {
                w.write_all(out.as_bytes()).map_err(|e| e.to_string())?;
            } else {
                w.write_all(&data).map_err(|e| e.to_string())?;
            }
        }
        w.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/resume.docx")).unwrap()
    }

    #[test]
    fn reads_paragraphs() {
        let xml = document_xml(&fixture()).unwrap();
        let ps = paragraphs(&xml);
        let texts: Vec<_> = ps.iter().map(|p| p.text.as_str()).collect();
        assert!(texts.contains(&"Arthur Sipor"), "{texts:?}");
        let dated = ps.iter().find(|p| p.text.contains("2025")).unwrap();
        assert!(dated.locked, "lines with tabs are locked");
        assert!(ps.iter().any(|p| p.text.contains("Tableau dashboards")));
    }

    #[test]
    fn edits_keep_formatting() {
        let bytes = fixture();
        let xml = document_xml(&bytes).unwrap();
        let ps = paragraphs(&xml);
        let bullet = ps.iter().position(|p| p.text.contains("Tableau dashboards")).unwrap();
        let dated = ps.iter().position(|p| p.locked).unwrap();
        let edits = vec![
            Edit { p: bullet, op: "replace".into(), text: Some("Built 6 Tableau & SQL dashboards <used weekly>".into()), why: None, after: None },
            Edit { p: bullet, op: "insert_after".into(), text: Some("Ran A/B tests on signup flow".into()), why: None, after: None },
            Edit { p: dated, op: "replace".into(), text: Some("SHOULD NOT APPEAR".into()), why: None, after: None },
        ];
        let out = apply(&bytes, &edits).unwrap();
        let new_xml = document_xml(&out).unwrap();
        let nps = paragraphs(&new_xml);
        let i = nps.iter().position(|p| p.text == "Built 6 Tableau & SQL dashboards <used weekly>").unwrap();
        assert_eq!(nps[i + 1].text, "Ran A/B tests on signup flow");
        // inserted bullet keeps the original paragraph's properties (bullet style)
        let ppr = |body: &str| body.split("<w:r").next().unwrap().to_string();
        let orig = &new_xml[nps[i].start..nps[i].end];
        let ins = &new_xml[nps[i + 1].start..nps[i + 1].end];
        assert_eq!(ppr(orig).replace(char::is_whitespace, "").len() > 0, true);
        assert!(ppr(ins).contains("<w:pPr>") == ppr(orig).contains("<w:pPr>"));
        assert!(!new_xml.contains("SHOULD NOT APPEAR"));
        assert!(text_of(&out).unwrap().contains("Ran A/B tests"));
    }
}

#[cfg(test)]
mod output_check {
    /// Writes an edited copy so it can be opened/converted outside the test.
    #[test]
    fn write_edited_copy() {
        let Ok(dir) = std::env::var("LYMBO_TEST_OUT") else { return };
        let bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/resume.docx")).unwrap();
        let xml = super::document_xml(&bytes).unwrap();
        let ps = super::paragraphs(&xml);
        let b = ps.iter().position(|p| p.text.contains("Tableau dashboards")).unwrap();
        let edits = vec![
            super::Edit { p: b, op: "replace".into(), text: Some("Built 6 Tableau and SQL dashboards used weekly by coaches".into()), why: None, after: None },
            super::Edit { p: b, op: "insert_after".into(), text: Some("Ran A/B tests comparing two training plans".into()), why: None, after: None },
        ];
        std::fs::write(format!("{dir}/edited.docx"), super::apply(&bytes, &edits).unwrap()).unwrap();
    }
}

#[cfg(test)]
mod move_tests {
    use super::*;

    #[test]
    fn moves_a_bullet_up() {
        let bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/resume.docx")).unwrap();
        let xml = document_xml(&bytes).unwrap();
        let ps = paragraphs(&xml);
        let header = ps.iter().position(|p| p.locked).unwrap();
        let second = ps.iter().position(|p| p.text.contains("motion-capture")).unwrap();
        let edits = vec![
            Edit { p: second, op: "move_after".into(), text: None, why: None, after: Some(header) },
            Edit { p: second, op: "replace".into(), text: Some("Processed motion-capture signals in Python".into()), why: None, after: None },
            // a loop is ignored rather than losing text
            Edit { p: 0, op: "move_after".into(), text: None, why: None, after: Some(1) },
            Edit { p: 1, op: "move_after".into(), text: None, why: None, after: Some(0) },
        ];
        let out = apply(&bytes, &edits).unwrap();
        let texts: Vec<String> = paragraphs(&document_xml(&out).unwrap()).into_iter().map(|p| p.text).collect();
        let h = texts.iter().position(|t| t.contains("2025")).unwrap();
        assert_eq!(texts[h + 1], "Processed motion-capture signals in Python");
        assert!(texts[h + 2].contains("Tableau dashboards"));
        assert_eq!(texts.len(), ps.len(), "no paragraph lost or duplicated");
        assert!(texts.contains(&"Arthur Sipor".to_string()));
    }
}
