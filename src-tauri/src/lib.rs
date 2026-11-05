mod ai;
mod commands;
mod db;
mod handshake;
mod keys;
mod session;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub session: Mutex<session::Session>,
    /// KASPR's Chrome window. Behind an Arc so slow browser work can run off the UI thread.
    pub handshake: Arc<Mutex<handshake::Handshake>>,
    /// Set by the kill switch; browser work checks it between every step.
    pub hs_cancel: Arc<AtomicBool>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // App data dir survives app updates, so user data is kept.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("lymbo.db"))?;
            app.manage(AppState {
                db: Mutex::new(conn),
                session: Mutex::new(session::Session::default()),
                handshake: Arc::new(Mutex::new(handshake::Handshake::default())),
                hs_cancel: Arc::new(AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session_start,
            commands::session_kill,
            commands::session_status,
            commands::api_key_status,
            commands::api_key_set,
            commands::api_key_remove,
            commands::ai_complete,
            commands::models_list,
            commands::settings_get,
            commands::settings_set,
            commands::resumes_list,
            commands::resume_add,
            commands::resume_set_current,
            commands::resume_upload_pdf,
            commands::resume_pdf,
            commands::resume_open_pdf,
            commands::applications_list,
            commands::application_add,
            commands::application_set_status,
            commands::cover_letters_list,
            commands::cover_letter_add,
            commands::stats_get,
            commands::workshop_increment,
            commands::location_get,
            commands::location_set,
            commands::handshake_login_status,
            commands::handshake_login_set,
            commands::handshake_login_remove,
            commands::handshake_connect,
            commands::handshake_approve_host,
            commands::handshake_check,
            commands::handshake_search,
            commands::handshake_links_on_page,
            commands::handshake_read_job,
            commands::handshake_open,
            commands::handshake_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lymbo");
}
