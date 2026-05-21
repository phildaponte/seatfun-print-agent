---
Last updated: 2026-05-20
Last change: Corrected cost numbers (Apple Developer already covered; Windows cert is the only real recurring cost); affirmed Windows/macOS shipping parity
Owner: @phildaponte
Status: draft
---

# Distribution — seatfun-print-agent

> How the agent is built, signed, released, and auto-updated on macOS and Windows.

The agent is shipped as a desktop app to non-technical box-office staff. Distribution must be **boring**: download → install → it works. No terminal, no permission popups beyond the OS-default ones, no nag screens.

**Windows and macOS ship at the same time.** Most of our client's organizers run Windows; a Mac-only v1 is not a v1. The dashboard's "Add device" page links to both `.dmg` and `.exe` simultaneously, or none at all.

## Build pipeline (v1, Tauri)

One source tree → two installers via GitHub Actions matrix.

```
.github/workflows/release.yml
   matrix: [macos-latest, windows-latest]
   steps:
     - checkout
     - setup pnpm + node + rust
     - pnpm install
     - pnpm test
     - pnpm tauri build         (produces .dmg / .msi / .exe)
     - sign + notarize          (platform-specific)
     - upload to GitHub Release
     - publish to update channel
```

Artifacts:

| Platform | Output | Size target |
|---|---|---|
| macOS (universal: arm64 + x64) | `SeatfunPrintAgent-<v>.dmg` | < 15 MB |
| Windows (x64) | `SeatfunPrintAgent-<v>-Setup.exe` | < 15 MB |

## Code signing — macOS

Required to avoid Gatekeeper "unidentified developer" blocks.

- Apple **Developer ID Application** certificate. **Already covered by @phildaponte's existing Apple Developer Program membership** (~$99/year flat — paid for other Seatfun work). No incremental cost for this project.
- Stored in GitHub Secrets as a base64-encoded `.p12`:
  - `MAC_CERTIFICATE` — the base64 cert.
  - `MAC_CERTIFICATE_PASSWORD` — its password.
  - `MAC_NOTARIZATION_APPLE_ID` — Apple ID for notarization.
  - `MAC_NOTARIZATION_TEAM_ID` — team identifier.
  - `MAC_NOTARIZATION_PWD` — app-specific password.
- Build step:
  1. Import cert into a temporary keychain in CI.
  2. `tauri build` signs with `Developer ID Application: Seatfun ...`.
  3. `xcrun notarytool submit` → wait → `staple`.
  4. Output `.dmg` is fully notarized and Gatekeeper-clean.

Verify locally:

```bash
spctl --assess --type execute --verbose /Applications/SeatfunPrintAgent.app
```

Should print `accepted` + `source=Notarized Developer ID`.

## Code signing — Windows

Not strictly required, but **recommended** to avoid SmartScreen "unrecognized app" warnings on first launch. Since most of our box-office computers will be Windows, the warning friction matters.

Four realistic options, cheapest to most expensive:

| Option | Cost / year | SmartScreen behaviour | When to pick |
|---|---|---|---|
| **No signing** | $0 | First launch shows warning; staff click "More info → Run anyway" once per machine. | v1 launch if budget is tight. Acceptable for an internal/B2B tool where staff are trained. |
| **Certum Open Source / Individual** | ~$30 | Warning suppressed after a few hundred downloads ("reputation building"). | Best $/value ratio. Recommended for v1.1+. |
| **Azure Trusted Signing** | ~$120 ($9.99/mo) | EV-quality reputation from day one. Cloud-based — no USB token to manage. | Recommended if SmartScreen warnings cause real friction. |
| **DigiCert / Sectigo / SSL.com EV** | ~$300–700 | EV-quality, traditional path. Requires USB token. | Avoid unless required by an enterprise procurement process. |

**Recommendation for v1:** ship unsigned, document the SmartScreen click-through in the install doc, then upgrade to **Certum (~$30/yr)** or **Azure Trusted Signing (~$120/yr)** based on real-world feedback.

If signing is enabled, store the cert in GitHub Secrets:
  - `WIN_CERTIFICATE` — base64 `.pfx`.
  - `WIN_CERTIFICATE_PASSWORD`.

Build step uses `signtool` (Windows runner):

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 \
  /f $env:CERT_PATH /p $env:CERT_PASSWORD \
  SeatfunPrintAgent-Setup.exe
