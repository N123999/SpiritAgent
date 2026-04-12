use std::sync::{Mutex, OnceLock};

static SHARED_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(crate) fn shared_env_lock() -> &'static Mutex<()> {
    SHARED_ENV_LOCK.get_or_init(|| Mutex::new(()))
}