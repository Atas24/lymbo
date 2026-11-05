//! KASPR's Handshake connection. Drives a visible Chrome window the user can
//! watch and take over at any time.
//!
//! Rules this module follows (from the Lymbo spec):
//! - human speed: randomized pauses before every page load
//! - only reads pages a logged-in student could see; only navigates on joinhandshake.com
//! - the login is only typed into Handshake, or a school login page the user approved
//! - never clicks Apply / Submit; the user does that
//! - when something unexpected happens it stops and hands control back
use headless_chrome::{Browser, LaunchOptions, Tab};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::keys::HandshakeLogin;

pub const BASE: &str = "https://app.joinhandshake.com";

/// Where KASPR tries to search. Handshake changes its URLs now and then; if none
/// of these show job links, KASPR asks the user to search by hand instead.
const SEARCH_URLS: &[&str] = &["/job-search?query=", "/stu/postings?query="];

#[derive(Default)]
pub struct Handshake {
    browser: Option<Browser>,
    tab: Option<Arc<Tab>>,
}

#[derive(Serialize)]
pub struct LoginOutcome {
    /// "logged_in" | "needs_user" | "needs_approval"
    pub status: String,
    pub message: String,
    /// For "needs_approval": the login page host KASPR wants to type into.
    pub host: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct JobLink {
    pub id: String,
    pub url: String,
    pub text: String,
}

#[derive(Serialize)]
pub struct JobPage {
    pub url: String,
    pub text: String,
}

fn outcome(status: &str, message: &str, host: Option<String>) -> LoginOutcome {
    LoginOutcome { status: status.into(), message: message.into(), host }
}

pub fn host_of(url: &str) -> String {
    url.split("://")
        .nth(1)
        .unwrap_or("")
        .split(['/', '?', '#', ':'])
        .next()
        .unwrap_or("")
        .to_lowercase()
}

pub fn is_handshake(url: &str) -> bool {
    let h = host_of(url);
    url.starts_with("https://") && (h == "joinhandshake.com" || h.ends_with(".joinhandshake.com"))
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            b' ' => "+".into(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Sleeps a random amount in [min, max] ms, checking the kill switch as it goes.
fn pause(cancel: &AtomicBool, min_ms: u64, max_ms: u64) -> Result<(), String> {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0) as u64;
    let total = min_ms + nanos % (max_ms - min_ms + 1);
    let end = Instant::now() + Duration::from_millis(total);
    while Instant::now() < end {
        check(cancel)?;
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(())
}

fn check(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        Err("Session ended, so KASPR stopped.".into())
    } else {
        Ok(())
    }
}

fn eval_string(tab: &Tab, js: &str) -> Result<String, String> {
    let v = tab.evaluate(js, false).map_err(|e| format!("Page script failed: {e}"))?;
    Ok(v.value.and_then(|v| v.as_str().map(String::from)).unwrap_or_default())
}

// Marks the visible login fields on the page with data-lymbo="user" / "pw".
const FIND_FIELDS_JS: &str = r#"(() => {
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  document.querySelectorAll('[data-lymbo]').forEach(e => e.removeAttribute('data-lymbo'));
  const inputs = [...document.querySelectorAll('input')].filter(vis);
  const pw = inputs.find(i => i.type === 'password');
  const user = inputs.find(i => i.type === 'email' ||
    (['text', ''].includes(i.type) && /user|email|login|netid|account|identifier/i.test(
      [i.name, i.id, i.autocomplete, i.placeholder, i.getAttribute('aria-label')].join(' '))));
  if (pw) pw.setAttribute('data-lymbo', 'pw');
  if (user) user.setAttribute('data-lymbo', 'user');
  return JSON.stringify({ pw: !!pw, user: !!user, userFilled: !!(user && user.value) });
})()"#;

// Marks a visible button/link whose text matches the pattern with data-lymbo="choice".
fn find_choice_js(pattern: &str) -> String {
    format!(
        r#"(() => {{
  const re = new RegExp({pattern:?}, 'i');
  const vis = e => {{ const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }};
  const el = [...document.querySelectorAll('a, button, [role=button]')]
    .filter(vis).find(e => re.test((e.innerText || e.getAttribute('aria-label') || '').trim()));
  if (el) el.setAttribute('data-lymbo', 'choice');
  return el ? 'yes' : '';
}})()"#
    )
}

const COLLECT_LINKS_JS: &str = r#"(() => {
  const seen = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    const m = a.href.match(/\/(?:stu\/)?(?:jobs|job-search|postings)\/(\d+)/);
    if (!m) continue;
    const text = (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!seen.has(m[1]) || text.length > seen.get(m[1]).length) seen.set(m[1], text);
  }
  return JSON.stringify([...seen].map(([id, text]) => ({ id, text })));
})()"#;

