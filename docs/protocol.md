---
Last updated: 2026-06-03
Last change: Removed HTML static file routes (now served via Tauri asset protocol)
Owner: @phildaponte
Status: draft
---

# Protocol — seatfun-print-agent ↔ dashboard

> The HTTP wire contract between the Seatfun dashboard (browser) and the local Print Agent (`http://127.0.0.1:9787`). **This is a frozen contract.** Breaking changes require a `MAJOR` version bump and a coordinated dashboard + agent release.

Last protocol version: **v1** (draft). Status: pre-freeze — fields may still change until v1.0.0 ships.

## v1-lite implementation status (agent v0.1.0)

| Endpoint | Implemented | Notes |
|---|---|---|
| `GET /v1/health` | ✅ | Reads from background probe; no live TCP probe per request. |
| `POST /v1/pair` | ✅ | Trusts pasted token (TODO: callback verification). |
| `GET /v1/status` | ✅ | `reachable` only; flags/model/firmware/serial still `null` / `false`. |
| `POST /v1/print` | ✅ | Unchanged from v0. |
| `POST /v1/test-print` | ✅ | Prints `fixtures/sample-job.json` through `runPrintJob`. |
| `GET /v1/settings` | ✅ | Returns current `printer_ip` from config. No auth required. |
| `POST /v1/settings` | ✅ | Saves `printer_ip` to `.env` file. No auth required. |
| `POST /v1/cancel` | ❌ | Deferred until a queue exists. |
| `POST /v1/printer/configure` | ❌ | Deferred; set via `PRINTER_IP` env for now. |
| `POST /v1/heartbeat` (outbound) | 🚧 | Scaffolded but disabled by default — dashboard polls `/v1/status` instead. |

---

## Conventions

