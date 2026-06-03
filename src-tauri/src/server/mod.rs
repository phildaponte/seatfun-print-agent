pub mod routes;
pub mod printer;
pub mod fgl;
pub mod pairing;
pub mod config;
pub mod logger;

use axum::{
    Router,
    routing::{get, post},
};
use std::sync::Arc;
use tower_http::cors::{CorsLayer, Any};

pub use config::Config;
pub use logger::Logger;
pub use printer::{PrinterClient, PrinterProbe};
pub use pairing::PairingState;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub logger: Arc<Logger>,
    pub printer: Option<Arc<PrinterClient>>,
    pub probe: Arc<PrinterProbe>,
    pub pairing: Arc<PairingState>,
    pub started_at: std::time::Instant,
}

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/v1/health", get(routes::health))
        .route("/v1/status", get(routes::status))
        .route("/v1/pair", post(routes::pair))
        .route("/v1/print", post(routes::print))
        .route("/v1/test-print", post(routes::test_print))
        .route("/v1/settings", get(routes::get_settings).post(routes::post_settings))
        .layer(cors)
        .with_state(state)
}

pub async fn start_server(state: AppState) -> Result<(), Box<dyn std::error::Error>> {
    let addr = format!("{}:{}", state.config.host, state.config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    
    state.logger.info("agent.listening", Some(serde_json::json!({
        "host": state.config.host,
        "port": state.config.port,
        "agent_version": state.config.agent_version,
        "protocol_version": state.config.protocol_version,
        "printer_configured": state.printer.is_some(),
        "paired": state.pairing.is_paired(),
    })));

    let app = create_router(state);
    axum::serve(listener, app).await?;
    Ok(())
}