// The job's own text only: drops nav/header/footer/scripts, collapses whitespace,
// skips repeated lines, and caps the length. Less text = cheaper AI calls.
const PAGE_TEXT_JS: &str = r#"(() => {
  const root = (document.querySelector('main') || document.body).cloneNode(true);
  root.querySelectorAll('nav, footer, script, style, svg, [role=navigation]').forEach(e => e.remove());
  const seen = new Set();
  const lines = (root.innerText || root.textContent || '').split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 1 && !seen.has(l) && seen.add(l));
  return lines.join('\n').slice(0, 7000);
})()"#;

#[derive(serde::Deserialize)]
struct Fields {
    pw: bool,
    user: bool,
    #[serde(rename = "userFilled")]
    user_filled: bool,
}

impl Handshake {
    fn tab(&self) -> Result<Arc<Tab>, String> {
        self.tab.clone().ok_or_else(|| "Handshake isn't connected. Click Connect first.".into())
    }

    pub fn is_open(&self) -> bool {
        self.tab.as_ref().map(|t| t.get_target_info().is_ok()).unwrap_or(false)
    }

    /// Opens a fresh Chrome window. The profile is wiped every launch, so the
    /// user (via KASPR) logs in again each time the app opens.
    fn launch(&mut self, profile: &Path) -> Result<Arc<Tab>, String> {
        if self.is_open() {
            return self.tab();
        }
        self.close();
        let _ = std::fs::remove_dir_all(profile);
        std::fs::create_dir_all(profile).map_err(|e| e.to_string())?;
        let opts = LaunchOptions::default_builder()
            .headless(false)
            .window_size(Some((1200, 900)))
            .user_data_dir(Some(profile.to_path_buf()))
            .idle_browser_timeout(Duration::from_secs(12 * 60 * 60))
            .build()
            .map_err(|e| format!("Couldn't set up Chrome: {e}"))?;
        let browser = Browser::new(opts)
            .map_err(|_| "Couldn't open Chrome. KASPR needs Google Chrome installed.".to_string())?;
        let tab = browser.new_tab().map_err(|e| format!("Couldn't open a Chrome tab: {e}"))?;
        tab.set_default_timeout(Duration::from_secs(30));
        self.browser = Some(browser);
        self.tab = Some(tab.clone());
        Ok(tab)
    }

    pub fn close(&mut self) {
        if let Some(t) = self.tab.take() {
            let _ = t.close(false);
        }
        self.browser = None; // dropping the Browser shuts Chrome down
    }

    fn goto(&self, tab: &Tab, url: &str, cancel: &AtomicBool) -> Result<(), String> {
        if !is_handshake(url) {
            return Err("KASPR only browses Handshake.".into());
        }
        pause(cancel, 2500, 6000)?; // human speed between page loads
        tab.navigate_to(url)
            .and_then(|t| t.wait_until_navigated())
            .map_err(|_| "Handshake took too long to load. Check the Chrome window.".to_string())?;
        Ok(())
    }

    fn type_into(&self, tab: &Tab, selector: &str, text: &str, cancel: &AtomicBool) -> Result<(), String> {
        let el = tab.find_element(selector).map_err(|_| "Couldn't find the login box.".to_string())?;
        el.click().map_err(|_| "Couldn't click the login box.".to_string())?;
        let _ = tab.evaluate(&format!("document.querySelector('{selector}').value = ''"), false);
        pause(cancel, 300, 800)?;
        tab.type_str(text).map_err(|_| "Couldn't type into the login box.".to_string())?;
        Ok(())
    }

    fn logged_in(tab: &Tab) -> bool {
        let url = tab.get_url();
        if !is_handshake(&url) {
            return false;
        }
        let path = url.splitn(4, '/').nth(3).unwrap_or("").to_lowercase();
        let on_auth_page = path.is_empty()
            || ["login", "sso", "auth", "saml", "users/sign_in"].iter().any(|p| path.starts_with(p));
        let has_pw = eval_string(tab, "document.querySelector('input[type=password]') ? 'y' : ''")
            .map(|s| !s.is_empty())
            .unwrap_or(true);
        !on_auth_page && !has_pw
    }

