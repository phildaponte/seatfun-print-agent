---
Last updated: 2026-06-03
Last change: Migrated to pure Rust HTTP server - eliminated Node.js dependency
Owner: @phildaponte
Status: current
---

# seatfun-print-agent

> Local desktop agent that bridges the Seatfun dashboard to a **BOCA Systems Lemur** thermal ticket printer on a venue's LAN. Runs on macOS and Windows from a single codebase.

This repo contains the agent only. Feature plans, UX, and the dashboard side live in [`seatfun-dashboard`](https://github.com/phildaponte/seatfun-dashboard) under `docs/05-features/box-office-printing.md` and `docs/01-architecture/print-agent.md`.

---

## What it is

A small HTTP server that runs locally on a box-office laptop. The Seatfun dashboard, open in a browser on the same laptop, posts signed print jobs to `http://127.0.0.1:9787`. The agent renders the job into **FGL (Friendly Ghost Language)** — BOCA's printer command language — and writes the bytes over a TCP socket to the printer at port 9100.

It is the only software component that talks to the printer. The dashboard never opens a socket to the LAN.

## Why it exists

- The Seatfun dashboard runs on Vercel (public internet). The printer has a private LAN IP (e.g. `192.168.1.47`). Vercel cannot reach it.
- Browser-side WebUSB/WebSerial is unreliable on Windows for thermal printers.
- An OS-installed agent is the only reliable cross-platform bridge.

## Hardware support

- ✅ **BOCA Systems Lemur-S** with Ethernet, FGL46 firmware (only model verified).
- 🟡 Other BOCA models with FGL46 should work in theory; not tested.
- ❌ Non-BOCA printers are out of scope.

## Status

- ✅ **v0.1.3 — Pure Rust Implementation** (current). Complete migration to native Rust HTTP server - **no Node.js required!**
- ✅ **v0.1.0 — Tauri Desktop App**. System tray, status/settings windows, pairing, auto-start, HTTP API for dashboard integration.
- ⏳ **v1.0.0 — Production Ready.** Code signing, auto-update, mDNS printer discovery.

## Requirements

**Users need:**
- macOS 10.13+ or Windows 10+

**That's it!** No Node.js, Python, or other runtime dependencies. Just download and run.

## Install

### macOS
1. Download `SeatfunPrintAgent_0.1.0_aarch64.dmg` (Apple Silicon) or `SeatfunPrintAgent_0.1.0_x86_64.dmg` (Intel) from [GitHub Releases](https://github.com/phildaponte/seatfun-print-agent/releases)
2. Open the DMG and drag `SeatfunPrintAgent.app` to Applications
3. Open the app - a tray icon will appear in your menu bar
4. Right-click the tray icon → **Show Settings** to configure printer IP

### Windows
1. Download `SeatfunPrintAgent_0.1.0_x64.exe` from [GitHub Releases](https://github.com/phildaponte/seatfun-print-agent/releases)
2. Run the installer
3. The app will start automatically and appear in your system tray

The agent registers a launch-on-login entry and runs in the background after installation.

## First-run flow

1. **Install and launch** the app - a tray icon appears in your menu bar/system tray
2. **Right-click the tray icon** → **Show Settings**
3. **Enter printer IP** (printed on the BOCA self-test page — hold the TEST button ~3s)
4. **Click "Save Settings"** - the agent will restart
5. **In the dashboard** go to **Settings → Box Office → Add device** and copy the 6-digit pairing code
6. **Paste the code** in the dashboard pairing flow - the agent stores the bearer token in the OS keychain
7. **Done!** Open the Box Office tab in the dashboard and print tickets

**Note:** The agent runs automatically on login after installation. Check the tray icon to view status or change settings.

## Develop

Requires **Rust** only (install from [rustup.rs](https://rustup.rs)).

```bash
git clone git@github.com:phildaponte/seatfun-print-agent.git
cd seatfun-print-agent
cp .env.example .env       # set PRINTER_IP, etc.

# Run in development mode (with hot reload)
cargo tauri dev
```

Health check (while app is running):

```bash
curl http://127.0.0.1:9787/v1/health
```

Build for production:

```bash
cargo tauri build
# Output: src-tauri/target/release/bundle/dmg/*.dmg (macOS)
#         src-tauri/target/release/bundle/nsis/*.exe (Windows)
```

For the full wire format see [`docs/protocol.md`](./docs/protocol.md).

## Repo layout

```
.
├── src-tauri/
│   ├── src/
│   │   ├── server/          Rust HTTP server (Axum)
│   │   │   ├── routes.rs    API endpoints
│   │   │   ├── printer.rs   TCP client + probe
│   │   │   ├── fgl.rs       FGL template renderer
│   │   │   ├── pairing.rs   Keychain integration
│   │   │   ├── config.rs    Environment config
│   │   │   └── logger.rs    Structured logging
│   │   ├── lib.rs           Tauri app + system tray
│   │   └── main.rs          Entry point
│   ├── Cargo.toml           Rust dependencies
│   └── tauri.conf.json      Tauri configuration
├── frontend/                HTML for tray windows
├── fixtures/                Sample print jobs
├── docs/
│   ├── tauri-architecture.md  How the Rust app works (SOURCE OF TRUTH)
│   ├── protocol.md            Wire contract with dashboard
│   ├── distribution.md        Build, sign, release
│   └── CHANGELOG.md           Version history
└── README.md
```

## Build (v1, planned)

```bash
pnpm build:mac           # → SeatfunPrintAgent-<v>.dmg (signed + notarized)
pnpm build:win           # → SeatfunPrintAgent-<v>.exe (signed)
pnpm release             # publishes to GitHub Releases + auto-update channel
```

See [`docs/distribution.md`](./docs/distribution.md) for the signing setup, certificate management, and auto-update wiring.

## Configuration

The agent reads config from (in order of precedence):

1. CLI flags (`--port`, `--printer-ip`, `--log-level`).
2. Env vars (`SEATFUN_AGENT_PORT`, `SEATFUN_PRINTER_IP`, ...).
3. Settings file in the OS app-data dir (written by the GUI in v1).
4. Defaults baked into the binary.

Secrets (the bearer token from pairing) are **never** stored in the settings file. They live in the OS keychain only.

## Logs

- macOS: `~/Library/Logs/SeatfunPrintAgent/agent.log`
- Windows: `%LOCALAPPDATA%\SeatfunPrintAgent\Logs\agent.log`

Rotated daily, 14 days retained. Agent never logs the bearer token, the QR payload, or PII (buyer email is hashed before logging).

## License

Proprietary © Seatfun. Not for redistribution.

## Related

- [`docs/tauri-architecture.md`](./docs/tauri-architecture.md) — **SOURCE OF TRUTH** for how the Rust app works.
- [`docs/protocol.md`](./docs/protocol.md) — wire contract with the dashboard. **Frozen** post-v1.
- [`docs/distribution.md`](./docs/distribution.md) — build / sign / release.
- [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — version history.
- Dashboard side: `seatfun-dashboard/docs/05-features/box-office-printing.md`.
- Architecture overview: `seatfun-dashboard/docs/01-architecture/print-agent.md`.
- BOCA FGL46 reference: <https://www.bocasystems.com/documents/fgl46_rev16_7.pdf>.
