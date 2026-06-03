use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use sha2::{Sha256, Digest};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingMetadata {
    pub device_id: Option<String>,
    pub organizer_id: Option<String>,
    pub organizer_name: Option<String>,
    pub device_name: Option<String>,
    pub paired_at: Option<String>,
}

impl Default for PairingMetadata {
    fn default() -> Self {
        Self {
            device_id: None,
            organizer_id: None,
            organizer_name: None,
            device_name: None,
            paired_at: None,
        }
    }
}

pub struct PairingState {
    cached_token: Mutex<Option<String>>,
    cached_metadata: Mutex<PairingMetadata>,
    env_override: bool,
}

impl PairingState {
    pub fn new(env_token: Option<String>) -> Arc<Self> {
        let state = Arc::new(Self {
            cached_token: Mutex::new(None),
            cached_metadata: Mutex::new(PairingMetadata::default()),
            env_override: env_token.is_some(),
        });

        if let Some(token) = env_token {
            *state.cached_token.lock().unwrap() = Some(token);
        }

        state
    }

    pub async fn init(self: Arc<Self>) -> Arc<Self> {
        if !self.env_override {
            let metadata = Self::read_metadata().await.unwrap_or_default();
            *self.cached_metadata.lock().unwrap() = metadata;

            if let Ok(Some(token)) = Self::get_token_from_keychain().await {
                *self.cached_token.lock().unwrap() = Some(token);
            }
        }
        self
    }

    pub fn is_paired(&self) -> bool {
        self.cached_token.lock().unwrap().is_some()
    }

    pub fn get_cached_token(&self) -> Option<String> {
        self.cached_token.lock().unwrap().clone()
    }

    pub fn get_metadata(&self) -> PairingMetadata {
        self.cached_metadata.lock().unwrap().clone()
    }

    pub fn token_fingerprint(&self) -> Option<String> {
        let token = self.cached_token.lock().unwrap();
        token.as_ref().map(|t| {
            let mut hasher = Sha256::new();
            hasher.update(t.as_bytes());
            let result = hasher.finalize();
            format!("sha256:{}", hex::encode(&result[..8]))
        })
    }

    pub async fn set_paired(&self, token: String, meta: PairingMetadata) -> Result<(), String> {
        if self.env_override {
            return Err("Cannot pair while SEATFUN_AGENT_TOKEN env override is set".to_string());
        }

        Self::set_token_in_keychain(&token).await?;

        let mut metadata = meta;
        metadata.paired_at = Some(chrono::Utc::now().to_rfc3339());
        Self::write_metadata(&metadata).await?;

        *self.cached_token.lock().unwrap() = Some(token);
        *self.cached_metadata.lock().unwrap() = metadata;

        Ok(())
    }

    fn app_data_dir() -> PathBuf {
        if cfg!(target_os = "macos") {
            dirs::home_dir()
                .unwrap()
                .join("Library/Application Support/SeatfunPrintAgent")
        } else if cfg!(target_os = "windows") {
            dirs::data_local_dir()
                .unwrap()
                .join("SeatfunPrintAgent")
        } else {
            dirs::config_dir()
                .unwrap()
                .join("seatfun-print-agent")
        }
    }

    fn metadata_file() -> PathBuf {
        Self::app_data_dir().join("pairing.json")
    }

    async fn read_metadata() -> Result<PairingMetadata, String> {
        let path = Self::metadata_file();
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    async fn write_metadata(meta: &PairingMetadata) -> Result<(), String> {
        let dir = Self::app_data_dir();
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| e.to_string())?;

        let path = Self::metadata_file();
        let content = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
        tokio::fs::write(&path, content)
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    async fn get_token_from_keychain() -> Result<Option<String>, String> {
        tokio::task::spawn_blocking(|| {
            let entry = keyring::Entry::new("com.seatfun.print-agent", "bearer-token")
                .map_err(|e| e.to_string())?;
            match entry.get_password() {
                Ok(token) => Ok(Some(token)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }

    async fn set_token_in_keychain(token: &str) -> Result<(), String> {
        if token.len() < 16 {
            return Err("Refusing to store a suspiciously short token".to_string());
        }

        let token = token.to_string();
        tokio::task::spawn_blocking(move || {
            let entry = keyring::Entry::new("com.seatfun.print-agent", "bearer-token")
                .map_err(|e| e.to_string())?;
            entry.set_password(&token).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
}
