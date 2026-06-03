use axum::{
    extract::{State, Json},
    http::{StatusCode, HeaderMap},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use crate::server::{AppState, fgl};
use std::sync::Arc;

#[derive(Serialize)]
struct ErrorResponse {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: String,
    message: String,
    request_id: String,
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

fn verify_bearer(headers: &HeaderMap, expected: Option<String>) -> Result<(), (StatusCode, String, String)> {
    let token = extract_bearer(headers).ok_or((
        StatusCode::UNAUTHORIZED,
        "unauthorized".to_string(),
        "Missing or invalid Authorization header".to_string(),
    ))?;

    let expected = expected.ok_or((
        StatusCode::UNAUTHORIZED,
        "unpaired".to_string(),
        "Agent not paired".to_string(),
    ))?;

    if token != expected {
        return Err((
            StatusCode::UNAUTHORIZED,
            "unauthorized".to_string(),
            "Invalid bearer token".to_string(),
        ));
    }

    Ok(())
}

pub async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let snap = state.probe.snapshot();
    let meta = state.pairing.get_metadata();

    Json(json!({
        "ok": true,
        "agent_version": state.config.agent_version,
        "protocol_version": state.config.protocol_version,
        "paired": state.pairing.is_paired(),
        "device": {
            "device_id": meta.device_id,
            "organizer_id": meta.organizer_id,
            "device_name": meta.device_name,
        },
        "printer": {
            "configured": state.printer.is_some(),
            "ip": state.config.printer_ip,
            "reachable": snap.reachable,
            "last_status_at": snap.last_status_at,
            "serial": serde_json::Value::Null,
            "model": serde_json::Value::Null,
            "firmware": serde_json::Value::Null,
        },
    }))
}

pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    verify_bearer(&headers, state.pairing.get_cached_token())
        .map_err(|(status, code, msg)| {
            let request_id = uuid::Uuid::new_v4().to_string();
            (status, Json(ErrorResponse {
                error: ErrorDetail { code, message: msg, request_id },
            })).into_response()
        })?;

    let snap = state.probe.snapshot();
    let uptime = state.started_at.elapsed().as_secs();

    Ok(Json(json!({
        "printer": {
            "ip": state.config.printer_ip,
            "reachable": snap.reachable,
            "model": serde_json::Value::Null,
            "firmware": serde_json::Value::Null,
            "serial": serde_json::Value::Null,
            "flags": {
                "paper_out": false,
                "head_up": false,
                "jam": false,
                "low_paper": false,
            },
            "last_status_at": snap.last_status_at,
        },
        "queue": {
            "in_flight": 0,
            "pending": 0,
        },
        "agent": {
            "version": state.config.agent_version,
            "uptime_seconds": uptime,
        },
    })))
}

#[derive(Deserialize)]
pub struct PairRequest {
    #[allow(dead_code)]
    code: String,
    #[serde(default)]
    device_id: Option<String>,
    #[serde(default)]
    organizer_id: Option<String>,
    #[serde(default)]
    organizer_name: Option<String>,
    #[serde(default)]
    device_name: Option<String>,
}

pub async fn pair(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PairRequest>,
) -> Result<impl IntoResponse, Response> {
    let request_id = uuid::Uuid::new_v4().to_string();

    let token = extract_bearer(&headers).ok_or_else(|| {
        (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
            error: ErrorDetail {
                code: "unauthorized".to_string(),
                message: "Pairing requires the long-lived bearer in Authorization".to_string(),
                request_id: request_id.clone(),
            },
        })).into_response()
    })?;

    let meta = super::pairing::PairingMetadata {
        device_id: body.device_id,
        organizer_id: body.organizer_id,
        organizer_name: body.organizer_name,
        device_name: body.device_name,
        paired_at: None,
    };

    state.pairing.set_paired(token, meta).await.map_err(|e| {
        state.logger.error("pair.persist_failed", Some(json!({
            "request_id": &request_id,
            "error": e,
        })));
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
            error: ErrorDetail {
                code: "internal_error".to_string(),
                message: format!("Failed to persist pairing: {}", e),
                request_id: request_id.clone(),
            },
        })).into_response()
    })?;

    let meta = state.pairing.get_metadata();
    state.logger.info("pair.success", Some(json!({
        "request_id": &request_id,
        "device_id": &meta.device_id,
        "organizer_id": &meta.organizer_id,
        "token_fingerprint": state.pairing.token_fingerprint(),
    })));

    Ok(Json(json!({
        "device_id": meta.device_id,
        "organizer_id": meta.organizer_id,
        "organizer_name": meta.organizer_name,
        "token_fingerprint": state.pairing.token_fingerprint(),
    })))
}

