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

#[derive(Serialize)]
pub struct JobPage {
    pub url: String,
    pub title: String,
    pub company: String,
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

// The job's own text only: drops nav/header/footer/scripts, collapses whitespace,
// skips repeated lines, and caps the length. Less text = cheaper AI calls.
// Reads one job posting. On Handshake the job page often shows the search results list next to
// the job, so instead of reading the whole page this picks the biggest block that doesn't contain
// links to *other* jobs: that's the job's own detail panel. Returns JSON {title, company, text, marked}.
const PAGE_TEXT_JS: &str = r#"(() => {
  const JOB = /\/(?:jobs|job-search|postings)\/(\d+)/;
  const MARK = /responsibilit|qualification|requirement|about (?:the|this) (?:job|role|position)|job description|what you.ll (?:do|bring)|what we.re looking|duties|preferred skills|minimum|you will/i;
  const here = (location.href.match(JOB) || [])[1] || (new URLSearchParams(location.search).get('jobId') || '');
  const root = document.querySelector('main') || document.body;
  // count links to other jobs inside every element
  const others = new Map();
  root.querySelectorAll('a[href]').forEach(a => {
    const m = (a.getAttribute('href') || '').match(JOB);
    if (!m || m[1] === here) return;
    for (let e = a.parentElement; e; e = e.parentElement) {
      others.set(e, (others.get(e) || 0) + 1);
      if (e === root) break;
    }
  });
  const textOf = e => (e.innerText || '');
  let best = null, bestScore = -1;
  for (const e of [root, ...root.querySelectorAll('div, section, article, aside')]) {
    if ((others.get(e) || 0) > 1) continue;
    const t = textOf(e);
    if (t.length < 200) continue;
    const score = t.length + (MARK.test(t) ? 5000 : 0);
    if (score > bestScore) { best = e; bestScore = score; }
  }
  if (!best) best = root;
  const seen = new Set();
  const lines = textOf(best).split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 1 && !seen.has(l) && seen.add(l));
  const h1 = best.querySelector('h1') || document.querySelector('h1');
  const title = (h1 ? h1.innerText : (document.title || '').split('|')[0]).replace(/\s+/g, ' ').trim();
  const emp = best.querySelector('a[href*="/employers/"], a[href*="/e/"]');
  const company = emp ? emp.innerText.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  const text = lines.join('\n').slice(0, 8000);
  return JSON.stringify({ title: title.slice(0, 140), company, text, marked: MARK.test(text) });
})()"#;

#[derive(serde::Deserialize, Default)]
struct Extract {
    #[serde(default)]
    title: String,
    #[serde(default)]
    company: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    marked: bool,
}

fn extract(tab: &Tab) -> Result<Extract, String> {
    let raw = eval_string(tab, PAGE_TEXT_JS)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

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

    /// The job you're looking at right now: the visible Handshake tab that's on a job.
    /// Nothing happens on Handshake's side; KASPR only reads what's already on your screen.
    /// Returns the job's id, plus the page itself when it isn't one of the `known` jobs KASPR already read.
    pub fn watch(&self, known: &[String], cancel: &AtomicBool) -> Result<Watch, String> {
        let browser = self.browser.as_ref().ok_or("Handshake isn't connected. Click Connect first.")?;
        let tabs = browser.get_tabs().lock().map(|t| t.clone()).unwrap_or_default();
        watch_tabs(&tabs, known, is_handshake, cancel)
    }
}

#[derive(Serialize, Default)]
pub struct Watch {
    /// Id of the job on screen, or None when no job is open.
    pub id: Option<String>,
    /// Only filled for a job KASPR hasn't read yet.
    pub page: Option<JobPage>,
}

/// The job id in a Handshake job URL: /jobs/123, /job-search/123, /postings/123, or ?jobId=123.
pub fn job_id_of(url: &str) -> Option<String> {
    let digits = |rest: &str| -> Option<String> {
        let d: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        (!d.is_empty()).then_some(d)
    };
    for key in ["/jobs/", "/job-search/", "/postings/"] {
        if let Some(i) = url.find(key) {
            if let Some(d) = digits(&url[i + key.len()..]) {
                return Some(d);
            }
        }
    }
    url.find("jobId=").and_then(|i| digits(&url[i + 6..]))
}

const VIEW_JS: &str = r#"JSON.stringify({ href: location.href, visible: document.visibilityState === 'visible', focus: document.hasFocus() })"#;

#[derive(serde::Deserialize)]
struct View {
    href: String,
    visible: bool,
    focus: bool,
}

