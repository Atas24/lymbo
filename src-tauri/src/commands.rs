//! Everything the React UI can call. Each returns Result<_, String> so errors
//! show up as readable messages in the app.
use crate::{ai, convert, db, docx, handshake, keys, session::SessionStatus, AppState};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};

fn db_err(e: rusqlite::Error) -> String {
    format!("Database error: {e}")
}

// ---------- session + kill switch ----------

#[tauri::command]
pub fn session_start(state: State<'_, AppState>) -> Result<SessionStatus, String> {
    let mut s = state.session.lock().unwrap();
    if s.started.is_none() {
        s.generation += 1;
        s.started = Some(Instant::now());
        s.input_tokens = 0;
        s.output_tokens = 0;
        s.cost_usd = 0.0;
        state.hs_cancel.store(false, Ordering::SeqCst);
    }
    Ok(s.status())
}

/// The kill switch. Ends the session right away; any agent request still in
/// flight is thrown away when it returns, and no new ones are allowed.
#[tauri::command]
pub fn session_kill(state: State<'_, AppState>) -> Result<SessionStatus, String> {
    let mut s = state.session.lock().unwrap();
    if let Some(started) = s.started.take() {
        let secs = started.elapsed().as_secs() as f64;
        let conn = state.db.lock().unwrap();
        db::kv_add(&conn, "seconds_applying", secs).map_err(db_err)?;
    }
    s.generation += 1;
    // Stop KASPR's browser work at its next checkpoint, then close Chrome.
    // Done on a side thread so the button responds instantly.
    state.hs_cancel.store(true, Ordering::SeqCst);
    let hs = state.handshake.clone();
    std::thread::spawn(move || hs.lock().unwrap_or_else(|p| p.into_inner()).close());
    Ok(s.status())
}

#[tauri::command]
pub fn session_status(state: State<'_, AppState>) -> SessionStatus {
    state.session.lock().unwrap().status()
}

// ---------- API key (BYOK) ----------

#[tauri::command]
pub fn api_key_status() -> Result<bool, String> {
    Ok(keys::get()?.is_some())
}

/// Checks the key with Anthropic first, and only saves it if it works.
#[tauri::command]
pub async fn api_key_set(key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Paste an API key first.".into());
    }
    ai::validate(&key).await?;
    keys::set(&key)
}

/// Model names the saved key can use, for the Settings dropdown.
#[tauri::command]
pub async fn models_list() -> Result<Vec<String>, String> {
    let key = keys::get()?.ok_or("Add your Anthropic API key first.")?;
    ai::list_models(&key).await
}

#[tauri::command]
pub fn api_key_remove() -> Result<(), String> {
    keys::remove()
}

// ---------- AI ----------

#[derive(Serialize)]
pub struct AiResult {
    pub text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
    pub session: SessionStatus,
}

