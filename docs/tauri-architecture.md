---
Last updated: 2026-06-03
Last change: Created comprehensive Tauri architecture documentation after Rust migration
Owner: @phildaponte
Status: current
---

# Tauri Application Architecture

**Source of truth** for how the Seatfun Print Agent Tauri application works.

## Overview

The Seatfun Print Agent is a **pure Rust desktop application** built with Tauri 2.x. It runs a local HTTP server that receives print jobs from the Seatfun dashboard and sends them to a thermal printer via TCP.

**Key principle**: Zero external runtime dependencies. Users download a single `.dmg` (macOS) or `.exe` (Windows) and run it. No Node.js, Python, or other runtimes required.

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│  Tauri Frontend (HTML/JS in frontend/)         │
│  - status.html: Shows agent/printer status     │
│  - settings.html: Configure printer IP         │
└─────────────────────────────────────────────────┘
                      ↕
┌─────────────────────────────────────────────────┐
│  Tauri Rust Backend (src-tauri/src/)           │
│  - lib.rs: App initialization, system tray     │
│  - main.rs: Entry point                        │
└─────────────────────────────────────────────────┘
                      ↕
┌─────────────────────────────────────────────────┐
│  HTTP Server (src-tauri/src/server/)           │
│  - Axum web framework on 127.0.0.1:9787        │
│  - 7 REST endpoints for dashboard integration  │
└─────────────────────────────────────────────────┘
                      ↕
┌─────────────────────────────────────────────────┐
│  Thermal Printer (TCP port 9100)               │
│  - Receives FGL (Firmware Graphics Language)   │
└─────────────────────────────────────────────────┘
```

## Application Lifecycle

### 1. App Launch

**File**: `src-tauri/src/lib.rs::run()`

1. **Tauri initialization**
   - Sets up logging (debug mode only)
   - Enables auto-start on login (macOS LaunchAgent)
   - Creates system tray with menu items

2. **HTTP server initialization** (async)
   - Loads config from environment variables (`Config::from_env()`)
   - Creates logger with structured JSON output
   - Initializes printer client (if `PRINTER_IP` is set)
   - Starts background printer probe (pings every 10s)
   - Loads pairing state from macOS Keychain
   - Spawns HTTP server on `tokio` runtime

3. **System tray setup**
   - Menu items: "Show Status", "Show Settings", "Quit"
   - Clicking items opens respective HTML windows
   - Windows hide on close (don't quit app)

### 2. HTTP Server Startup

**File**: `src-tauri/src/server/mod.rs::start_server()`

- Binds to `127.0.0.1:9787` (configurable via `SEATFUN_AGENT_PORT`)
- Logs startup info (version, port, paired status)
- Registers 7 routes with Axum router
- Applies CORS middleware (allows all origins)

### 3. Request Handling

**File**: `src-tauri/src/server/routes.rs`

All requests follow this flow:
1. CORS preflight handling (if OPTIONS request)
2. Route matching
3. Authentication check (if required)
4. Business logic execution
5. JSON response with structured error handling

## HTTP API Endpoints

### Public Endpoints (No Auth)

#### `GET /v1/health`
- **Purpose**: Health check for monitoring
- **Returns**: Agent version, pairing status, printer reachability
- **Used by**: Dashboard polling, uptime monitors

#### `POST /v1/pair`
- **Purpose**: Pair agent with organizer account
- **Auth**: Bearer token in `Authorization` header (long-lived token from dashboard)
- **Body**: `{ code, device_id?, organizer_id?, organizer_name?, device_name? }`
- **Action**: Stores token in macOS Keychain, saves metadata to `~/Library/Application Support/SeatfunPrintAgent/pairing.json`

#### `GET /v1/settings`
- **Purpose**: Get current printer IP
- **Returns**: `{ printer_ip: string }`

#### `POST /v1/settings`
- **Purpose**: Update printer IP
- **Body**: `{ printer_ip: string }`
- **Action**: Writes to `.env` file in project root

### Authenticated Endpoints (Require Bearer Token)

#### `GET /v1/status`
- **Purpose**: Detailed agent/printer status
- **Returns**: Printer flags, queue info, uptime

#### `POST /v1/print`
- **Purpose**: Print tickets
- **Body**: `{ job_id, reason, tickets[], options? }`
- **Action**: 
  1. Renders each ticket to FGL commands
  2. Sends FGL to printer via TCP
  3. Returns per-ticket results

#### `POST /v1/test-print`
- **Purpose**: Test print using fixture data
- **Action**: Loads `fixtures/sample-job.json` and prints it

## Core Modules

### `src-tauri/src/server/config.rs`
**Environment-based configuration**

```rust
pub struct Config {
    pub host: String,              // Default: 127.0.0.1
    pub port: u16,                 // Default: 9787
    pub env_token: Option<String>, // SEATFUN_AGENT_TOKEN (dev override)
    pub printer_ip: Option<String>,// PRINTER_IP
    pub printer_port: u16,         // Default: 9100
    pub log_level: String,         // Default: info
    // ... more fields
}
```

**Environment variables**:
- `SEATFUN_AGENT_HOST` - HTTP server bind address
- `SEATFUN_AGENT_PORT` - HTTP server port
- `SEATFUN_AGENT_TOKEN` - Dev token override (bypasses keychain)
- `PRINTER_IP` - Thermal printer IP address
- `PRINTER_PORT` - Thermal printer port
- `LOG_LEVEL` - debug | info | warn | error

### `src-tauri/src/server/logger.rs`
**Structured JSON logging**

- Logs to stdout (info/debug) and stderr (warn/error)
- Auto-redacts sensitive fields: `authorization`, `token`, `bearer`, `qr_payload`
- Format: `{ ts, level, msg, ...data }`

### `src-tauri/src/server/printer.rs`
**TCP printer communication**

#### `PrinterClient`
- Connects to printer via TCP socket
- `print_raw(fgl: &str)` - Sends FGL commands
- `ping()` - Quick reachability check
- Timeouts: 5s connect, 30s write

#### `PrinterProbe`
- Background task that pings printer every 10s
- Caches last known state (`reachable: bool`)
- Used by `/v1/health` and `/v1/status` for instant responses

### `src-tauri/src/server/fgl.rs`
**FGL template rendering**

Converts `TicketRenderData` → FGL commands for thermal printer.

**Key functions**:
- `render_ticket(data)` - Main entry point
- `rc(row, col)` - Position cursor
- `font(size)` - Set font size (1-8)
- `qr(size, payload)` - QR code
- `to_ascii(text)` - Strip diacritics for ASCII-only printers
- `sanitize_text(text)` - Remove `<>` that break FGL parser

**Template layout** (4" thermal ticket):
```
Row  10: Event name (font 6)
Row 110: Venue, City, State (font 2)
Row 150: Date and time (font 3)
Row 210: Section/Row/Seat OR admission type (font 3)
Row 510: Price and event code (font 2)
Row 150: QR code (size 8, version 7)
Row 700: Order ID and timestamp (font 1)
```

### `src-tauri/src/server/pairing.rs`
**Pairing state management**

#### Token Storage (macOS)
- **Keychain**: `security` CLI via `keyring` crate
- **Service**: `com.seatfun.print-agent`
- **Account**: `bearer-token`

#### Metadata Storage
- **Path**: `~/Library/Application Support/SeatfunPrintAgent/pairing.json`
- **Contents**: `{ device_id, organizer_id, organizer_name, device_name, paired_at }`

#### Dev Override
- Set `SEATFUN_AGENT_TOKEN` env var to bypass keychain
- Useful for local testing without pairing flow

### `src-tauri/src/server/routes.rs`
**HTTP request handlers**

**Authentication flow**:
1. Extract `Authorization: Bearer <token>` header
2. Compare with cached token from keychain
3. Return 401 if missing/invalid

**Error responses**:
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Invalid bearer token",
    "request_id": "uuid-v4"
  }
}
```

