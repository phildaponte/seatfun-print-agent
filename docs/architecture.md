---
Last updated: 2026-05-20
Last change: Made loopback-only / per-device constraint explicit (Option A); affirmed Windows/macOS parity for v1
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

- `http.ts` — boot a Node `http.Server` bound to `127.0.0.1` only (never `0.0.0.0` — the agent must not be reachable from the LAN, only from the same machine).
- `routes/` — one file per endpoint (`health.ts`, `print.ts`, `pair.ts`, `status.ts`). See `protocol.md` for the contract.
- `middleware/auth.ts` — checks `Authorization: Bearer <token>` against the keychain-stored token. Constant-time compare. Strips the header from logs.
- `middleware/logging.ts` — structured JSON logs, request id, redacts secrets.

### `src/fgl/` (will graduate to `@seatfun/fgl`)

- `template.ts` — the canonical 2" × 5.5" Lemur tear-stock layout. Pure function: `renderTicket(data) → string` of FGL.
- `commands.ts` — typed builders for FGL primitives (`<RC#,#>`, `<F#>`, `<QR#>`, `<LOGO#>`, `<p>` for print, `<CAN>` for cancel).
- `logo.ts` — converts `logo-black.png` → 1-bit BMP at build time. At runtime, the agent uploads it to printer flash on first connect via the FGL store-logo command and caches a "logo present" flag.
- `__golden__/` — golden test fixtures. Each input JSON has a paired `.fgl` file; CI fails if the renderer drifts.

The renderer is **pure**. Same input → same bytes. No clocks, no randomness, no I/O. This is what makes golden tests possible and what lets the dashboard preview tickets identically to how the printer renders them.

### `src/printer/`

- `client.ts` — `class PrinterClient { connect(), printRaw(buf), getStatus(), close() }`. Wraps a `net.Socket` to `<ip>:9100`. Connect timeout 5s, write timeout 30s, retries on `ECONNRESET` once.
- `status.ts` — parses BOCA status responses (paper out, head up, etc.) into a typed `PrinterStatus` object.
- `discovery.ts` (v2) — mDNS scan for BOCA printers on the LAN.

The printer client is **the only place** in the codebase that opens an outbound socket. Easy to audit, easy to mock in tests.

### `src/pairing/`

- `flow.ts` — drives the pairing handshake described in the protocol doc.
- `keychain.ts` — platform-aware token storage. Mac: `keytar`/Keychain Services. Windows: `keytar`/Credential Manager. Linux (dev only): plain file in `~/.config/seatfun-print-agent/` chmod 600.
- `health.ts` — periodic `POST` to the dashboard's heartbeat endpoint to update `box_office_device.last_seen_at` and detect revocation. Default interval 60s; if the dashboard returns `401 device_revoked` the agent shows a red banner and refuses to print.

### `src/queue/`

- `queue.ts` — in-memory FIFO with `max_in_flight = 1`. Bulk jobs (e.g., 100-ticket pre-print) are submitted as a single request with a `tickets[]` array; the queue processes the array sequentially with a 50ms gap between tickets to avoid printer buffer overflow.
- v2: persistent SQLite-backed queue for offline mode.

### `src/index.ts`

- Loads config, starts HTTP server, starts heartbeat, registers SIGINT/SIGTERM handlers for graceful shutdown (drain the queue, close sockets, exit 0).

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