- Base URL: `http://127.0.0.1:9787` (configurable via `SEATFUN_AGENT_PORT`, default `9787`).
- All paths are prefixed with the protocol version: `/v1/...`. A future `/v2/...` may run alongside `/v1/...` for one release cycle.
- All requests/responses are `application/json; charset=utf-8`.
- All endpoints except `/v1/health` and `/v1/pair` require `Authorization: Bearer <token>` where `<token>` is the bearer issued at pairing. (`/v1/pair` accepts the bearer in the header but is not gated against a stored token — that's what pairing establishes.)
- All timestamps are ISO 8601 in UTC (`2026-05-20T22:30:00.000Z`).
- All ids are Bubble-style strings unless noted.
- Errors follow [§ Error envelope](#error-envelope).

## CORS + cross-origin auth (v1-lite)

The dashboard runs on `https://app.seatfun.com`; the agent runs on `http://127.0.0.1:9787`. Modern browsers (Chrome, Edge, Safari, Firefox) **explicitly allow** `https://` → `http://127.0.0.1` calls because loopback is a "potentially trustworthy origin" — mixed-content does **not** block these requests. The only thing the agent has to do is serve CORS headers.

**Agent CORS policy:**

- Reads `SEATFUN_ALLOWED_ORIGINS` (CSV) at boot. Default: `https://app.seatfun.com,http://localhost:3000`.
- For every request:
  - Always emits `Vary: Origin`.
  - If the request's `Origin` is in the allow-list, emits:
    - `Access-Control-Allow-Origin: <origin>` (never `*`, because requests carry `Authorization`)
    - `Access-Control-Allow-Headers: Authorization, Content-Type`
    - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
    - `Access-Control-Max-Age: 600`
  - Unknown origins still get a 200/4xx response (so curl + non-browser clients work) but **no** CORS headers, so the browser blocks the response.
- `OPTIONS` preflights short-circuit before auth runs and return `204 No Content`.

**Bearer in the browser:**

The dashboard fetches the device's bearer from its own Vercel API (`GET /api/box-office/agent-token`, session-gated) on box-office page load, holds it in React state (memory only — never `localStorage` / `sessionStorage`), and includes it on every agent call. The token is never persisted in the browser. Rationale: agent + dashboard are mutually trusted via the pairing handshake, but the browser session is the weakest link — keeping the token in memory limits exposure to the page lifetime.

## Tray window UI files

The agent's tray windows (`status.html` and `settings.html`) are **not served via the HTTP server**. They are loaded directly by Tauri using `WebviewUrl::App`, which serves files from the bundled resources via Tauri's native asset protocol. This eliminates path resolution issues and file system access from Node.js in production bundles.

The HTTP server only provides the `/v1/*` API endpoints documented below. The HTML files are bundled in `tauri.conf.json` resources and served by Tauri's webview loader.

## Endpoints

### `GET /v1/health`

Liveness probe. **No auth.** Used by the dashboard to render the printer status indicator.

```http
GET /v1/health HTTP/1.1
```

Response:

```json
{
  "ok": true,
  "agent_version": "1.0.0",
  "protocol_version": "1",
  "paired": true,
  "device": {
    "device_id": "1780424276018x118554821977516770",
    "organizer_id": "1777314474806x996724195664427900",
    "device_name": "Front gate Mac"
  },
  "printer": {
    "configured": true,
    "ip": "192.168.1.47",
    "reachable": true,
    "last_status_at": "2026-05-20T22:30:00.000Z",
    "serial": "354846",
    "model": "Lemur-S",
    "firmware": "B46"
  }
}
```

If `paired = false`, the dashboard renders the "Pair this device" CTA. If `printer.configured = false`, it renders "Set printer IP". If `printer.reachable = false`, it renders the printer-troubleshooting hint.

**`device` block (non-secret).** Returned so the dashboard can fetch the bearer matching *this* machine's agent. Because printing is loopback (browser → `127.0.0.1` → the agent on the same computer), an organizer with multiple paired stations needs the dashboard to use the token of the agent running here — not "the latest device in the org". The dashboard reads `device.device_id` from this response, then calls `GET /api/box-office/agent-token?organizer_id=…&device_id=…` to get the matching token. The **token itself is never exposed** on `/v1/health` — only the public identifiers. Fields are `null` when `paired = false`.

### `POST /v1/pair`

Completes the pairing handshake. Called once when a device is being added. The browser POSTs with the long-lived bearer already set in `Authorization` — Vercel/Bubble has just minted it for the dashboard user.

```http
POST /v1/pair HTTP/1.1
Authorization: Bearer <long-lived-bearer>
Content-Type: application/json
```

Request body:

```json
{
  "code": "428193",
  "device_name": "Front gate Mac",
  "agent_version": "0.1.0",
  "platform": "darwin-arm64",

  "device_id": "1716333000000x123",
  "organizer_id": "1701000000000x456",
  "organizer_name": "Sample Venue Co."
}
```

- `code` — required. The one-time pairing code the user pasted. **v1-lite:** the agent does not verify it. **v1.0 TODO:** the agent will call back to `POST {dashboard}/api/box-office/agent-verify` with `{code, token}` and refuse to store if the response is not 200.
- `device_id` / `organizer_id` / `organizer_name` — v1-lite extension: passed in here so the agent can return them on `/v1/health` and `/v1/status`. Will be removed once the verify callback exists (the agent will read them from the verify response instead).

Response (200):

```json
{
  "device_id": "1716333000000x123",
  "organizer_id": "1701000000000x456",
  "organizer_name": "Sample Venue Co.",
  "token_fingerprint": "sha256:abc123…"
}
```

The agent stores the bearer token via the platform secret backend (**macOS Keychain** via the `security` CLI; **Linux / Windows** fall back to a chmod-600 JSON file under the app-data dir — Windows Credential Manager support is a TODO). The token itself is never returned and never logged.

Errors:

- `401 unauthorized` — no bearer in `Authorization`.
- `400 invalid_request` — body missing `code`.
- `500 internal_error` — keychain write failed.

Once paired, every subsequent protected call uses the same bearer in `Authorization`.

### `POST /v1/print` 🔒

The main endpoint. Prints one or more tickets. Synchronous: returns when the printer has acknowledged the last ticket (or failed).

```json
{
  "job_id": "job_2026-05-20T22:30:00Z_42",
  "reason": "reprint",
  "tickets": [
    {
      "ticket_id": "1716000000000x789",
      "fields": {
        "event_name": "Summer Fest 2026",
        "venue_name": "Sample Venue",
        "city": "Montréal",
        "state": "QC",
        "event_date_long": "Saturday, July 18, 2026",
        "event_time": "8:00 PM",
        "section": "GA",
        "row": "B",
        "seat": "13",
        "admission_type": "General Admission",
        "price": "40.00",
        "event_code": "SF-SUMFEST-26",
        "order_id": "SF-10428",
        "qr_payload": "<opaque signed string from Bubble>",
        "print_timestamp": "2026-05-20T22:30:00.000Z"
      }
    }
  ],
  "options": {
    "copies": 1,
    "abort_on_first_error": false
  }
}
```

Field rules:

- `job_id` — opaque, generated by the dashboard. Echoed in the response. Used by the dashboard to correlate with `box_office_print_confirm` later.
- `reason` — one of `bulk` | `walkup` | `reprint` | `reissue`. The agent does not enforce business rules on this; it's logged for audit.
- `tickets[]` — 1 to 200 entries per request. Larger jobs split client-side.
- `tickets[].fields.qr_payload` — **opaque**. The agent does not parse, validate, or re-sign. Burns it directly into the QR.
- `options.copies` — duplicate every ticket N times (e.g. for tear-and-keep stub layouts in a future stock revision). Default 1.
- `options.abort_on_first_error` — if true, stop the batch on the first per-ticket failure. Default false.

Response (200, all succeeded):

```json
{
  "job_id": "job_2026-05-20T22:30:00Z_42",
  "started_at": "2026-05-20T22:30:01.123Z",
  "finished_at": "2026-05-20T22:30:09.456Z",
  "results": [
    {
      "ticket_id": "1716000000000x789",
      "result": "ok",
      "printed_at": "2026-05-20T22:30:08.700Z",
      "printer_serial": "354846"
    }
  ]
}
```

Response (207, partial success):

```json
{
  "job_id": "job_2026-05-20T22:30:00Z_42",
  "started_at": "...",
  "finished_at": "...",
  "results": [
    { "ticket_id": "...", "result": "ok",    "printed_at": "..." },
    { "ticket_id": "...", "result": "error", "error_code": "printer_paper_out", "error_text": "Out of stock — refill and retry." }
  ]
}
```

Per-ticket `error_code` values:

| Code | Meaning |
|---|---|
| `printer_unreachable` | TCP connect to printer failed. |
| `printer_paper_out` | BOCA reports stock empty. |
| `printer_head_up` | Print head lifted. |
| `printer_jam` | Mechanical jam. |
| `printer_unknown` | Unmapped FGL status. |
| `render_error` | FGL renderer rejected the input fields. |
| `aborted` | Batch was aborted by an earlier failure (when `abort_on_first_error = true`). |

### `POST /v1/cancel` 🔒

Cancels an in-flight job by `job_id`. Best-effort — already-printed tickets are not un-printed.

```json
{ "job_id": "job_2026-05-20T22:30:00Z_42" }
```

Response:

```json
{ "cancelled": true, "tickets_already_printed": 12 }
```

### `GET /v1/status` 🔒

Detailed printer status. Used by the "Test print" button + diagnostics screen.

Response:

```json
{
  "printer": {
    "ip": "192.168.1.47",
    "reachable": true,
    "model": "Lemur-S",
    "firmware": "B46",
    "serial": "354846",
    "flags": {
      "paper_out": false,
      "head_up": false,
      "jam": false,
      "low_paper": false
    },
    "last_status_at": "2026-05-20T22:30:00.000Z"
  },
  "queue": {
    "in_flight": 0,
    "pending": 0
  },
  "agent": {
    "version": "1.0.0",
    "uptime_seconds": 3812
  }
}
```

### `POST /v1/test-print` 🔒

Prints a small built-in diagnostic ticket through the same job runner as `/v1/print`. Used by the dashboard's "Test print" button on the box-office settings page.

```http
POST /v1/test-print HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json

{}
```

No request body required. The agent renders the bundled `fixtures/sample-job.json` and stamps a fresh `job_id` of the form `test_<unix-ms>`.

Response: identical shape to `/v1/print` (single result in `results[]`).

, if so how can I test? Can you ran these command for me and install the app on### `GET /v1/settings`

Returns the current printer configuration. **No auth required.** Used by the local settings UI to display the configured printer IP.

```http
GET /v1/settings HTTP/1.1
```

Response:

```json
{
  "printer_ip": "192.168.1.47"
}
```

- `printer_ip` — The currently configured printer IP address, or empty string if not configured.

**Browser URL (test):**
```
http://127.0.0.1:9787/v1/settings
```

**cURL:**
```bash
curl http://127.0.0.1:9787/v1/settings
```

**Frontend callers:** `src-tauri/settings.html`

### `POST /v1/settings`

Updates the printer configuration and persists it to the `.env` file. **No auth required.** Used by the local settings UI to save the printer IP. Changes take effect after agent restart.

```http
POST /v1/settings HTTP/1.1
Content-Type: application/json

{
  "printer_ip": "192.168.1.47"
}
```

- `printer_ip` — required. The printer IP address to save. Pass empty string to clear the configuration.

Response (200):

```json
{
  "success": true
}
```

Errors:

- `400 invalid_request` — body missing `printer_ip` field or malformed JSON.
- `500 internal_error` — failed to write to `.env` file.

**cURL:**
```bash
curl -X POST http://127.0.0.1:9787/v1/settings \
  -H "Content-Type: application/json" \
  -d '{"printer_ip": "192.168.1.47"}'
```

**Frontend callers:** `src-tauri/settings.html`

### `POST /v1/printer/configure` 🔒

Sets the printer IP at runtime (instead of via settings file).

```json
{ "ip": "192.168.1.47" }
```

### `POST /v1/heartbeat` 🔒

Driven by the agent toward the **dashboard** (Vercel route), not by the dashboard. Documented here for completeness because it's part of the same protocol surface. Updates `box_office_device.last_seen_at`.

```http
POST https://<vercel>/api/box-office/agent-heartbeat
Authorization: Bearer <token>
```

```json
{
  "agent_version": "1.0.0",
  "printer": { "serial": "354846", "reachable": true }
}
```

If the response is `401 device_revoked`, the agent enters a "revoked" state and refuses all `/v1/print` calls until re-paired.

## Error envelope

All non-2xx responses share this shape:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Bearer token missing or invalid.",
    "request_id": "req_abc123"
  }
}
```

Top-level `error.code` values:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `invalid_request` | Malformed JSON or missing required field. |
| 401 | `unauthorized` | Token missing/invalid. |
| 401 | `not_paired` | Agent has no stored token yet — dashboard should send the user through pairing. |
| 401 | `device_revoked` | Token recognized but the device row is revoked. |
| 404 | `not_found` | Unknown route. |
| 409 | `printer_busy` | Another job is in flight (only when queue is full). |
| 422 | `validation_error` | Fields failed renderer validation. |
| 500 | `internal_error` | Bug in the agent. Contains `request_id` for log correlation. |
| 503 | `printer_unreachable` | Printer not configured or TCP connect failed. |

The dashboard uses `error.code` (not `error.message`) for branching logic. Messages are human-facing and may change.

## Batch semantics

- Tickets are printed **sequentially** in array order.
- A per-ticket failure does **not** abort the batch unless:
  - `options.abort_on_first_error = true`, or
  - The error is in the "paper / head / jam" family (the next ticket would fail anyway).
- The response always has one `results[]` entry per requested ticket, in the same order.
- HTTP status: `200` when all `ok`, `207` when at least one `error` and at least one `ok`, `5xx` when nothing printed (e.g., printer unreachable from the start).

## Idempotency

`/v1/print` is **not idempotent.** Retrying a request after a network failure may double-print. The dashboard prevents this by:

- Generating `job_id` deterministically from `(reason, ticket_ids[], qr_revisions[], device_id, click_timestamp_ms)` so a manual retry from the same click reuses the id.
- Calling `box_office_print_confirm` only **after** receiving the agent response. If the response is lost, the dashboard surfaces a "Did this print?" UI and lets the user decide whether to retry or mark as printed.

A future v2 may make this endpoint idempotent by having the agent track recent `job_id`s in memory.

## Versioning

- A request to `/v1/...` from a v2 dashboard is rejected with `400 invalid_request` so the dashboard knows to fall back / prompt update.
- The agent's `agent_version` and `protocol_version` are returned on every `/v1/health` so the dashboard can warn about staleness.

## Reserved for future use

The following are **intentionally not in v1** and any client sending them will be ignored, not rejected, so they can be added without bumping the major:

- `tickets[].metadata.organizer_logo` — per-organizer logo override.
- `options.cut_after` — auto-cut behavior (Lemur-S is tear-only; reserved for cutter models).
- `options.color_mode` — reserved for future printers.

## Related

- [`./architecture.md`](./architecture.md) — agent internals.
- [`./distribution.md`](./distribution.md) — protocol vs binary versioning.
- `seatfun-dashboard/docs/05-features/box-office-printing.md` — feature plan.
- `seatfun-dashboard/docs/01-architecture/print-agent.md` — system architecture.
