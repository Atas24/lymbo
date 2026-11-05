//! The shared local AI service. KASPR and SONNY both go through here.
use serde::{Deserialize, Serialize};

const API: &str = "https://api.anthropic.com/v1";
const VERSION: &str = "2023-06-01";

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

// Errors are written by hand so the key (sent as a header) can never end up in them.
fn net_err(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "The request to Anthropic timed out.".into()
    } else {
        "Could not reach Anthropic. Check your internet connection.".into()
    }
}

fn status_err(code: reqwest::StatusCode) -> String {
    match code.as_u16() {
        401 => "Anthropic rejected the API key.".into(),
        403 => "This API key isn't allowed to do that.".into(),
        404 => MODEL_NOT_FOUND.into(),
        429 => "Rate limited by Anthropic. Wait a moment and try again.".into(),
        529 => "Anthropic is overloaded right now. Try again shortly.".into(),
        c => format!("Anthropic returned an error ({c})."),
    }
}

/// Cheap check that the key works: lists models, uses no tokens.
pub async fn validate(key: &str) -> Result<(), String> {
    let res = client()
        .get(format!("{API}/models"))
        .header("x-api-key", key)
        .header("anthropic-version", VERSION)
        .send()
        .await
        .map_err(net_err)?;
    if res.status().is_success() {
        Ok(())
    } else {
        Err(status_err(res.status()))
    }
}

#[derive(Deserialize)]
struct ModelList {
    data: Vec<ModelInfo>,
}
#[derive(Deserialize)]
struct ModelInfo {
    id: String,
}

/// Models this key can use, newest first (as Anthropic returns them).
pub async fn list_models(key: &str) -> Result<Vec<String>, String> {
    let res = client()
        .get(format!("{API}/models?limit=100"))
        .header("x-api-key", key)
        .header("anthropic-version", VERSION)
        .send()
        .await
        .map_err(net_err)?;
    if !res.status().is_success() {
        return Err(status_err(res.status()));
    }
    let list: ModelList = res.json().await.map_err(|_| "Couldn't read the model list.".to_string())?;
    Ok(list.data.into_iter().map(|m| m.id).collect())
}

/// Newest model in a family ("haiku", "sonnet", ...), else the newest model of any kind.
pub fn pick_family(models: &[String], family: &str) -> Option<String> {
    models
        .iter()
        .find(|m| m.contains(family))
        .or_else(|| models.first())
        .cloned()
}

pub const MODEL_NOT_FOUND: &str = "Model not found. Check the model name in Settings.";

#[derive(Serialize)]
struct Msg<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct Req<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: Vec<Msg<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Block {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    input: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Usage {
    input_tokens: u64,
    output_tokens: u64,
}

#[derive(Deserialize)]
struct Resp {
    content: Vec<Block>,
    usage: Usage,
}

pub struct Completion {
    pub text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// `json`: make the model answer through a forced tool call, so the reply is
/// always a valid JSON object (no stray text or code fences to trip over).
pub async fn complete(
    key: &str,
    model: &str,
    system: &str,
    prompt: &str,
    max_tokens: u32,
    json: bool,
) -> Result<Completion, String> {
    let (tools, tool_choice) = if json {
        (
            Some(serde_json::json!([{
                "name": "respond",
                "description": "Send your answer as the JSON object described in the instructions.",
                "input_schema": { "type": "object", "additionalProperties": true }
            }])),
            Some(serde_json::json!({ "type": "tool", "name": "respond" })),
        )
    } else {
        (None, None)
    };
    let body = Req {
        model,
        max_tokens,
        system,
        messages: vec![Msg { role: "user", content: prompt }],
        tools,
        tool_choice,
    };
    let res = client()
        .post(format!("{API}/messages"))
        .header("x-api-key", key)
        .header("anthropic-version", VERSION)
        .json(&body)
        .send()
        .await
        .map_err(net_err)?;
    if !res.status().is_success() {
        return Err(status_err(res.status()));
    }
    let r: Resp = res
        .json()
        .await
        .map_err(|_| "Couldn't read Anthropic's response.".to_string())?;
    let text = if json {
        r.content
            .into_iter()
            .find(|b| b.kind == "tool_use")
            .and_then(|b| b.input)
            .filter(|v| v.is_object())
            .map(|v| v.to_string())
            .ok_or_else(|| "The agent didn't answer in the expected format. Try again.".to_string())?
    } else {
        r.content
            .into_iter()
            .filter(|b| b.kind == "text")
            .map(|b| b.text)
            .collect::<Vec<_>>()
            .join("\n")
    };
    Ok(Completion {
        text,
        input_tokens: r.usage.input_tokens,
        output_tokens: r.usage.output_tokens,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_mode_reads_tool_answer() {
        // What Anthropic sends back for a forced tool call.
        let raw = r#"{"content":[{"type":"tool_use","id":"t1","name":"respond","input":{"queries":["data analyst intern","bi intern"]}}],
                      "usage":{"input_tokens":10,"output_tokens":5}}"#;
        let r: Resp = serde_json::from_str(raw).unwrap();
        let text = r.content.into_iter().find(|b| b.kind == "tool_use").and_then(|b| b.input).unwrap().to_string();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["queries"][0], "data analyst intern");
    }

    #[test]
    fn json_mode_request_shape() {
        let body = Req {
            model: "m", max_tokens: 10, system: "s",
            messages: vec![Msg { role: "user", content: "hi" }],
            tools: Some(serde_json::json!([{"name": "respond", "input_schema": {"type": "object"}}])),
            tool_choice: Some(serde_json::json!({"type": "tool", "name": "respond"})),
        };
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(v["tool_choice"]["name"], "respond");
        let plain = Req { model: "m", max_tokens: 10, system: "s", messages: vec![], tools: None, tool_choice: None };
        assert!(serde_json::to_value(&plain).unwrap().get("tools").is_none());
    }
}
