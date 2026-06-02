---
Last updated: 2026-05-22
Last change: Documented v1-lite implementation — CORS middleware, printer probe, pairing/keychain, heartbeat scaffold, shared runPrintJob; macOS `security` CLI replaces keytar
Owner: @phildaponte
Status: draft
---

# Architecture — seatfun-print-agent

> Internal structure of the agent. How the HTTP server, FGL renderer, printer client, and pairing flow fit together.

For the **external** architecture (how the agent fits between the dashboard and the printer) see `seatfun-dashboard/docs/01-architecture/print-agent.md`. For the **wire protocol** with the dashboard see [`./protocol.md`](./protocol.md).

## Process model

The agent is a **single Node process** (v0) or a **Tauri main process + webview** (v1). No worker threads in v0 — print jobs are I/O bound (HTTP in, TCP out) and Node's event loop handles them fine.

```
┌──────────────────────────────────────────────────────────┐
│                    Agent process                         │
│                                                          │
│   HTTP server (127.0.0.1:9787)                           │
│        │                                                 │
│        ▼                                                 │
│   Auth middleware  ──── (token from OS keychain)         │
│        │                                                 │
│        ▼                                                 │
│   Route handler  /v1/print                               │
│        │                                                 │
│        ▼                                                 │
│   Job queue (in-memory, FIFO, max 1 in-flight)           │
│        │                                                 │
│        ▼                                                 │
│   FGL renderer  ◀──── @seatfun/fgl shared package        │
│        │                                                 │
│        ▼                                                 │
│   Printer client (TCP :9100, 5s connect, 30s write)      │
│        │                                                 │
│        ▼                                                 │
│   Per-ticket result → response                           │
│                                                          │
│   Sidecar: heartbeat → /v1/health, log rotation          │
└──────────────────────────────────────────────────────────┘
```

## Modules

### `src/server/`

