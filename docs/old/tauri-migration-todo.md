---
Last updated: 2026-06-03
Last change: Completed settings window, auto-start, universal binary, and added implementation guides
Owner: @phildaponte
Status: current
---

# Tauri Migration Todo — seatfun-print-agent

> Progress tracking for converting the CLI to a Tauri desktop app.

## Completed ✅

- [x] **Tauri initialization**: Added Tauri to the project with proper configuration
- [x] **Node.js sidecar**: Configured Tauri to spawn the existing Node.js HTTP server as a sidecar process
- [x] **HTTP server verification**: Tested and confirmed the server responds on `http://127.0.0.1:9787` when launched via Tauri
- [x] **Build configuration**: Configured Tauri to build macOS DMG and Windows NSIS installers
- [x] **GitHub Actions workflow**: Created `.github/workflows/release.yml` for automated cross-platform builds
- [x] **Documentation updates**: Updated `CHANGELOG.md` and `distribution.md` status to current
- [x] **Local build test**: Successfully built macOS DMG locally (`SeatfunPrintAgent_0.1.0_aarch64.dmg`)

## In Progress / Deferred 🚧

- [x] **System tray icon**: Implemented using Tauri 2.x tray-icon feature
  - Added `tray-icon` feature to Cargo.toml
  - Created tray with "Show Status" and "Quit" menu items
  - Implemented menu event handlers for both actions
  - Cross-platform: macOS (menu bar) and Windows (notification area)
  - Tested - app runs with tray icon visible on macOS

- [x] **Status window**: Implemented with live agent status display
  - Created `src-tauri/status.html` with agent, pairing, and printer status
  - Added "Show Status" menu item to tray
  - Window auto-refreshes every 5 seconds
  - Close button hides window instead of quitting app

- [x] **Settings window**: Fully integrated
  - Created `src-tauri/settings.html` for printer IP configuration
  - Added "Show Settings" menu item to tray
  - Implemented HTTP API endpoints (`GET /v1/settings`, `POST /v1/settings`) for reading/writing `.env`
  - Settings window now accessible from tray menu

- [x] **Dist folder bundling fix**: Fixed Node.js sidecar startup issue
  - Copied `dist/` folder into `src-tauri/` for proper bundling
  - Updated resource path in `tauri.conf.json` to bundle `dist` directory
  - Fixed Node.js spawn logic to use correct working directory
  - App now properly bundles and runs Node.js HTTP server

## Remaining Tasks for Production Release 🔴

### High Priority (Blocking Release)

- [x] **System tray implementation** - COMPLETED
  - Users can now quit the app via tray menu
  - Implemented using Tauri 2.x built-in tray-icon feature
  - Tray icon with "Quit" menu item is functional

- [x] **Settings window integration** - COMPLETED
  - Connected settings.html to HTTP server
  - Implemented printer IP configuration via HTTP API
  - Settings saved to `.env` file
  - Users can now configure printer IP via GUI

- [x] **Login item registration** (auto-start on login) - COMPLETED
  - macOS: Added via tauri-plugin-autostart (LaunchAgent)
  - Windows: Added via tauri-plugin-autostart (registry)
  - App now launches automatically on login

- [x] **Node.js bundling for production** - DECISION MADE
  - Decision: Require system Node.js (Option A) for v1
  - Current approach uses system `node` command
  - Implementation guide created with migration path to bundling
  - See [nodejs-bundling-guide.md](./nodejs-bundling-guide.md)

### Medium Priority (Important for v1)

- [x] **macOS universal binary** - COMPLETED
  - Updated GitHub Actions workflow to build both arm64 and x64
  - Uses `lipo` to combine architectures into universal binary
  - Creates `SeatfunPrintAgent_universal.dmg` artifact

- [ ] **Code signing setup** - GUIDE CREATED
  - macOS: Apple Developer certificate signing documented
  - Windows: Certificate options documented (Certum, Azure)
  - GitHub Secrets configuration documented
  - See [code-signing-guide.md](./code-signing-guide.md)
  - **Action needed**: Purchase certificates and add GitHub Secrets

- [ ] **Windows signing** (optional for v1) - GUIDE CREATED
  - Decision documented: skip for v1 or purchase cert
  - Certum ($30/yr) or Azure Trusted Signing ($120/yr) options documented
  - SmartScreen click-through documented for unsigned option
  - See [code-signing-guide.md](./code-signing-guide.md)
  - **Action needed**: Make decision and implement if chosen

### Low Priority (Can ship without)

- [ ] **Auto-update mechanism**
  - Tauri has built-in updater support
  - Generate Ed25519 keypair
  - Set up update manifest server
  - **Deferred**: Can ship v1 without auto-update

- [ ] **Crash reporting (Sentry)**
  - Add Sentry SDK to Tauri app
  - Configure source maps for crash reports
  - **Deferred**: Nice to have for v1

- [ ] **Improved error handling**
  - Add user-friendly error dialogs
  - Handle Node.js process crashes
  - **Deferred**: Current CLI error handling is sufficient

## Action Items for Tonight 🌙

To have a production-ready build tonight, focus on these:

1. ~~**Implement system tray** (most critical)~~ - COMPLETED
   - ~~Research Tauri 2.x tray plugin documentation~~
   - ~~Add tray icon with Quit option~~
   - ~~Test tray functionality~~

2. **Test the current build**
   - Install the DMG on a clean Mac
   - Verify HTTP server starts automatically
   - Test `/v1/health` endpoint
   - Verify pairing still works
   - Test tray icon and Quit menu

3. **Decide on Node.js bundling**
   - Option A: Require users to have Node.js installed (simpler)
   - Option B: Bundle Node.js with app (larger download)
   - Document the decision

4. **Prepare for distribution**
   - Decide on Windows signing (skip for v1 or purchase cert)
   - Document SmartScreen click-through if skipping signing
   - Prepare release notes

## Files Modified

- `src-tauri/tauri.conf.json` - Tauri configuration
- `src-tauri/src/lib.rs` - Rust main entry point with Node.js sidecar
- `src-tauri/Cargo.toml` - Rust dependencies
- `src-tauri/settings.html` - Settings UI (fully integrated)
- `.github/workflows/release.yml` - CI/CD workflow
- `docs/CHANGELOG.md` - Changelog updated
- `docs/distribution.md` - Status updated to current
- `docs/code-signing-guide.md` - Code signing implementation guide
- `docs/windows-testing-guide.md` - Windows testing guide
- `docs/nodejs-bundling-guide.md` - Node.js bundling decision guide

## Known Issues

- No code signing - macOS Gatekeeper will show warning (see [code-signing-guide.md](./code-signing-guide.md))
- Windows not tested locally - only macOS DMG built (see [windows-testing-guide.md](./windows-testing-guide.md))
- Requires system Node.js - users must install Node.js 20+ (see [nodejs-bundling-guide.md](./nodejs-bundling-guide.md))

## Related

- [`./distribution.md`](./distribution.md) — Build and release process
- [`./architecture.md`](./architecture.md) — System architecture
- [`./protocol.md`](./protocol.md) — HTTP protocol
