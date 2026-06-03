---
Last updated: 2026-06-03
Last change: Added Tauri desktop app migration entry
Owner: @phildaponte
Status: current
---

# Changelog

## 2026-06-03

- **Tauri desktop app**: Migrated from CLI to Tauri desktop app for macOS and Windows distribution. The existing Node.js HTTP server now runs as a sidecar process within the Tauri app. Build configuration targets macOS (dmg) and Windows (nsis). Added GitHub Actions workflow for automated release builds. Why: enable non-technical box-office staff to install and run the agent without terminal usage. Docs: [distribution](./distribution.md). Code: `src-tauri/`, `.github/workflows/release.yml`.

## 2026-06-02

- **FGL ticket template**: Reworked the BOCA Lemur ticket renderer into a main ticket body plus tear-off stub with large/small QR codes, dashed separator, event, venue, price, date, and order id placement. Why: match the provided reference ticket layout for Lemur FGL output. Docs: [architecture](./architecture.md). Code: `src/fgl/template.ts`.

## Related

- [Architecture](./architecture.md)
- [Protocol](./protocol.md)
- [Distribution](./distribution.md)
