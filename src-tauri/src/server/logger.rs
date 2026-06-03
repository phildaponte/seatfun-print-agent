use serde_json::{json, Value};
use std::collections::HashSet;

pub struct Logger {
    level: LogLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum LogLevel {
    Debug = 10,
    Info = 20,
    Warn = 30,
    Error = 40,
}

impl LogLevel {
    fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "debug" => LogLevel::Debug,
            "info" => LogLevel::Info,
            "warn" => LogLevel::Warn,
            "error" => LogLevel::Error,
            _ => LogLevel::Info,
        }
    }
}

impl Logger {
    pub fn new(level: &str) -> Self {
        Self {
            level: LogLevel::from_str(level),
        }
    }

    fn redact(data: &mut Value) {
        let redact_keys: HashSet<&str> = ["authorization", "token", "bearer", "qr_payload"]
            .iter()
            .copied()
            .collect();

        if let Value::Object(map) = data {
            for (key, value) in map.iter_mut() {
                if redact_keys.contains(key.to_lowercase().as_str()) {
                    *value = json!("[REDACTED]");
                }
            }
        }
    }

    fn log(&self, level: LogLevel, msg: &str, data: Option<Value>) {
        if level < self.level {
            return;
        }

        let mut log_data = json!({
            "ts": chrono::Utc::now().to_rfc3339(),
            "level": match level {
                LogLevel::Debug => "debug",
                LogLevel::Info => "info",
                LogLevel::Warn => "warn",
                LogLevel::Error => "error",
            },
            "msg": msg,
        });

        if let Some(mut data) = data {
            Self::redact(&mut data);
            if let Value::Object(ref mut log_map) = log_data {
                if let Value::Object(data_map) = data {
                    for (k, v) in data_map {
                        log_map.insert(k, v);
                    }
                }
            }
        }

        let output = serde_json::to_string(&log_data).unwrap_or_else(|_| "{}".to_string());
        
        match level {
            LogLevel::Error | LogLevel::Warn => eprintln!("{}", output),
            _ => println!("{}", output),
        }
    }

    pub fn debug(&self, msg: &str, data: Option<Value>) {
        self.log(LogLevel::Debug, msg, data);
    }

    pub fn info(&self, msg: &str, data: Option<Value>) {
        self.log(LogLevel::Info, msg, data);
    }

    pub fn warn(&self, msg: &str, data: Option<Value>) {
        self.log(LogLevel::Warn, msg, data);
    }

    pub fn error(&self, msg: &str, data: Option<Value>) {
        self.log(LogLevel::Error, msg, data);
    }
}
