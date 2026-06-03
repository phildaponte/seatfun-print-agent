---
Last updated: 2026-06-03
Last change: Complete migration from Node.js to pure Rust HTTP server
Owner: @phildaponte
Status: current
---

# Changelog

## 2026-06-03

- **Pure Rust HTTP server migration**: Completely replaced Node.js sidecar with native Rust HTTP server using Axum framework. Ported all 7 API endpoints (`/v1/health`, `/v1/status`, `/v1/pair`, `/v1/print`, `/v1/test-print`, `/v1/settings`), printer TCP client, FGL template rendering, and pairing/keychain logic to Rust. Removed all Node.js spawning code from `lib.rs`, removed Node.js/pnpm steps from GitHub Actions workflow, and removed `dist` bundling from `tauri.conf.json`. Why: **eliminates Node.js as a runtime dependency** - users now only need to download the app with no external dependencies. Faster startup, smaller bundle, better security with native keychain integration, simpler deployment. Docs: [tauri-architecture](./tauri-architecture.md). Code: `src-tauri/src/server/`, `src-tauri/src/lib.rs`, `.github/workflows/release.yml`, `src-tauri/tauri.conf.json`.

- **CORS configuration for Tauri webviews**: Added `tauri://localhost` to default allowed origins in CORS configuration to enable tray windows to fetch from the HTTP server. Why: Tauri webviews use `tauri://localhost` as their origin, which was being blocked by CORS. Docs: [architecture](./architecture.md). Code: `src/config.ts`.

- **Frontend directory structure**: Created dedicated `frontend/` directory for HTML assets and configured Tauri's `frontendDist` to serve files from this location. Removed HTML files from `src-tauri/` directory. Why: Tauri requires frontend assets in a separate directory from the Rust source code for proper bundling. Docs: [architecture](./architecture.md). Code: `frontend/`, `src-tauri/tauri.conf.json`.

- **Tauri asset protocol migration**: Replaced HTTP server static file serving with Tauri's native asset protocol for tray windows. Changed `lib.rs` to use `WebviewUrl::App("status.html")` and `WebviewUrl::App("settings.html")` instead of `WebviewUrl::External("http://127.0.0.1:9787/...")`. Removed `GET /status.html` and `GET /settings.html` routes from `http.ts` along with all path resolution logic. Removed unused imports (`fileURLToPath`, `fs`, `path`). Why: eliminates all path resolution issues in production bundles by serving HTML files directly through Tauri's asset loader instead of Node.js file system access. More reliable, simpler code, no 404 errors. Docs: [architecture](./architecture.md), [protocol](./protocol.md). Code: `src-tauri/src/lib.rs`, `src/server/http.ts`.

- **Static file serving path resolution**: Fixed HTTP server path resolution for `status.html` and `settings.html` using `import.meta.url` and `fileURLToPath` for reliable path calculation. Now searches paths relative to the source file location (not just `process.cwd()`). Added detailed debug logging showing each path checked and whether files exist. Fixed window recreation in `lib.rs` - now checks if window exists and focuses/shows it instead of panicking with "WebviewLabelAlreadyExists". Why: paths relative to `cwd` weren't working in dev mode; `import.meta.url` provides reliable paths. Window recreation bug was causing crashes when clicking tray menu items multiple times. Docs: [architecture](./architecture.md). Code: `src/server/http.ts`, `src-tauri/src/lib.rs`.

- **Settings endpoints refactor**: Extracted inline `/v1/settings` handlers from `http.ts` into a dedicated route module at `src/server/routes/settings.ts`. Implemented `handleGetSettings` (returns `printer_ip` from config) and `handlePostSettings` (writes to `.env` file with proper error handling). Updated `http.ts` to import and delegate to the new handlers. Why: cleaner separation of concerns, consistent with other route modules, easier testing. Docs: [protocol](./protocol.md). Code: `src/server/routes/settings.ts`, `src/server/http.ts`.

- **Dist folder bundling fix**: Fixed Node.js sidecar startup issue by properly bundling the `dist/` folder containing compiled Node.js code. Copied `dist/` into `src-tauri/` directory, updated `tauri.conf.json` resources config, and fixed Node.js spawn logic to use correct working directory. App now properly bundles and runs the HTTP server. Why: app was crashing on launch because Node.js code wasn't bundled, causing blank status/settings windows. Docs: [tauri-migration-todo](./tauri-migration-todo.md). Code: `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`.

- **Settings window integration**: Added "Show Settings" menu item to system tray that opens a settings window for configuring printer IP. Implemented HTTP API endpoints (`GET /v1/settings`, `POST /v1/settings`) for reading and writing `.env` file. Updated `settings.html` to use HTTP API instead of Tauri FS API. Why: enable users to configure printer IP via GUI instead of editing `.env` file manually. Docs: [tauri-migration-todo](./tauri-migration-todo.md). Code: `src-tauri/src/lib.rs`, `src-tauri/settings.html`, `src/server/http.ts`.

- **Auto-start on login**: Implemented auto-start functionality using `tauri-plugin-autostart`. App now launches automatically on login for both macOS (via LaunchAgent) and Windows (via registry). Added plugin to `Cargo.toml` and configured in `lib.rs`. Why: ensure agent is always running when user logs in, eliminating manual launch step. Docs: [tauri-migration-todo](./tauri-migration-todo.md). Code: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`.

- **macOS universal binary**: Updated GitHub Actions workflow to build both arm64 and x64 macOS binaries, then combine them using `lipo` into a universal DMG. Workflow now downloads both architecture artifacts, mounts DMGs, creates universal binary, and packages as `SeatfunPrintAgent_universal.dmg`. Why: support both Apple Silicon and Intel Macs with a single download. Docs: [distribution](./distribution.md). Code: `.github/workflows/release.yml`.

- **Implementation guides**: Created three comprehensive guides for remaining production tasks: code signing setup (macOS and Windows), Windows testing procedures, and Node.js bundling decision analysis. Each guide includes step-by-step instructions, pros/cons analysis, and implementation details. Why: provide clear paths for completing code signing, Windows testing, and Node.js bundling decisions. Docs: [code-signing-guide](./code-signing-guide.md), [windows-testing-guide](./windows-testing-guide.md), [nodejs-bundling-guide](./nodejs-bundling-guide.md).

- **Tauri desktop app**: Migrated from CLI to Tauri desktop app for macOS and Windows distribution. The existing Node.js HTTP server now runs as a sidecar process within the Tauri app. Build configuration targets macOS (dmg) and Windows (nsis). Added GitHub Actions workflow for automated release builds. Why: enable non-technical box-office staff to install and run the agent without terminal usage. Docs: [distribution](./distribution.md). Code: `src-tauri/`, `.github/workflows/release.yml`.

## 2026-06-02

- **FGL ticket template**: Reworked the BOCA Lemur ticket renderer into a main ticket body plus tear-off stub with large/small QR codes, dashed separator, event, venue, price, date, and order id placement. Why: match the provided reference ticket layout for Lemur FGL output. Docs: [architecture](./architecture.md). Code: `src/fgl/template.ts`.

## Related

- [Architecture](./architecture.md)
- [Protocol](./protocol.md)
- [Distribution](./distribution.md)
