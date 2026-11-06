//! Turns a .docx into a PDF using whatever the computer already has:
//! LibreOffice (silent), then Microsoft Word. If neither is installed the
//! user can still open the .docx and save it as PDF themselves.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn run(mut cmd: Command, timeout: Duration) -> bool {
    let Ok(mut child) = cmd.stdout(Stdio::null()).stderr(Stdio::null()).spawn() else { return false };
    let end = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if Instant::now() < end => std::thread::sleep(Duration::from_millis(200)),
            _ => {
                let _ = child.kill();
                return false;
            }
        }
    }
}

fn soffice() -> Option<PathBuf> {
    let candidates = [
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/usr/bin/soffice",
    ];
    candidates.iter().map(PathBuf::from).find(|p| p.exists())
}

/// Writes `dst` (a .pdf) from `src` (a .docx).
pub fn docx_to_pdf(src: &Path, dst: &Path) -> Result<(), String> {
    let _ = std::fs::remove_file(dst);
    let out_dir = dst.parent().ok_or("bad path")?;

    if let Some(bin) = soffice() {
        let mut c = Command::new(bin);
        c.args(["--headless", "--convert-to", "pdf", "--outdir"]).arg(out_dir).arg(src);
        if run(c, Duration::from_secs(90)) {
            let made = out_dir.join(src.with_extension("pdf").file_name().unwrap());
            if made.exists() {
                if made != dst {
                    std::fs::rename(&made, dst).map_err(|e| e.to_string())?;
                }
                return Ok(());
            }
        }
    }

    #[cfg(target_os = "macos")]
    if Path::new("/Applications/Microsoft Word.app").exists() {
        let script = format!(
            r#"tell application "Microsoft Word"
  set d to open file name (POSIX file "{src}" as string)
  save as d file name (POSIX file "{dst}" as string) file format format PDF
  close d saving no
end tell"#,
            src = src.display(),
            dst = dst.display()
        );
        let mut c = Command::new("osascript");
        c.args(["-e", &script]);
        if run(c, Duration::from_secs(120)) && dst.exists() {
            return Ok(());
        }
    }

    #[cfg(target_os = "windows")]
    {
        let ps = format!(
            "$w = New-Object -ComObject Word.Application; $w.Visible = $false; \
             $d = $w.Documents.Open('{}'); $d.SaveAs([ref]'{}', [ref]17); $d.Close(); $w.Quit()",
            src.display(),
            dst.display()
        );
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-Command", &ps]);
        if run(c, Duration::from_secs(120)) && dst.exists() {
            return Ok(());
        }
    }

    Err("Couldn't make a PDF automatically. Open the .docx and use File → Save As → PDF.".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn converts_with_libreoffice_if_present() {
        if super::soffice().is_none() {
            return;
        }
        let dir = std::env::temp_dir().join("lymbo-convert-test");
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("r.docx");
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/resume.docx"), &src).unwrap();
        let dst = dir.join("version-1.pdf");
        super::docx_to_pdf(&src, &dst).unwrap();
        assert!(std::fs::read(&dst).unwrap().starts_with(b"%PDF"));
    }
}
