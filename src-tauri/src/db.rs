//! Local SQLite store: the Control Room's library.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS resumes (
             id INTEGER PRIMARY KEY,
             label TEXT NOT NULL,
             content TEXT NOT NULL,
             is_current INTEGER NOT NULL DEFAULT 0,
             created_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
         CREATE TABLE IF NOT EXISTS applications (
             id INTEGER PRIMARY KEY,
             company TEXT NOT NULL,
             title TEXT NOT NULL,
             url TEXT NOT NULL DEFAULT '',
             status TEXT NOT NULL DEFAULT 'applied',
             notes TEXT NOT NULL DEFAULT '',
             resume_id INTEGER REFERENCES resumes(id),
             applied_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
         CREATE TABLE IF NOT EXISTS cover_letters (
             id INTEGER PRIMARY KEY,
             application_id INTEGER REFERENCES applications(id),
             company TEXT NOT NULL,
             content TEXT NOT NULL,
             created_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
         CREATE TABLE IF NOT EXISTS ai_cache (
             key TEXT PRIMARY KEY,
             value TEXT NOT NULL,
             created_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
         DELETE FROM ai_cache WHERE created_at < datetime('now', '-14 days');
         DELETE FROM ai_cache WHERE value NOT LIKE '{%';
         CREATE TABLE IF NOT EXISTS kv (
             key TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );",
    )?;
    Ok(conn)
}

// ---------- key/value (settings + counters) ----------

pub fn kv_get(c: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    c.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
        .optional()
}

pub fn kv_set(c: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn kv_add(c: &Connection, key: &str, amount: f64) -> rusqlite::Result<()> {
    let cur: f64 = kv_get(c, key)?.and_then(|v| v.parse().ok()).unwrap_or(0.0);
    kv_set(c, key, &(cur + amount).to_string())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    /// Stronger model, used by SONNY for resume suggestions and cover letters.
    pub model: String,
    /// Cheap, fast model, used by KASPR for skimming and scoring jobs. Empty = pick automatically.
    pub fast_model: String,
    pub fast_input_price_per_mtok: f64,
    pub fast_output_price_per_mtok: f64,
    /// Per-session limit in USD. 0 = no limit.
    pub spend_limit_usd: f64,
    pub input_price_per_mtok: f64,
    pub output_price_per_mtok: f64,
}

pub fn settings(c: &Connection) -> rusqlite::Result<Settings> {
    let num = |k: &str, d: f64| -> rusqlite::Result<f64> {
        Ok(kv_get(c, k)?.and_then(|v| v.parse().ok()).unwrap_or(d))
    };
    Ok(Settings {
        model: kv_get(c, "model")?.unwrap_or_else(|| "claude-sonnet-4-5".into()),
        fast_model: kv_get(c, "fast_model")?.unwrap_or_default(),
        fast_input_price_per_mtok: num("fast_input_price_per_mtok", 1.0)?,
        fast_output_price_per_mtok: num("fast_output_price_per_mtok", 5.0)?,
        spend_limit_usd: num("spend_limit_usd", 0.0)?,
        input_price_per_mtok: num("input_price_per_mtok", 3.0)?,
        output_price_per_mtok: num("output_price_per_mtok", 15.0)?,
    })
}

pub fn save_settings(c: &Connection, s: &Settings) -> rusqlite::Result<()> {
    kv_set(c, "model", s.model.trim())?;
    kv_set(c, "fast_model", s.fast_model.trim())?;
    kv_set(c, "fast_input_price_per_mtok", &s.fast_input_price_per_mtok.max(0.0).to_string())?;
    kv_set(c, "fast_output_price_per_mtok", &s.fast_output_price_per_mtok.max(0.0).to_string())?;
    kv_set(c, "spend_limit_usd", &s.spend_limit_usd.max(0.0).to_string())?;
    kv_set(c, "input_price_per_mtok", &s.input_price_per_mtok.max(0.0).to_string())?;
    kv_set(c, "output_price_per_mtok", &s.output_price_per_mtok.max(0.0).to_string())?;
    Ok(())
}

// ---------- resumes ----------

#[derive(Serialize)]
pub struct Resume {
    pub id: i64,
    pub label: String,
    pub content: String,
    pub is_current: bool,
    pub created_at: String,
}

pub fn resumes(c: &Connection) -> rusqlite::Result<Vec<Resume>> {
    let mut st = c.prepare(
        "SELECT id, label, content, is_current, created_at FROM resumes ORDER BY id DESC",
    )?;
    let rows = st.query_map([], |r| {
        Ok(Resume {
            id: r.get(0)?,
            label: r.get(1)?,
            content: r.get(2)?,
            is_current: r.get::<_, i64>(3)? == 1,
            created_at: r.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn add_resume(c: &Connection, label: &str, content: &str) -> rusqlite::Result<i64> {
    c.execute(
        "INSERT INTO resumes (label, content) VALUES (?1, ?2)",
        params![label, content],
    )?;
    let id = c.last_insert_rowid();
    set_current_resume(c, id)?; // newest upload becomes the current resume
    Ok(id)
}

pub fn set_current_resume(c: &Connection, id: i64) -> rusqlite::Result<()> {
    c.execute("UPDATE resumes SET is_current = (id = ?1)", [id])?;
    Ok(())
}

// ---------- applications ----------

#[derive(Serialize)]
pub struct Application {
    pub id: i64,
    pub company: String,
    pub title: String,
    pub url: String,
    pub status: String,
    pub notes: String,
    pub applied_at: String,
}

pub fn applications(c: &Connection) -> rusqlite::Result<Vec<Application>> {
    let mut st = c.prepare(
        "SELECT id, company, title, url, status, notes, applied_at
         FROM applications ORDER BY applied_at DESC, id DESC",
    )?;
    let rows = st.query_map([], |r| {
        Ok(Application {
            id: r.get(0)?,
            company: r.get(1)?,
            title: r.get(2)?,
            url: r.get(3)?,
            status: r.get(4)?,
            notes: r.get(5)?,
            applied_at: r.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn add_application(
    c: &Connection,
    company: &str,
    title: &str,
    url: &str,
    notes: &str,
) -> rusqlite::Result<i64> {
    let resume_id: Option<i64> = c
        .query_row("SELECT id FROM resumes WHERE is_current = 1", [], |r| r.get(0))
        .optional()?;
    c.execute(
        "INSERT INTO applications (company, title, url, notes, resume_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![company, title, url, notes, resume_id],
    )?;
    Ok(c.last_insert_rowid())
}

pub fn set_application_status(c: &Connection, id: i64, status: &str) -> rusqlite::Result<()> {
    c.execute("UPDATE applications SET status = ?2 WHERE id = ?1", params![id, status])?;
    Ok(())
}

// ---------- cover letters ----------

#[derive(Serialize)]
pub struct CoverLetter {
    pub id: i64,
    pub application_id: Option<i64>,
    pub company: String,
    pub content: String,
    pub created_at: String,
}

pub fn cover_letters(c: &Connection) -> rusqlite::Result<Vec<CoverLetter>> {
    let mut st = c.prepare(
        "SELECT id, application_id, company, content, created_at FROM cover_letters ORDER BY id DESC",
    )?;
    let rows = st.query_map([], |r| {
        Ok(CoverLetter {
            id: r.get(0)?,
            application_id: r.get(1)?,
            company: r.get(2)?,
            content: r.get(3)?,
            created_at: r.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn add_cover_letter(
    c: &Connection,
    application_id: Option<i64>,
    company: &str,
    content: &str,
) -> rusqlite::Result<i64> {
    c.execute(
        "INSERT INTO cover_letters (application_id, company, content) VALUES (?1, ?2, ?3)",
        params![application_id, company, content],
    )?;
    Ok(c.last_insert_rowid())
}

// ---------- stats ----------

#[derive(Serialize)]
pub struct Stats {
    pub applied_count: i64,
    pub workshop_sessions: i64,
    pub seconds_applying: i64,
    pub lifetime_cost_usd: f64,
}

pub fn stats(c: &Connection) -> rusqlite::Result<Stats> {
    let applied_count = c.query_row("SELECT COUNT(*) FROM applications", [], |r| r.get(0))?;
    let num = |k: &str| -> rusqlite::Result<f64> {
        Ok(kv_get(c, k)?.and_then(|v| v.parse().ok()).unwrap_or(0.0))
    };
    Ok(Stats {
        applied_count,
        workshop_sessions: num("workshop_sessions")? as i64,
        seconds_applying: num("seconds_applying")? as i64,
        lifetime_cost_usd: num("lifetime_cost_usd")?,
    })
}

// ---------- AI answer cache (same question twice = no second charge) ----------

pub fn cache_get(c: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    c.query_row(
        "SELECT value FROM ai_cache WHERE key = ?1 AND created_at >= datetime('now', '-14 days')",
        [key],
        |r| r.get(0),
    )
    .optional()
}

pub fn cache_set(c: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO ai_cache (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = datetime('now')",
        params![key, value],
    )?;
    Ok(())
}

/// Stable 64-bit FNV-1a hash, used as the cache key.
pub fn fnv(parts: &[&str]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for p in parts {
        for b in p.bytes().chain(std::iter::once(0)) {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    format!("{h:016x}")
}