**Print job flow**:
1. Validate request body
2. For each ticket:
   - Render FGL template
   - Send to printer (with retries if `copies > 1`)
   - Record result
3. Return aggregated results
4. HTTP status: 200 (all ok), 207 (partial), 502 (all failed)

## Dependencies

### Rust Crates

**Core**:
- `tauri` 2.11.2 - Desktop app framework
- `tokio` 1.x - Async runtime
- `axum` 0.7 - HTTP web framework
- `serde` / `serde_json` - JSON serialization

**HTTP**:
- `tower-http` - CORS middleware

**Utilities**:
- `uuid` - Request ID generation
- `chrono` - Timestamps
- `sha2` / `hex` - Token fingerprinting
- `diacritics` - Text normalization
- `keyring` - macOS Keychain access
- `dirs` - Platform-specific paths

**Tauri Plugins**:
- `tauri-plugin-log` - Logging
- `tauri-plugin-autostart` - Launch on login

## Build & Release

### Local Development

```bash
# Run in dev mode (hot reload)
cargo tauri dev

# Build debug DMG
cargo tauri build --debug
```

### Production Release

**Trigger**: Push a git tag (e.g., `v0.1.3`)

**GitHub Actions** (`.github/workflows/release.yml`):
1. Builds for 3 targets:
   - `aarch64-apple-darwin` (Apple Silicon)
   - `x86_64-apple-darwin` (Intel Mac)
   - `x86_64-pc-windows-msvc` (Windows)
2. Creates universal macOS DMG (combines arm64 + x64)
3. Uploads artifacts to draft release

**No Node.js steps** - pure Rust build!

### Bundled Resources

**File**: `src-tauri/tauri.conf.json`

```json
"resources": [
  "../fixtures"  // Sample print job for test-print endpoint
]
```

Resources are bundled into:
- macOS: `SeatfunPrintAgent.app/Contents/Resources/`
- Windows: `SeatfunPrintAgent.exe` directory

## Security

### Token Storage
- **Production**: macOS Keychain (encrypted, requires user auth)
- **Dev**: Environment variable (plaintext, dev only)

### Network
- HTTP server binds to `127.0.0.1` only (localhost)
- No external network exposure
- Dashboard connects via localhost when agent is running

### Code Signing
- macOS: Configured in `tauri.conf.json` (requires Apple Developer cert)
- Windows: Configured for future signing

## Troubleshooting

### Server won't start
- Check logs: `tail -f /tmp/seatfun-agent-debug.log` (if enabled)
- Verify port 9787 is not in use: `lsof -i :9787`
- Check environment variables: `printenv | grep SEATFUN`

### Printer unreachable
- Verify printer IP: `curl http://127.0.0.1:9787/v1/settings`
- Test TCP connection: `nc -zv <PRINTER_IP> 9100`
- Check printer probe: `curl http://127.0.0.1:9787/v1/health | jq .printer`

### Pairing issues
- Check keychain: `security find-generic-password -s com.seatfun.print-agent -a bearer-token`
- Check metadata: `cat ~/Library/Application\ Support/SeatfunPrintAgent/pairing.json`
- Use dev override: `export SEATFUN_AGENT_TOKEN=<token>`

## Related

- [Protocol Documentation](protocol.md) - HTTP API contract
- [Distribution Guide](distribution.md) - Release process
- [CHANGELOG](CHANGELOG.md) - Version history