#[tauri::command]
pub async fn ai_complete(
    state: State<'_, AppState>,
    agent: String,
    system: String,
    prompt: String,
    max_tokens: Option<u32>,
    tier: Option<String>,
    cache: Option<bool>,
    json: Option<bool>,
) -> Result<AiResult, String> {
    let json = json.unwrap_or(false);
    // "fast" = cheap model for KASPR's skimming and scoring; anything else = the stronger model.
    let fast = tier.as_deref() == Some("fast");
    // Gather everything we need, then release the locks before the network call.
    let (generation, settings) = {
        let s = state.session.lock().unwrap();
        if s.started.is_none() {
            return Err("Start a session before using the agents.".into());
        }
        let conn = state.db.lock().unwrap();
        let settings = db::settings(&conn).map_err(db_err)?;
        if settings.spend_limit_usd > 0.0 && s.cost_usd >= settings.spend_limit_usd {
            return Err(format!(
                "Spending limit reached (${:.2} this session). Raise it in Settings or end the session.",
                settings.spend_limit_usd
            ));
        }
        (s.generation, settings)
    };
    let key = keys::get()?.ok_or("Add your Anthropic API key in Settings first.")?;

    let (model_key, family) = if fast { ("fast_model", "haiku") } else { ("model", "sonnet") };
    let mut model = if fast { settings.fast_model.clone() } else { settings.model.clone() };
    let (in_price, out_price) = if fast {
        (settings.fast_input_price_per_mtok, settings.fast_output_price_per_mtok)
    } else {
        (settings.input_price_per_mtok, settings.output_price_per_mtok)
    };

    let system = format!("You are {agent}, an assistant inside the Lymbo job search app. {system}");
    let max = max_tokens.unwrap_or(1500);

    // Same question as before (same tier, instructions and text)? Reuse the saved answer for free.
    // Callers turn this off where a fresh answer is the point, like a new cover letter draft.
    let use_cache = cache.unwrap_or(true);
    let cache_key = db::fnv(&[if fast { "fast" } else { "smart" }, if json { "json" } else { "text" }, &system, &prompt]);
    if use_cache {
        let hit = db::cache_get(&state.db.lock().unwrap(), &cache_key).map_err(db_err)?;
        if let Some(text) = hit {
            return Ok(AiResult {
                text,
                input_tokens: 0,
                output_tokens: 0,
                cost_usd: 0.0,
                session: state.session.lock().unwrap().status(),
            });
        }
    }
    let first = if model.trim().is_empty() {
        Err(ai::MODEL_NOT_FOUND.to_string())
    } else {
        ai::complete(&key, &model, &system, &prompt, max, json).await
    };
    let out = match first {
        // No model picked yet, or the saved one was retired: pick a current one and retry once.
        Err(e) if e == ai::MODEL_NOT_FOUND => {
            let models = ai::list_models(&key).await?;
            model = ai::pick_family(&models, family).ok_or("Your API key has no models available.")?;
            {
                let conn = state.db.lock().unwrap();
                db::kv_set(&conn, model_key, &model).map_err(db_err)?;
            }
            ai::complete(&key, &model, &system, &prompt, max, json).await?
        }
        other => other?,
    };

    let cost = out.input_tokens as f64 / 1e6 * in_price + out.output_tokens as f64 / 1e6 * out_price;

    let mut s = state.session.lock().unwrap();
    {
        // The money is spent either way, so always count it toward lifetime cost.
        let conn = state.db.lock().unwrap();
        db::kv_add(&conn, "lifetime_cost_usd", cost).map_err(db_err)?;
        // Only keep answers worth reusing: valid JSON for structured calls, non-empty text otherwise.
        let good = if json { serde_json::from_str::<serde_json::Value>(&out.text).is_ok() } else { !out.text.trim().is_empty() };
        if use_cache && good {
            db::cache_set(&conn, &cache_key, &out.text).map_err(db_err)?;
        }
    }
    if s.generation != generation || s.started.is_none() {
        return Err("Session was ended, so the agent's reply was discarded.".into());
    }
    s.input_tokens += out.input_tokens;
    s.output_tokens += out.output_tokens;
    s.cost_usd += cost;
    Ok(AiResult {
        text: out.text,
        input_tokens: out.input_tokens,
        output_tokens: out.output_tokens,
        cost_usd: cost,
        session: s.status(),
    })
}

// ---------- settings ----------

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<db::Settings, String> {
    db::settings(&state.db.lock().unwrap()).map_err(db_err)
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, settings: db::Settings) -> Result<(), String> {
    if settings.model.trim().is_empty() {
        return Err("Model name can't be empty.".into());
    }
    db::save_settings(&state.db.lock().unwrap(), &settings).map_err(db_err)
}

// ---------- Control Room library ----------

