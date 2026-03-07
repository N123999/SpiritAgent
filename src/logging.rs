use std::{
    env,
    fs::OpenOptions,
    io::Write,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

static LOG_FILE: OnceLock<Mutex<std::fs::File>> = OnceLock::new();

pub fn init_logging() {
    let path = env::temp_dir().join("spirit-agent.log");
    if let Ok(file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = LOG_FILE.set(Mutex::new(file));
        log_event("logging initialized");
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