- `http.ts` — boots a Node `http.Server` bound to `127.0.0.1` only (never `0.0.0.0` — the agent must not be reachable from the LAN, only from the same machine). Holds the single route map (`ROUTES`) with per-route `auth` flags and dispatches via `switch`.
- `routes/` — one file per endpoint (`health.ts`, `pair.ts`, `status.ts`, `print.ts`, `test-print.ts`). See `protocol.md` for the contract.
- `jobs/runPrintJob.ts` — shared print-job runner used by both `/v1/print` and `/v1/test-print` so they share identical batch semantics (sequential render → TCP write → 50 ms gap → next).
- `middleware/auth.ts` — `verifyBearer(req, expectedToken)` does a constant-time compare against the token in pairing state. Returns `not_paired` when no token has been stored yet so the dashboard can branch on the CTA.
- `middleware/cors.ts` — origin allow-list + preflight handler. Echoes the exact `Origin` (never `*`, because `Authorization` is included) and emits `Vary: Origin`. Unknown origins get a response with no CORS headers, which is enough for the browser to block. See `protocol.md → CORS + cross-origin auth`.
- `middleware/logging.ts` — structured JSON logs, request id, redacts secrets. (Currently inlined in `http.ts`; will graduate to its own file when there's a second consumer.)

### `src/fgl/` (will graduate to `@seatfun/fgl`)

- `template.ts` — the canonical 2" × 5.5" Lemur tear-stock layout. Pure function: `renderTicket(data) → string` of FGL.
- `commands.ts` — typed builders for FGL primitives (`<RC#,#>`, `<F#>`, `<QR#>`, `<LOGO#>`, `<p>` for print, `<CAN>` for cancel).
- `logo.ts` — converts `logo-black.png` → 1-bit BMP at build time. At runtime, the agent uploads it to printer flash on first connect via the FGL store-logo command and caches a "logo present" flag.
- `__golden__/` — golden test fixtures. Each input JSON has a paired `.fgl` file; CI fails if the renderer drifts.

The renderer is **pure**. Same input → same bytes. No clocks, no randomness, no I/O. This is what makes golden tests possible and what lets the dashboard preview tickets identically to how the printer renders them.

### `src/printer/`

- `client.ts` — `class PrinterClient { printRaw(fgl), ping() }`. Wraps a `net.Socket` to `<ip>:9100`. Connect timeout 5s, write timeout 30s.
- `probe.ts` — `createPrinterProbe({ printer })` runs a 2s TCP-connect ping every 10s and caches `{ reachable, last_status_at, last_error }`. Both `/v1/health` and `/v1/status` read from this snapshot — dashboard polling (every 12s) never opens a new socket. Force-refresh available via `probe.refresh()` for future diagnostic UI.
- `status.ts` (v1.0) — parses BOCA status responses (paper out, head up, etc.) into a typed `PrinterStatus` object. Currently the probe answers reachability only.
- `discovery.ts` (v2) — mDNS scan for BOCA printers on the LAN.

The printer client is **the only place** in the codebase that opens an outbound socket. Easy to audit, easy to mock in tests.

### `src/pairing/`

- `state.ts` — `createPairingState({ envToken })` returns the in-memory holder for the bearer + metadata. `init()` reads token from the keychain (or env override) and metadata from the chmod-600 JSON sidecar file; `setPaired(token, meta)` persists both; `clear()` wipes both. The HTTP layer never touches the keychain directly — it goes through this state.
- `keychain.ts` — platform-aware **secret-only** storage. macOS: shells out to `/usr/bin/security` (`add-/find-/delete-generic-password`) under service `com.seatfun.print-agent`, account `bearer-token`. No native module dependency, no `keytar` (eliminates a fragile build step). Linux: chmod-600 JSON file under `$XDG_CONFIG_HOME/seatfun-print-agent/secret.json`. Windows: same file fallback under `%LOCALAPPDATA%\SeatfunPrintAgent\` — proper Credential Manager support is a v1.0 TODO.
- `heartbeat.ts` — periodic `POST` to the dashboard's heartbeat endpoint to update `box_office_device.last_seen_at` and detect revocation. Default interval 60s; if the dashboard returns `401 device_revoked` the agent will (TODO) clear pairing state and refuse to print. **v1-lite: disabled by default.** The dashboard polls `/v1/status` directly for the badge; outbound heartbeat is enabled only when `SEATFUN_HEARTBEAT_URL` is set.

### `src/queue/`

- `queue.ts` — in-memory FIFO with `max_in_flight = 1`. Bulk jobs (e.g., 100-ticket pre-print) are submitted as a single request with a `tickets[]` array; the queue processes the array sequentially with a 50ms gap between tickets to avoid printer buffer overflow.
- v2: persistent SQLite-backed queue for offline mode.

### `src/index.ts`

Boot order:
1. Load config (`config.ts`), create logger.
2. Construct `PrinterClient` if `PRINTER_IP` set.
3. `createPairingState({ envToken })` + `pairing.init()` to populate the in-memory token cache from the keychain (or env override).
4. `createPrinterProbe({ printer })` + `probe.start()` to begin background reachability polling.
5. Conditionally `createHeartbeat(...)` + `heartbeat.start()` if `SEATFUN_HEARTBEAT_URL` is set.
6. `createServer({ config, logger, printer, probe, pairing, cors, startedAt })` and `server.listen(host, port)`.
7. Register SIGINT/SIGTERM → `probe.stop()`, `heartbeat?.stop()`, `server.close()`, hard-exit after 5s.

## State

The agent is **mostly stateless**. The only persistent state is:

| State | Where | Why |
|---|---|---|
| Bearer token | OS keychain | Required for every dashboard request. |
| Printer IP | Settings file (app-data dir) | Avoid asking on every launch. |
| Logo-uploaded flag | Settings file | Skip re-uploading on every print. |
| Logs | App-data dir | Support / debugging. |

No job history, no ticket data, no buyer info is ever persisted. After a print job completes, the data is gone from the agent. The dashboard owns the audit trail via `ticket_print_event`.

## Threading + concurrency

- One HTTP request can be in flight per `print` call, but multiple `health`/`status` calls can run concurrently.
- The job queue serializes printer access — only one job writes to the printer socket at a time.
- The heartbeat runs on its own `setInterval` and never blocks the queue.

## Error handling

Errors propagate up through three layers, each with a clear contract:

1. **Network / socket layer.** `ECONNREFUSED`, `ETIMEDOUT`, `EHOSTUNREACH` → mapped to `printer_unreachable`.
2. **Protocol layer.** Printer reports paper out, head up, etc. → `printer_status_<flag>`.
3. **HTTP layer.** Returned to the dashboard as a structured JSON error per the protocol.

Per-ticket errors in a batch never abort the whole batch unless they're a paper-out / head-up class error (because the next ticket would also fail). See `protocol.md → batch semantics`.

## Tests

- **Unit:** FGL renderer (golden), command builders, status parser. No I/O.
- **Integration:** spin up a fake BOCA TCP server on `localhost:9100` that captures bytes and replies with canned status; assert the agent sends the right FGL.
- **Smoke (manual):** `pnpm smoke` runs against a real Lemur-S using `PRINTER_IP` from `.env`. Prints one fixture ticket. Used for hardware verification only.

## Observability

- **Logs:** structured JSON, one event per request + per print attempt. Fields: `req_id`, `route`, `latency_ms`, `printer_ip`, `result`, `error_code`.
- **Metrics (v2):** Prometheus-compatible `/v1/metrics` endpoint (auth-gated), exposes counters for prints, errors, queue depth, printer status.
- **Crash reporting (v1):** Sentry, scrubbed of PII / tokens.

## Security posture

- HTTP server binds to `127.0.0.1` **only** ("Option A" architecture). `getaddrinfo("localhost")` is not enough — bind explicitly to `127.0.0.1` to avoid IPv6 surprises. **Consequence:** only the device running the agent can submit print jobs. A phone on the same Wi-Fi cannot reach it. This is intentional — a LAN-bound agent would let any device on the venue Wi-Fi submit prints. Multi-device printing is deferred to v1.1 ("LAN mode" — see [dashboard `01-architecture/print-agent.md → Phasing`](https://github.com/phildaponte/seatfun-dashboard/blob/main/docs/01-architecture/print-agent.md)).
- All endpoints except `/v1/health` require the bearer token.
- Token never logged. Token never written to disk in plaintext (keychain only).
- The QR payload received from the dashboard is treated as opaque bytes — the agent does not parse, validate, or re-sign it.
- The agent never makes outbound HTTPS calls except to the dashboard's heartbeat endpoint and the auto-update channel. Both URLs are baked in at build time.

## Related

- [`./protocol.md`](./protocol.md) — wire contract.
- [`./distribution.md`](./distribution.md) — build / sign / release.
- `seatfun-dashboard/docs/01-architecture/print-agent.md` — system-level architecture.
