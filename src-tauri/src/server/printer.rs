use tokio::net::TcpStream;
use tokio::io::AsyncWriteExt;
use tokio::time::{timeout, Duration};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub printer_serial: Option<String>,
}

pub struct PrinterClient {
    ip: String,
    port: u16,
    connect_timeout_ms: u64,
    write_timeout_ms: u64,
}

impl PrinterClient {
    pub fn new(ip: String, port: u16) -> Self {
        Self {
            ip,
            port,
            connect_timeout_ms: 5000,
            write_timeout_ms: 30000,
        }
    }

    pub async fn print_raw(&self, fgl: &str) -> PrintResult {
        let connect_result = timeout(
            Duration::from_millis(self.connect_timeout_ms),
            TcpStream::connect(format!("{}:{}", self.ip, self.port))
        ).await;

        let mut stream = match connect_result {
            Ok(Ok(stream)) => stream,
            Ok(Err(e)) => {
                let error_code = if e.kind() == std::io::ErrorKind::ConnectionRefused {
                    "printer_unreachable"
                } else {
                    "printer_unknown"
                };
                return PrintResult {
                    ok: false,
                    error_code: Some(error_code.to_string()),
                    error_text: Some(e.to_string()),
                    printer_serial: None,
                };
            }
            Err(_) => {
                return PrintResult {
                    ok: false,
                    error_code: Some("printer_timeout".to_string()),
                    error_text: Some(format!("Connect timeout after {}ms", self.connect_timeout_ms)),
                    printer_serial: None,
                };
            }
        };

        let write_result = timeout(
            Duration::from_millis(self.write_timeout_ms),
            stream.write_all(fgl.as_bytes())
        ).await;

        match write_result {
            Ok(Ok(_)) => {
                let _ = stream.shutdown().await;
                PrintResult {
                    ok: true,
                    error_code: None,
                    error_text: None,
                    printer_serial: None,
                }
            }
            Ok(Err(e)) => PrintResult {
                ok: false,
                error_code: Some("printer_unknown".to_string()),
                error_text: Some(e.to_string()),
                printer_serial: None,
            },
            Err(_) => PrintResult {
                ok: false,
                error_code: Some("printer_timeout".to_string()),
                error_text: Some(format!("Write timeout after {}ms", self.write_timeout_ms)),
                printer_serial: None,
            },
        }
    }

    pub async fn ping(&self) -> bool {
        let result = timeout(
            Duration::from_millis(self.connect_timeout_ms),
            TcpStream::connect(format!("{}:{}", self.ip, self.port))
        ).await;

        matches!(result, Ok(Ok(_)))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeSnapshot {
    pub reachable: bool,
    pub last_status_at: Option<String>,
    pub last_error: Option<String>,
}

pub struct PrinterProbe {
    printer: Option<Arc<PrinterClient>>,
    snapshot: Arc<Mutex<ProbeSnapshot>>,
    _handle: Option<tokio::task::JoinHandle<()>>,
}

impl PrinterProbe {
    pub fn new(printer: Option<Arc<PrinterClient>>) -> Arc<Self> {
        let snapshot = Arc::new(Mutex::new(ProbeSnapshot {
            reachable: false,
            last_status_at: None,
            last_error: if printer.is_none() {
                Some("printer_not_configured".to_string())
            } else {
                None
            },
        }));

        Arc::new(Self {
            printer,
            snapshot,
            _handle: None,
        })
    }

    pub fn start(self: Arc<Self>) -> Arc<Self> {
        let probe = self.clone();
        let snapshot = self.snapshot.clone();
        let printer = self.printer.clone();

        tokio::spawn(async move {
            loop {
                if let Some(ref printer) = printer {
                    let reachable = printer.ping().await;
                    let mut snap = snapshot.lock().unwrap();
                    snap.reachable = reachable;
                    snap.last_status_at = Some(chrono::Utc::now().to_rfc3339());
                    snap.last_error = if reachable {
                        None
                    } else {
                        Some("printer_unreachable".to_string())
                    };
                } else {
                    let mut snap = snapshot.lock().unwrap();
                    snap.reachable = false;
                    snap.last_status_at = Some(chrono::Utc::now().to_rfc3339());
                    snap.last_error = Some("printer_not_configured".to_string());
                }
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        });

        probe
    }

    pub fn snapshot(&self) -> ProbeSnapshot {
        self.snapshot.lock().unwrap().clone()
    }
}