fn watch_tabs(tabs: &[Arc<Tab>], known: &[String], allowed: fn(&str) -> bool, cancel: &AtomicBool) -> Result<Watch, String> {
    check(cancel)?;
    // Visible tabs on a job; the focused one wins if Chrome has several windows.
    let mut best: Option<(Arc<Tab>, String, bool)> = None;
    let mut answered = false;
    for t in tabs {
        let Ok(raw) = eval_string(t, VIEW_JS) else { continue };
        answered = true;
        let Ok(v) = serde_json::from_str::<View>(&raw) else { continue };
        if !v.visible || !allowed(&v.href) {
            continue;
        }
        let Some(id) = job_id_of(&v.href) else { continue };
        if best.as_ref().map(|b| !b.2 && v.focus).unwrap_or(true) {
            best = Some((t.clone(), id, v.focus));
        }
    }
    if !answered {
        return Err("Handshake isn't connected: the Chrome window was closed.".into());
    }
    let Some((tab, id, _)) = best else { return Ok(Watch::default()) };
    if known.contains(&id) {
        return Ok(Watch { id: Some(id), page: None });
    }
    // A new job: wait for its description to load (the usual sections, or ~8s), and stop
    // if you click to a different job in the meantime.
    let mut page = Extract::default();
    for i in 0..8 {
        check(cancel)?;
        page = extract(&tab)?;
        if page.marked || (i >= 4 && page.text.len() > 600) {
            break;
        }
        pause(cancel, 1000, 1000)?;
        let now = eval_string(&tab, "location.href").unwrap_or_default();
        if job_id_of(&now).as_deref() != Some(id.as_str()) {
            return Ok(Watch::default()); // moved on; the next check picks up the new one
        }
    }
    if page.text.trim().is_empty() {
        return Ok(Watch { id: Some(id), page: None });
    }
    let url = eval_string(&tab, "location.href").unwrap_or_default();
    Ok(Watch { id: Some(id), page: Some(JobPage { url, title: page.title, company: page.company, text: page.text }) })
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
        assert_eq!(job_id_of("https://app.joinhandshake.com/jobs/123?searchId=9").as_deref(), Some("123"));
        assert_eq!(job_id_of("https://app.joinhandshake.com/job-search/456?page=1").as_deref(), Some("456"));
        assert_eq!(job_id_of("https://app.joinhandshake.com/stu/postings/78").as_deref(), Some("78"));
        assert_eq!(job_id_of("https://app.joinhandshake.com/job-search?query=x&jobId=99").as_deref(), Some("99"));
        assert_eq!(job_id_of("https://app.joinhandshake.com/job-search?query=analyst"), None);
        assert_eq!(job_id_of("https://app.joinhandshake.com/employers/5"), None);
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
    fn watches_the_open_job() {
        let Some((_b, tab)) = browser() else { return };
        let dir = concat!("file://", env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
        let cancel = AtomicBool::new(false);
        let any: fn(&str) -> bool = |_| true;
        tab.navigate_to(&format!("{dir}/split.html?jobId=222")).unwrap().wait_until_navigated().unwrap();
        let w = watch_tabs(&[tab.clone()], &[], any, &cancel).unwrap();
        assert_eq!(w.id.as_deref(), Some("222"));
        let page = w.page.expect("a new job is read");
        assert_eq!(page.title, "Commercial Group Analyst (Acquisitions)");
        assert!(page.text.contains("underwriting"));
        // same job again: nothing new to read
        let again = watch_tabs(&[tab.clone()], &["222".to_string()], any, &cancel).unwrap();
        assert!(again.id.is_some() && again.page.is_none());
        // a page that isn't a job
        tab.navigate_to(&format!("{dir}/login.html")).unwrap().wait_until_navigated().unwrap();
        assert!(watch_tabs(&[tab.clone()], &[], any, &cancel).unwrap().id.is_none());
        // only Handshake pages count in the app
        tab.navigate_to(&format!("{dir}/split.html?jobId=222")).unwrap().wait_until_navigated().unwrap();
        assert!(watch_tabs(&[tab], &[], is_handshake, &cancel).unwrap().id.is_none());
    }

    #[test]
    fn reads_detail_panel_not_results_list() {
        let Some((_b, tab)) = browser() else { return };
        tab.navigate_to(concat!("file://", env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/split.html")).unwrap().wait_until_navigated().unwrap();
        let page = extract(&tab).unwrap();
        assert!(page.marked);
        assert_eq!(page.title, "Commercial Group Analyst (Acquisitions)");
        assert_eq!(page.company, "Commercial GRP");
        assert!(page.text.contains("Build underwriting models in Excel"));
        assert!(!page.text.contains("Barista"), "results list leaked in: {}", page.text);
    }

    #[test]
    fn kill_switch_stops_pause() {
        let cancel = AtomicBool::new(true);
        assert!(pause(&cancel, 5000, 6000).is_err());
    }
}