#[derive(Deserialize)]
pub struct PrintJobRequest {
    job_id: String,
    reason: String,
    tickets: Vec<TicketRequest>,
    #[serde(default)]
    options: Option<PrintOptions>,
}

#[derive(Deserialize)]
struct TicketRequest {
    ticket_id: String,
    fields: fgl::TicketRenderData,
}

#[derive(Deserialize)]
struct PrintOptions {
    #[serde(default = "default_copies")]
    copies: usize,
    #[serde(default)]
    abort_on_first_error: bool,
}

fn default_copies() -> usize { 1 }

#[derive(Serialize)]
struct PrintJobResponse {
    job_id: String,
    started_at: String,
    finished_at: String,
    results: Vec<PerTicketResult>,
}

#[derive(Serialize)]
struct PerTicketResult {
    ticket_id: String,
    result: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    printed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    printer_serial: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_text: Option<String>,
}

pub async fn print(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PrintJobRequest>,
) -> Result<impl IntoResponse, Response> {
    let request_id = uuid::Uuid::new_v4().to_string();

    verify_bearer(&headers, state.pairing.get_cached_token())
        .map_err(|(status, code, msg)| {
            (status, Json(ErrorResponse {
                error: ErrorDetail { code, message: msg, request_id: request_id.clone() },
            })).into_response()
        })?;

    let printer = state.printer.as_ref().ok_or_else(|| {
        (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse {
            error: ErrorDetail {
                code: "printer_unreachable".to_string(),
                message: "Printer not configured. Set PRINTER_IP and restart.".to_string(),
                request_id: request_id.clone(),
            },
        })).into_response()
    })?;

    let result = run_print_job(printer.clone(), &state.logger, &request_id, body).await;
    let status_code = match result.results.iter().all(|r| r.result == "ok") {
        true => StatusCode::OK,
        false if result.results.iter().any(|r| r.result == "ok") => StatusCode::MULTI_STATUS,
        false => StatusCode::BAD_GATEWAY,
    };

    Ok((status_code, Json(result)))
}

pub async fn test_print(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    let request_id = uuid::Uuid::new_v4().to_string();

    verify_bearer(&headers, state.pairing.get_cached_token())
        .map_err(|(status, code, msg)| {
            (status, Json(ErrorResponse {
                error: ErrorDetail { code, message: msg, request_id: request_id.clone() },
            })).into_response()
        })?;

    let printer = state.printer.as_ref().ok_or_else(|| {
        (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse {
            error: ErrorDetail {
                code: "printer_unreachable".to_string(),
                message: "Printer not configured. Set PRINTER_IP and restart.".to_string(),
                request_id: request_id.clone(),
            },
        })).into_response()
    })?;

    let fixture = include_str!("../../../fixtures/sample-job.json");
    let mut job: PrintJobRequest = serde_json::from_str(fixture).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
            error: ErrorDetail {
                code: "internal_error".to_string(),
                message: format!("Test fixture invalid: {}", e),
                request_id: request_id.clone(),
            },
        })).into_response()
    })?;

    job.job_id = format!("test_{}", chrono::Utc::now().timestamp());
    job.reason = "test".to_string();

    let result = run_print_job(printer.clone(), &state.logger, &request_id, job).await;
    let status_code = match result.results.iter().all(|r| r.result == "ok") {
        true => StatusCode::OK,
        false if result.results.iter().any(|r| r.result == "ok") => StatusCode::MULTI_STATUS,
        false => StatusCode::BAD_GATEWAY,
    };

    Ok((status_code, Json(result)))
}

#[derive(Serialize)]
struct SettingsResponse {
    printer_ip: String,
}

pub async fn get_settings(State(state): State<AppState>) -> impl IntoResponse {
    Json(SettingsResponse {
        printer_ip: state.config.printer_ip.clone().unwrap_or_default(),
    })
}

#[derive(Deserialize)]
pub struct SettingsRequest {
    pub printer_ip: String,
}