#[tauri::command]
pub fn resumes_list(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<db::Resume>, String> {
    let mut list = db::resumes(&state.db.lock().unwrap()).map_err(db_err)?;
    for r in &mut list {
        r.has_docx = file_path(&app, "resumes", r.id, "docx")?.exists();
        r.has_pdf = file_path(&app, "resumes", r.id, "pdf")?.exists();
    }
    Ok(list)
}

#[tauri::command]
pub fn resume_add(state: State<'_, AppState>, label: String, content: String) -> Result<i64, String> {
    if content.trim().is_empty() {
        return Err("Resume text is empty.".into());
    }
    db::add_resume(&state.db.lock().unwrap(), label.trim(), &content).map_err(db_err)
}

/// Takes an uploaded resume PDF, pulls out its text for the agents, and saves it as the current resume.
#[tauri::command]
pub fn resume_upload_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<i64, String> {
    if !bytes.starts_with(b"%PDF") {
        return Err("That file isn't a PDF.".into());
    }
    // Some PDFs make the parser panic; turn that into a normal error.
    let text = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(&bytes))
        .map_err(|_| "Couldn't read that PDF.".to_string())?
        .map_err(|_| "Couldn't read that PDF.".to_string())?;
    let text = text
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .replace("\n\n\n", "\n\n");
    if text.trim().len() < 50 {
        return Err("This PDF has no readable text (it may be a scanned image). Export your resume to PDF from Word or Google Docs and try again.".into());
    }
    let label = file_name.trim_end_matches(".pdf").trim_end_matches(".PDF").to_string();
    let id = db::add_resume(&state.db.lock().unwrap(), &label, &text).map_err(db_err)?;
    // Keep the original PDF so SONNY and the Control Room can show it.
    let path = resume_pdf_path(&app, id)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| format!("Couldn't save the PDF: {e}"))?;
    Ok(id)
}

fn resume_pdf_path(app: &AppHandle, id: i64) -> Result<std::path::PathBuf, String> {
    file_path(app, "resumes", id, "pdf")
}

/// `<app data>/<folder>/<id>.<ext>`, e.g. resumes/3.docx or versions/7.pdf.
fn file_path(app: &AppHandle, folder: &str, id: i64, ext: &str) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(folder)
        .join(format!("{id}.{ext}")))
}

fn open_file(app: &AppHandle, path: &std::path::Path) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !path.exists() {
        return Err("That file isn't there anymore.".into());
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Couldn't open the file: {e}"))
}

/// Takes an uploaded .docx resume: keeps the file (SONNY edits copies of it),
/// pulls out its text for the agents, and makes a PDF preview if it can.
#[tauri::command]
pub async fn resume_upload_docx(
    app: AppHandle,
    state: State<'_, AppState>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<i64, String> {
    let text = docx::text_of(&bytes)?;
    if text.trim().len() < 50 {
        return Err("That .docx doesn't have enough text to be a resume.".into());
    }
    let label = file_name.trim_end_matches(".docx").trim_end_matches(".DOCX").to_string();
    let id = db::add_resume(&state.db.lock().unwrap(), &label, &text).map_err(db_err)?;
    let docx_path = file_path(&app, "resumes", id, "docx")?;
    std::fs::create_dir_all(docx_path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&docx_path, &bytes).map_err(|e| format!("Couldn't save the file: {e}"))?;
    let pdf_path = file_path(&app, "resumes", id, "pdf")?;
    // Preview only: fine if there's no Word/LibreOffice to make it.
    let _ = tauri::async_runtime::spawn_blocking(move || convert::docx_to_pdf(&docx_path, &pdf_path)).await;
    Ok(id)
}

#[derive(Serialize)]
pub struct ParaOut {
    pub p: usize,
    pub text: String,
    pub locked: bool,
}

/// The resume's lines, numbered, for SONNY to suggest edits against.
#[tauri::command]
pub fn resume_paragraphs(app: AppHandle, id: i64) -> Result<Vec<ParaOut>, String> {
    let bytes = std::fs::read(file_path(&app, "resumes", id, "docx")?)
        .map_err(|_| "Upload your resume as a Word file (.docx) so SONNY can make versions of it.".to_string())?;
    let xml = docx::document_xml(&bytes)?;
    Ok(docx::paragraphs(&xml)
        .into_iter()
        .enumerate()
        .filter(|(_, p)| !p.text.trim().is_empty())
        .map(|(i, p)| ParaOut { p: i, text: p.text, locked: p.locked })
        .collect())
}

/// Opens a resume's .docx or .pdf in the default app (Word, Pages, Preview…).
#[tauri::command]
pub fn resume_open_file(app: AppHandle, id: i64, kind: String) -> Result<(), String> {
    let ext = if kind == "docx" { "docx" } else { "pdf" };
    open_file(&app, &file_path(&app, "resumes", id, ext)?)
}

// ---------- resume versions ----------