    /// Signs in with the saved login. Stops and hands control back for 2-factor,
    /// unknown login pages, or anything it doesn't recognize.
    pub fn connect(
        &mut self,
        profile: &Path,
        login: &HandshakeLogin,
        approved_hosts: &[String],
        cancel: &AtomicBool,
    ) -> Result<LoginOutcome, String> {
        let tab = self.launch(profile)?;
        if !is_handshake(&tab.get_url()) {
            self.goto(&tab, &format!("{BASE}/login"), cancel)?;
        }
        let mut submitted_pw_on: Option<String> = None;
        let mut clicked_choice = false;

        for _ in 0..10 {
            check(cancel)?;
            pause(cancel, 1500, 3000)?; // let the page settle
            if Self::logged_in(&tab) {
                return Ok(outcome("logged_in", "Signed in to Handshake.", None));
            }
            let url = tab.get_url();
            let host = host_of(&url);
            if !url.starts_with("https://") {
                return Ok(outcome("needs_user", "This login page isn't secure, so KASPR won't type your password. Sign in yourself in the Chrome window.", None));
            }
            if !is_handshake(&url) && !approved_hosts.iter().any(|h| h == &host) {
                return Ok(outcome(
                    "needs_approval",
                    &format!("Handshake sent KASPR to {host} to sign in. Should KASPR type your login there?"),
                    Some(host),
                ));
            }

            let fields: Fields = serde_json::from_str(&eval_string(&tab, FIND_FIELDS_JS)?)
                .map_err(|_| "Couldn't read the login page.".to_string())?;

            if fields.pw {
                if submitted_pw_on.as_deref() == Some(host.as_str()) {
                    return Ok(outcome("needs_user", "The login didn't go through. Check the Chrome window. If your password changed, update it in KASPR.", None));
                }
                if fields.user && !fields.user_filled {
                    self.type_into(&tab, "[data-lymbo=user]", &login.email, cancel)?;
                }
                self.type_into(&tab, "[data-lymbo=pw]", &login.password, cancel)?;
                pause(cancel, 400, 900)?;
                let _ = tab.press_key("Enter");
                submitted_pw_on = Some(host);
                let _ = tab.wait_until_navigated();
                continue;
            }
            if fields.user && !fields.user_filled {
                self.type_into(&tab, "[data-lymbo=user]", &login.email, cancel)?;
                pause(cancel, 400, 900)?;
                let _ = tab.press_key("Enter");
                let _ = tab.wait_until_navigated();
                continue;
            }
            if !clicked_choice && is_handshake(&url) {
                // Handshake asks how you want to sign in.
                let pattern = if login.method == "school" {
                    r"school|institution|single sign|sso|university|college"
                } else {
                    r"handshake (credentials|password)|log ?in with (email|password)|use (a |your )?password|email instead"
                };
                if !eval_string(&tab, &find_choice_js(pattern))?.is_empty() {
                    if let Ok(el) = tab.find_element("[data-lymbo=choice]") {
                        pause(cancel, 500, 1200)?;
                        let _ = el.click();
                        clicked_choice = true;
                        let _ = tab.wait_until_navigated();
                        continue;
                    }
                }
            }
            if submitted_pw_on.is_some() {
                // Password went in but we're not in yet: almost always 2-factor.
                return Ok(outcome("needs_user", "Finish signing in in the Chrome window (for example, approve the Duo push). Then click \"I'm signed in\".", None));
            }
            break;
        }
        if Self::logged_in(&tab) {
            return Ok(outcome("logged_in", "Signed in to Handshake.", None));
        }
        Ok(outcome("needs_user", "KASPR didn't recognize this login page. Sign in yourself in the Chrome window, then click \"I'm signed in\".", None))
    }

    pub fn check_logged_in(&self) -> Result<bool, String> {
        Ok(Self::logged_in(&*self.tab()?))
    }

    fn collect_links(tab: &Tab, cancel: &AtomicBool) -> Result<Vec<JobLink>, String> {
        // Job lists load after the page does, so give them a few seconds.
        for _ in 0..8 {
            check(cancel)?;
            #[derive(serde::Deserialize)]
            struct L {
                id: String,
                text: String,
            }
            let raw: Vec<L> = serde_json::from_str(&eval_string(tab, COLLECT_LINKS_JS)?).unwrap_or_default();
            if !raw.is_empty() {
                return Ok(raw
                    .into_iter()
                    .map(|l| JobLink { url: format!("{BASE}/jobs/{}", l.id), id: l.id, text: l.text })
                    .collect());
            }
            pause(cancel, 1000, 1000)?;
        }
        Ok(vec![])
    }

    pub fn search(&self, query: &str, cancel: &AtomicBool) -> Result<Vec<JobLink>, String> {
        let tab = self.tab()?;
        for path in SEARCH_URLS {
            self.goto(&tab, &format!("{BASE}{path}{}", encode(query)), cancel)?;
            if !Self::logged_in(&tab) {
                return Err("Handshake signed you out. Click Connect again.".into());
            }
            let links = Self::collect_links(&tab, cancel)?;
            if !links.is_empty() {
                return Ok(links);
            }
        }
        Ok(vec![])
    }

