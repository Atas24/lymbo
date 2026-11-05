use serde::Serialize;
use std::time::Instant;

/// One working session. Agents may only call the API while a session is active.
#[derive(Default)]
pub struct Session {
    /// Bumps on every start and kill, so a request that was in flight when the
    /// kill switch was hit can tell the session it belonged to is gone.
    pub generation: u64,
    pub started: Option<Instant>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Serialize)]
pub struct SessionStatus {
    pub active: bool,
    pub elapsed_secs: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

impl Session {
    pub fn status(&self) -> SessionStatus {
        SessionStatus {
            active: self.started.is_some(),
            elapsed_secs: self.started.map(|s| s.elapsed().as_secs()).unwrap_or(0),
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            cost_usd: self.cost_usd,
        }
    }
}
