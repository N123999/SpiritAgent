use serde_json::Value;
use std::{
    env,
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

/// 设为 `1` 或 `true` 时，将发往 LLM 的 JSON 请求体全文（与 `reqwest::RequestBuilder::json` 序列化一致）
/// 追加写入 spirit-agent.log，便于与抓包/C# 客户端逐字节对照。密钥不会写入此处，仅 body。
const ENV_LOG_HTTP_BODY: &str = "SPIRIT_LOG_HTTP_BODY";

static LOG_FILE: OnceLock<Mutex<std::fs::File>> = OnceLock::new();

pub fn log_file_path() -> PathBuf {
    env::temp_dir().join("spirit-agent.log")
}

pub fn init_logging() {
    let path = log_file_path();
    if let Ok(file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = LOG_FILE.set(Mutex::new(file));
        log_event("logging initialized");
    }
}

pub fn log_json_http_body(label: &str, payload: &Value) {
    let Ok(flag) = env::var(ENV_LOG_HTTP_BODY) else {
        return;
    };
    if !matches!(flag.as_str(), "1" | "true" | "TRUE" | "yes" | "YES") {
        return;
    }

    let body = match serde_json::to_string(payload) {
        Ok(s) => s,
        Err(e) => {
            log_event(&format!("[http-body:{}] serialize error: {}", label, e));
            return;
        }
    };

    const MAX: usize = 48_000usize;
    if body.len() <= MAX {
        log_event(&format!("[http-body:{}] {}", label, body));
    } else {
        log_event(&format!(
            "[http-body:{}] {}...(truncated, total {} bytes)",
            label,
            &body[..MAX],
            body.len()
        ));
    }
}

pub fn log_event(message: &str) {
    let Some(lock) = LOG_FILE.get() else {
        return;
    };

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    if let Ok(mut file) = lock.lock() {
        let _ = writeln!(file, "[{}] {}", ts, message);
        let _ = file.flush();
    }
}