pub async fn post_settings(
    State(state): State<AppState>,
    Json(body): Json<SettingsRequest>,
) -> Result<impl IntoResponse, Response> {
    let env_path = std::env::current_dir()
        .unwrap_or_default()
        .join(".env");

    let content = tokio::fs::read_to_string(&env_path)
        .await
        .unwrap_or_default();

    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let mut found = false;

    for line in lines.iter_mut() {
        if line.starts_with("PRINTER_IP=") {
            *line = format!("PRINTER_IP={}", body.printer_ip);
            found = true;
        }
    }

    if !found {
        lines.push(format!("PRINTER_IP={}", body.printer_ip));
    }

    while matches!(lines.last(), Some(l) if l.trim().is_empty()) {
        lines.pop();
    }

    tokio::fs::write(&env_path, lines.join("\n") + "\n")
        .await
        .map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: ErrorDetail {
                    code: "internal_error".to_string(),
                    message: format!("Failed to save settings: {}", e),
                    request_id: uuid::Uuid::new_v4().to_string(),
                },
            })).into_response()
        })?;

    state.logger.info("settings_saved", Some(json!({
        "printer_ip": body.printer_ip,
        "env_path": env_path.display().to_string(),
    })));

    Ok(Json(json!({"success": true})))
}

async fn run_print_job(
    printer: Arc<super::printer::PrinterClient>,
    logger: &super::logger::Logger,
    request_id: &str,
    job: PrintJobRequest,
) -> PrintJobResponse {
    let started_at = chrono::Utc::now().to_rfc3339();
    let copies = job.options.as_ref().map(|o| o.copies).unwrap_or(1);
    let abort_on_first_error = job.options.as_ref().map(|o| o.abort_on_first_error).unwrap_or(false);

    logger.info("print_job.start", Some(json!({
        "request_id": request_id,
        "job_id": &job.job_id,
        "reason": &job.reason,
        "ticket_count": job.tickets.len(),
        "copies": copies,
    })));

    let mut results = Vec::new();
    let mut stop_remaining = false;

    for ticket in &job.tickets {
        if stop_remaining {
            results.push(PerTicketResult {
                ticket_id: ticket.ticket_id.clone(),
                result: "error".to_string(),
                printed_at: None,
                printer_serial: None,
                error_code: Some("aborted".to_string()),
                error_text: Some("Batch aborted due to earlier failure".to_string()),
            });
            continue;
        }

        let fgl = match fgl::render_ticket(&ticket.fields) {
            Ok(fgl) => fgl,
            Err(e) => {
                results.push(PerTicketResult {
                    ticket_id: ticket.ticket_id.clone(),
                    result: "error".to_string(),
                    printed_at: None,
                    printer_serial: None,
                    error_code: Some("render_error".to_string()),
                    error_text: Some(e),
                });
                if abort_on_first_error {
                    stop_remaining = true;
                }
                continue;
            }
        };

        logger.info("print_ticket.fgl", Some(json!({
            "request_id": request_id,
            "ticket_id": &ticket.ticket_id,
            "fgl_length": fgl.len(),
            "fgl_full": &fgl,
        })));

        let mut last_result: Option<PerTicketResult> = None;
        for copy in 0..copies {
            let print_result = printer.print_raw(&fgl).await;
            if print_result.ok {
                last_result = Some(PerTicketResult {
                    ticket_id: ticket.ticket_id.clone(),
                    result: "ok".to_string(),
                    printed_at: Some(chrono::Utc::now().to_rfc3339()),
                    printer_serial: print_result.printer_serial,
                    error_code: None,
                    error_text: None,
                });
            } else {
                last_result = Some(PerTicketResult {
                    ticket_id: ticket.ticket_id.clone(),
                    result: "error".to_string(),
                    printed_at: None,
                    printer_serial: None,
                    error_code: print_result.error_code.clone(),
                    error_text: print_result.error_text,
                });
                if abort_on_first_error || matches!(
                    print_result.error_code.as_deref(),
                    Some("printer_unreachable") | Some("printer_timeout")
                ) {
                    stop_remaining = true;
                }
                break;
            }
            if copy < copies - 1 {
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            }
        }

        if let Some(result) = last_result {
            results.push(result);
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }

    let finished_at = chrono::Utc::now().to_rfc3339();
    let ok_count = results.iter().filter(|r| r.result == "ok").count();
    let err_count = results.iter().filter(|r| r.result == "error").count();

    logger.info("print_job.done", Some(json!({
        "request_id": request_id,
        "job_id": &job.job_id,
        "ok_count": ok_count,
        "err_count": err_count,
    })));

    PrintJobResponse {
        job_id: job.job_id,
        started_at,
        finished_at,
        results,
    }
}