    /// Reads job links off whatever Handshake page the user has open.
    pub fn links_on_page(&self, cancel: &AtomicBool) -> Result<Vec<JobLink>, String> {
        let tab = self.tab()?;
        if !is_handshake(&tab.get_url()) {
            return Err("The Chrome window isn't on Handshake.".into());
        }
        Self::collect_links(&tab, cancel)
    }

    pub fn read_job(&self, url: &str, cancel: &AtomicBool) -> Result<JobPage, String> {
        let tab = self.tab()?;
        self.goto(&tab, url, cancel)?;
        if !Self::logged_in(&tab) {
            return Err("Handshake signed you out. Click Connect again.".into());
        }
        let mut text = String::new();
        for _ in 0..8 {
            check(cancel)?;
            text = eval_string(&tab, PAGE_TEXT_JS)?;
            if text.len() > 600 {
                break;
            }
            pause(cancel, 1000, 1000)?;
        }
        if text.trim().is_empty() {
            return Err("KASPR couldn't read this job page. Check the Chrome window.".into());
        }
        Ok(JobPage { url: tab.get_url(), text })
    }

    /// Shows a job in the Chrome window so the user can apply themselves.
    pub fn open(&self, url: &str, cancel: &AtomicBool) -> Result<(), String> {
        let tab = self.tab()?;
        if tab.get_url() != url {
            self.goto(&tab, url, cancel)?;
        }
        let _ = tab.bring_to_front();
        let _ = tab.activate();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    //! Runs KASPR's page scripts against local mock pages in a real Chromium.
    //! Needs LYMBO_TEST_CHROME=/path/to/chrome; skipped otherwise.
    use super::*;

    fn browser() -> Option<(Browser, Arc<Tab>)> {
        let path = std::env::var("LYMBO_TEST_CHROME").ok()?;
        let b = Browser::new(
            LaunchOptions::default_builder()
                .headless(true)
                .sandbox(false)
                .path(Some(path.into()))
                .build()
                .unwrap(),
        )
        .unwrap();
        let t = b.new_tab().unwrap();
        Some((b, t))
    }

    #[test]
    fn helpers() {
        assert_eq!(host_of("https://login.microsoftonline.com/x?y"), "login.microsoftonline.com");
        assert!(is_handshake("https://app.joinhandshake.com/jobs/1"));
        assert!(!is_handshake("https://joinhandshake.com.evil.io/"));
        assert!(!is_handshake("http://app.joinhandshake.com/"));
        assert_eq!(encode("data analyst & ml"), "data+analyst+%26+ml");
    }

    #[test]
    fn login_page_fill() {
        let Some((_b, tab)) = browser() else { return };
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
        tab.navigate_to(&format!("file://{dir}/login.html")).unwrap().wait_until_navigated().unwrap();
        let f: Fields = serde_json::from_str(&eval_string(&tab, FIND_FIELDS_JS).unwrap()).unwrap();
        assert!(f.pw && f.user && !f.user_filled);
        let h = Handshake::default();
        let cancel = AtomicBool::new(false);
        h.type_into(&tab, "[data-lymbo=user]", "arthur@school.edu", &cancel).unwrap();
        h.type_into(&tab, "[data-lymbo=pw]", "s3cret!", &cancel).unwrap();
        tab.press_key("Enter").unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let title = eval_string(&tab, "document.title").unwrap();
        assert_eq!(title, "submitted:arthur@school.edu|s3cret!");
        // school sign-in choice is found
        assert_eq!(eval_string(&tab, &find_choice_js(r"school|sso")).unwrap(), "yes");
        assert!(eval_string(&tab, &find_choice_js(r"handshake credentials")).unwrap().is_empty());
    }

    #[test]
    fn job_links() {
        let Some((_b, tab)) = browser() else { return };
        tab.navigate_to(concat!("file://", env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/jobs.html")).unwrap().wait_until_navigated().unwrap();
        let cancel = AtomicBool::new(false);
        let links = Handshake::collect_links(&tab, &cancel).unwrap();
        let ids: Vec<_> = links.iter().map(|l| l.id.as_str()).collect();
        assert_eq!(ids, vec!["111", "222"]);
        assert_eq!(links[0].url, "https://app.joinhandshake.com/jobs/111");
        assert!(links[0].text.contains("Data Analyst Intern"));
        let text = eval_string(&tab, PAGE_TEXT_JS).unwrap();
        assert!(text.contains("Some job text"));
    }

    #[test]
    fn kill_switch_stops_pause() {
        let cancel = AtomicBool::new(true);
        assert!(pause(&cancel, 5000, 6000).is_err());
    }
}
