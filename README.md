---
Last updated: 2026-05-20
Last change: Initial scaffold — repo hygiene, FGL renderer (v0), and CLI agent (v0)
Owner: @phildaponte
Status: draft
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

- 🚧 **v0 — CLI** (current target). Plain Node, no UI, config file, prints from a single endpoint. Built to run the first end-to-end FGL spike with the dashboard.
- ⏳ **v1 — Tauri.** Settings window, pairing UX, system tray, auto-update, OS-keychain token storage.
- ⏳ **v2 — Polish.** mDNS printer auto-discovery, offline job queue, multi-printer.

## Install (v1, planned)

- macOS: download `SeatfunPrintAgent-<version>.dmg`, drag to Applications, open.
- Windows: download `SeatfunPrintAgent-<version>.exe`, run installer.

The agent registers a launch-on-login entry, opens a settings window on first run, and adds a tray/menu-bar icon. After pairing it runs in the background.

## First-run flow

1. Open the agent. It prompts for the **printer IP** (printed on the BOCA self-test page — hold the TEST button ~3s).
2. Click **Test print**. A test ticket comes out of the printer.
3. In the dashboard go to **Settings → Box Office → Add device**. Copy the 6-digit pairing code.
4. Paste the code into the agent → **Pair**. Agent stores a bearer token in the OS keychain.
5. Done. Open the Box Office tab in the dashboard and print real tickets.

## Develop (v0)

Requires **Node 20+**.

```bash
git clone git@github.com:phildaponte/seatfun-print-agent.git
cd seatfun-print-agent
npm install
cp .env.example .env       # set SEATFUN_AGENT_TOKEN, PRINTER_IP, etc.
npm run dev                # starts the agent on :9787 with hot reload (tsx watch)
```

Run the golden tests on the FGL renderer:

```bash
npm test
```

Health check + smoke print from another terminal (replace `TOKEN` with the value of `SEATFUN_AGENT_TOKEN` from your `.env`):

```bash
curl http://127.0.0.1:9787/v1/health

curl -X POST http://127.0.0.1:9787/v1/print \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @./fixtures/sample-job.json
```

Real-hardware smoke test (bypasses the HTTP server, prints directly via TCP):

```bash
PRINTER_IP=192.168.1.47 npm run smoke
```

For the full wire format see [`docs/protocol.md`](./docs/protocol.md).

## Repo layout (planned)

```
.
├── src/
│   ├── server/          HTTP server, route handlers, auth middleware
│   ├── fgl/             FGL renderer (will move to @seatfun/fgl shared pkg)
│   ├── printer/         TCP socket client + status parsing
│   ├── pairing/         pairing handshake + keychain storage
│   └── index.ts         entrypoint
├── fixtures/            sample jobs + golden FGL output for tests
├── docs/
│   ├── architecture.md  internal structure
│   ├── protocol.md      wire contract with the dashboard (frozen)
│   └── distribution.md  build, sign, release, auto-update
├── package.json
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

- [`docs/architecture.md`](./docs/architecture.md) — how the agent is built internally.
- [`docs/protocol.md`](./docs/protocol.md) — wire contract with the dashboard. **Frozen** post-v1.
- [`docs/distribution.md`](./docs/distribution.md) — build / sign / release.
- Dashboard side: `seatfun-dashboard/docs/05-features/box-office-printing.md`.
- Architecture overview: `seatfun-dashboard/docs/01-architecture/print-agent.md`.
- BOCA FGL46 reference: <https://www.bocasystems.com/documents/fgl46_rev16_7.pdf>.