#[tauri::command]
pub fn versions_list(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<db::Version>, String> {
    let mut list = db::versions(&state.db.lock().unwrap()).map_err(db_err)?;
    for v in &mut list {
        v.has_pdf = file_path(&app, "versions", v.id, "pdf")?.exists();
    }
    Ok(list)
}

/// SONNY proposes a version; it waits for the user's OK before anything is written.
#[tauri::command]
pub fn version_create(
    state: State<'_, AppState>,
    base_resume_id: i64,
    label: String,
    summary: String,
    edits: Vec<docx::Edit>,
    job_ids: Vec<String>,
    keywords: Vec<String>,
) -> Result<i64, String> {
    let mut kws = serde_json::Map::new();
    for k in keywords {
        kws.insert(k, 1.into());
    }
    db::add_version(
        &state.db.lock().unwrap(),
        base_resume_id,
        label.trim(),
        summary.trim(),
        &serde_json::to_string(&edits).unwrap(),
        &serde_json::to_string(&job_ids).unwrap(),
        &serde_json::Value::Object(kws).to_string(),
    )
    .map_err(db_err)
}

/// The user approved a version (with the edits they kept): write its .docx and PDF.
#[tauri::command]
pub async fn version_approve(app: AppHandle, state: State<'_, AppState>, id: i64, edits: Vec<docx::Edit>) -> Result<(), String> {
    let base = db::version_base(&state.db.lock().unwrap(), id).map_err(db_err)?;
    let base_bytes = std::fs::read(file_path(&app, "resumes", base, "docx")?)
        .map_err(|_| "The original .docx for this version is missing. Upload it again in the Control Room.".to_string())?;
    let out = docx::apply(&base_bytes, &edits)?;
    let text = docx::text_of(&out)?;
    let docx_path = file_path(&app, "versions", id, "docx")?;
    std::fs::create_dir_all(docx_path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&docx_path, &out).map_err(|e| format!("Couldn't save the version: {e}"))?;
    db::approve_version(&state.db.lock().unwrap(), id, &serde_json::to_string(&edits).unwrap(), &text).map_err(db_err)?;
    let pdf_path = file_path(&app, "versions", id, "pdf")?;
    let _ = tauri::async_runtime::spawn_blocking(move || convert::docx_to_pdf(&docx_path, &pdf_path)).await;
    Ok(())
}

/// Deletes a resume, its files, and the versions made from it.
#[tauri::command]
pub fn resume_delete(app: AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let vids = db::delete_resume(&state.db.lock().unwrap(), id).map_err(db_err)?;
    for ext in ["docx", "pdf"] {
        let _ = std::fs::remove_file(file_path(&app, "resumes", id, ext)?);
        for v in &vids {
            let _ = std::fs::remove_file(file_path(&app, "versions", *v, ext)?);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn version_delete(app: AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    db::delete_version(&state.db.lock().unwrap(), id).map_err(db_err)?;
    for ext in ["docx", "pdf"] {
        let _ = std::fs::remove_file(file_path(&app, "versions", id, ext)?);
    }
    Ok(())
}

#[tauri::command]
pub fn cover_letter_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    db::delete_cover_letter(&state.db.lock().unwrap(), id).map_err(db_err)
}

#[tauri::command]
pub fn version_archive(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    db::set_version_status(&state.db.lock().unwrap(), id, "archived").map_err(db_err)
}

/// KASPR matched a job to this version; the version's keyword profile grows.
#[tauri::command]
pub fn version_learn(state: State<'_, AppState>, id: i64, job_id: String, keywords: Vec<String>) -> Result<(), String> {
    db::version_learn(&state.db.lock().unwrap(), id, &job_id, &keywords).map_err(db_err)
}

#[tauri::command]
pub fn version_open(app: AppHandle, id: i64, kind: String) -> Result<(), String> {
    let ext = if kind == "docx" { "docx" } else { "pdf" };
    open_file(&app, &file_path(&app, "versions", id, ext)?)
}

/// PDF bytes for the in-app preview.
#[tauri::command]
pub fn version_pdf(app: AppHandle, id: i64) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(file_path(&app, "versions", id, "pdf")?).map_err(|_| "No PDF for this version yet.".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Try making the PDF again (e.g. after installing Word or LibreOffice).
#[tauri::command]
pub async fn version_export_pdf(app: AppHandle, id: i64) -> Result<(), String> {
    let src = file_path(&app, "versions", id, "docx")?;
    let dst = file_path(&app, "versions", id, "pdf")?;
    tauri::async_runtime::spawn_blocking(move || convert::docx_to_pdf(&src, &dst))
        .await
        .map_err(|e| e.to_string())?
}

/// The resume's original PDF, sent as raw bytes. Errors if it was pasted as text.
#[tauri::command]
pub fn resume_pdf(app: AppHandle, id: i64) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(resume_pdf_path(&app, id)?)
        .map_err(|_| "No PDF saved for this resume.".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Opens the resume PDF in the Mac's default PDF app (Preview).
#[tauri::command]
pub fn resume_open_pdf(app: AppHandle, id: i64) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = resume_pdf_path(&app, id)?;
    if !path.exists() {
        return Err("No PDF saved for this resume.".into());
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Couldn't open the PDF: {e}"))
}

#[tauri::command]
pub fn resume_set_current(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    db::set_current_resume(&state.db.lock().unwrap(), id).map_err(db_err)
}

#[tauri::command]
pub fn applications_list(state: State<'_, AppState>) -> Result<Vec<db::Application>, String> {
    db::applications(&state.db.lock().unwrap()).map_err(db_err)
}

#[tauri::command]
pub fn application_add(
    state: State<'_, AppState>,
    company: String,
    title: String,
    url: String,
    notes: String,
    version_id: Option<i64>,
) -> Result<i64, String> {
    if company.trim().is_empty() || title.trim().is_empty() {
        return Err("Company and job title are required.".into());
    }
    db::add_application(&state.db.lock().unwrap(), company.trim(), title.trim(), url.trim(), &notes, version_id)
        .map_err(db_err)
}

#[tauri::command]
pub fn application_set_status(state: State<'_, AppState>, id: i64, status: String) -> Result<(), String> {
    db::set_application_status(&state.db.lock().unwrap(), id, &status).map_err(db_err)
}

#[tauri::command]
pub fn cover_letters_list(state: State<'_, AppState>) -> Result<Vec<db::CoverLetter>, String> {
    db::cover_letters(&state.db.lock().unwrap()).map_err(db_err)
}

#[tauri::command]
pub fn cover_letter_add(
    state: State<'_, AppState>,
    application_id: Option<i64>,
    company: String,
    content: String,
) -> Result<i64, String> {
    db::add_cover_letter(&state.db.lock().unwrap(), application_id, &company, &content).map_err(db_err)
}

#[tauri::command]
pub fn stats_get(state: State<'_, AppState>) -> Result<db::Stats, String> {
    db::stats(&state.db.lock().unwrap()).map_err(db_err)
}

#[tauri::command]
pub fn workshop_increment(state: State<'_, AppState>) -> Result<(), String> {
    db::kv_add(&state.db.lock().unwrap(), "workshop_sessions", 1.0).map_err(db_err)
}

// ---------- where the user wants to work (asked by KASPR) ----------

#[derive(Serialize)]
pub struct LocationPref {
    /// What the user typed, in their own words.
    pub text: String,
    /// KASPR's structured read of it (JSON), used for search filters.
    pub parsed: Option<String>,
}

#[tauri::command]
pub fn location_get(state: State<'_, AppState>) -> Result<Option<LocationPref>, String> {
    let conn = state.db.lock().unwrap();
    let text = db::kv_get(&conn, "location_text").map_err(db_err)?;
    let parsed = db::kv_get(&conn, "location_parsed").map_err(db_err)?;
    Ok(text.map(|text| LocationPref { text, parsed }))
}

#[tauri::command]
pub fn location_set(state: State<'_, AppState>, text: String, parsed: Option<String>) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::kv_set(&conn, "location_text", text.trim()).map_err(db_err)?;
    db::kv_set(&conn, "location_parsed", parsed.as_deref().unwrap_or("")).map_err(db_err)
}

// ---------- Handshake (KASPR's browser) ----------

#[derive(Serialize)]
pub struct HandshakeLoginInfo {
    pub email: String,
    pub method: String,
}

/// Only the email and sign-in method go back to the UI, never the password.
#[tauri::command]
pub fn handshake_login_status() -> Result<Option<HandshakeLoginInfo>, String> {
    Ok(keys::handshake_get()?.map(|l| HandshakeLoginInfo { email: l.email, method: l.method }))
}

#[tauri::command]
pub fn handshake_login_set(email: String, password: String, method: String) -> Result<(), String> {
    if email.trim().is_empty() || password.is_empty() {
        return Err("Enter both your email and password.".into());
    }
    let method = if method == "handshake" { "handshake" } else { "school" };
    keys::handshake_set(&keys::HandshakeLogin {
        email: email.trim().into(),
        password,
        method: method.into(),
    })
}

#[tauri::command]
pub fn handshake_login_remove() -> Result<(), String> {
    keys::handshake_remove()
}

/// Runs browser work on a background thread so the window never freezes.
async fn with_browser<T, F>(state: &State<'_, AppState>, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut handshake::Handshake, &AtomicBool) -> Result<T, String> + Send + 'static,
{
    if state.session.lock().unwrap().started.is_none() {
        return Err("Start a session first. KASPR only works while a session is running.".into());
    }
    let hs = state.handshake.clone();
    let cancel = state.hs_cancel.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut h = hs.lock().unwrap_or_else(|p| p.into_inner());
        f(&mut h, &cancel)
    })
    .await
    .map_err(|_| "KASPR's browser task crashed.".to_string())?
}

fn approved_hosts(state: &State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().unwrap();
    let raw = db::kv_get(&conn, "approved_login_hosts").map_err(db_err)?;
    Ok(raw.and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_default())
}

#[tauri::command]
pub async fn handshake_connect(app: AppHandle, state: State<'_, AppState>) -> Result<handshake::LoginOutcome, String> {
    let login = keys::handshake_get()?.ok_or("Add your Handshake login first.")?;
    let approved = approved_hosts(&state)?;
    let profile = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("handshake-profile");
    with_browser(&state, move |h, cancel| h.connect(&profile, &login, &approved, cancel)).await
}

/// The user said KASPR may type their login on this school sign-in page.
#[tauri::command]
pub fn handshake_approve_host(state: State<'_, AppState>, host: String) -> Result<(), String> {
    let mut hosts = approved_hosts(&state)?;
    let host = host.trim().to_lowercase();
    if !hosts.contains(&host) {
        hosts.push(host);
    }
    let conn = state.db.lock().unwrap();
    db::kv_set(&conn, "approved_login_hosts", &serde_json::to_string(&hosts).unwrap()).map_err(db_err)
}

#[tauri::command]
pub async fn handshake_check(state: State<'_, AppState>) -> Result<bool, String> {
    with_browser(&state, |h, _| h.check_logged_in()).await
}

#[tauri::command]
pub async fn handshake_search(state: State<'_, AppState>, query: String) -> Result<Vec<handshake::JobLink>, String> {
    with_browser(&state, move |h, cancel| h.search(&query, cancel)).await
}

#[tauri::command]
pub async fn handshake_links_on_page(state: State<'_, AppState>) -> Result<Vec<handshake::JobLink>, String> {
    with_browser(&state, |h, cancel| h.links_on_page(cancel)).await
}

#[tauri::command]
pub async fn handshake_read_job(state: State<'_, AppState>, url: String) -> Result<handshake::JobPage, String> {
    with_browser(&state, move |h, cancel| h.read_job(&url, cancel)).await
}

#[tauri::command]
pub async fn handshake_open(state: State<'_, AppState>, url: String) -> Result<(), String> {
    with_browser(&state, move |h, cancel| h.open(&url, cancel)).await
}

#[tauri::command]
pub async fn handshake_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    let hs = state.handshake.clone();
    tauri::async_runtime::spawn_blocking(move || hs.lock().unwrap_or_else(|p| p.into_inner()).close())
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_a_resume_pdf() {
        let bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/resume.pdf")).unwrap();
        let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        assert!(text.contains("Python"), "got: {text}");
    }
}