```

Always include `/tr` (timestamp) — without it the signature expires when the cert expires.

## Versioning

Semver: `MAJOR.MINOR.PATCH`.

- `MAJOR` bump when the **wire protocol** with the dashboard breaks. Forces every box office to update.
- `MINOR` bump for backwards-compatible features (new endpoints, new fields).
- `PATCH` for bug fixes, no protocol changes.

The dashboard reads `agent_version` on every print and warns admins if a paired device is more than one minor version behind.

## Auto-update

Tauri ships a built-in updater. Setup:

1. Generate an Ed25519 keypair at project setup (`tauri signer generate`). Public key is baked into the binary; private key lives in GitHub Secrets only.
2. On every release, the build pipeline produces an `update-manifest.json` listing the new version, signed binaries, and the signature.
3. The manifest is published to a stable URL: `https://updates.seatfun.com/print-agent/<channel>/manifest.json`.
4. Channels: `stable` (production), `beta` (opt-in via a flag in settings).
5. The agent checks the manifest on launch and every 6 hours. On match: download, verify signature, swap binary, prompt user to restart (or restart silently if idle).

Updates are **mandatory but non-blocking** in v1: the user can defer up to 7 days, after which the agent refuses to start until updated. Critical security updates can set `mandatory: true` in the manifest to force immediate update.

## Release checklist

For every release:

- [ ] All tests green on `main`.
- [ ] Bumped `package.json` version + `tauri.conf.json` version.
- [ ] Updated `CHANGELOG.md` in the agent repo.
- [ ] Tag pushed: `git tag v1.2.3 && git push --tags`.
- [ ] CI built, signed, notarized both artifacts.
- [ ] Manual smoke test: install fresh on a Mac and a Windows machine, pair, print one ticket.
- [ ] Manual smoke test: existing v1.2.2 install auto-updates to v1.2.3 on next launch.
- [ ] Update manifest published to `stable` channel.
- [ ] Release notes posted to the dashboard's admin announcements.

## Compatibility matrix

| Agent version | Minimum dashboard API version | Notes |
|---|---|---|
| 1.0.x | 1.0.0 | Initial release. |
| 1.1.x | 1.0.0 | New optional fields; backwards compatible. |
| 2.0.x | 2.0.0 | Breaking protocol change — forces dashboard upgrade first, then agent. |

When introducing a v2 protocol: ship the dashboard with **dual-protocol support** for one full release cycle, then deprecate v1 in agent v2.0.

## Distribution channels

- **Primary:** download links from the dashboard's "Settings → Box Office → Add device" screen. The links point to the latest stable build on GitHub Releases (or a CDN if release sizes/bandwidth become a concern).
- **Not** distributed via Mac App Store or Microsoft Store in v1 — store review adds friction without much benefit for a B2B internal tool.

## Costs

| Item | Annual | Notes |
|---|---|---|
| Apple Developer Program | **$0 incremental** | Already covered by @phildaponte's existing membership. |
| Mac notarization | $0 | Included with Apple Developer. |
| Tauri framework | $0 | Open source (MIT). |
| GitHub Actions build minutes | $0 | Free tier (2,000 min/mo) is plenty. |
| Update server hosting | $0 | Manifest on Vercel or GitHub Pages. |
| Sentry crash reporting | $0 | Free dev tier (5K events/mo). |
| **Windows code-signing cert** | **$0 / $30 / $120 / $300+** | The only real variable. See § *Code signing — Windows* above. |

**Realistic v1 total: $0–$30/year.** Skip Windows signing initially, document the SmartScreen click-through, upgrade to a $30/yr Certum cert if friction warrants. Only if a large client demands instant SmartScreen reputation does this jump to $120/yr (Azure Trusted Signing) or higher.

## Uninstall

- macOS: drag `SeatfunPrintAgent.app` to Trash. Login item auto-removed. Logs + settings stay in `~/Library/Application Support/SeatfunPrintAgent/` until manually deleted (documented in the help center).
- Windows: standard `Add or Remove Programs` entry. Uninstaller cleans `%LOCALAPPDATA%\SeatfunPrintAgent\`.
- Both: the OS-keychain bearer token is wiped during uninstall by the platform-specific uninstall script.

## Related

- [`./architecture.md`](./architecture.md) — what's inside the binary.
- [`./protocol.md`](./protocol.md) — what changes when bumping `MAJOR`.
- Tauri updater docs: <https://tauri.app/v1/guides/distribution/updater/>.
