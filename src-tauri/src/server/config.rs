use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub env_token: Option<String>,
    pub printer_ip: Option<String>,
    pub printer_port: u16,
    pub log_level: String,
    pub agent_version: String,
    pub protocol_version: String,
    pub allowed_origins: Vec<String>,
    pub heartbeat_url: Option<String>,
    pub heartbeat_interval_ms: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 9787,
            env_token: None,
            printer_ip: None,
            printer_port: 9100,
            log_level: "info".to_string(),
            agent_version: "0.1.0".to_string(),
            protocol_version: "1".to_string(),
            allowed_origins: vec![
                "https://app.seatfun.com".to_string(),
                "http://localhost:3000".to_string(),
                "tauri://localhost".to_string(),
            ],
            heartbeat_url: None,
            heartbeat_interval_ms: 60000,
        }
    }
}

impl Config {
    pub fn from_env() -> Self {
        let mut config = Self::default();
        
        if let Ok(host) = env::var("SEATFUN_AGENT_HOST") {
            config.host = host;
        }
        if let Ok(port) = env::var("SEATFUN_AGENT_PORT") {
            config.port = port.parse().unwrap_or(9787);
        }
        config.env_token = env::var("SEATFUN_AGENT_TOKEN").ok();
        config.printer_ip = env::var("PRINTER_IP").ok();
        if let Ok(port) = env::var("PRINTER_PORT") {
            config.printer_port = port.parse().unwrap_or(9100);
        }
        if let Ok(level) = env::var("LOG_LEVEL") {
            config.log_level = level;
        }
        if let Ok(origins) = env::var("SEATFUN_ALLOWED_ORIGINS") {
            config.allowed_origins = origins.split(',').map(|s| s.trim().to_string()).collect();
        }
        config.heartbeat_url = env::var("SEATFUN_HEARTBEAT_URL").ok();
        if let Ok(interval) = env::var("SEATFUN_HEARTBEAT_INTERVAL_MS") {
            config.heartbeat_interval_ms = interval.parse().unwrap_or(60000);
        }
        
        config
    }
}
