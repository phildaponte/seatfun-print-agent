---
Last updated: 2026-06-03
Last change: Initial guide for code signing setup
Owner: @phildaponte
Status: current
---

# Code Signing Implementation Guide

This guide covers setting up code signing for the Seatfun Print Agent desktop app.

## Overview

Code signing is required to:
- Bypass macOS Gatekeeper warnings
- Avoid Windows SmartScreen warnings
- Enable automatic updates via Tauri's updater

## macOS Code Signing

### Prerequisites

1. **Apple Developer Account** ($99/year)
   - Sign up at https://developer.apple.com/programs/
   - Requires organization enrollment (not individual)

2. **Certificate Types**
   - **Developer ID Application**: For distributing outside Mac App Store
   - **Developer ID Installer**: For DMG/Package installer signing

### Step 1: Create Certificates

1. Go to [Apple Developer Portal](https://developer.apple.com/account/resources/certificates/list)
2. Click "+" to create a new certificate
3. Select "Developer ID Application"
4. Follow instructions to create a CSR (Certificate Signing Request) using Keychain Access
5. Download and install the certificate in your Keychain

Repeat for "Developer ID Installer" if you want to sign the DMG installer.

### Step 2: Export Certificate for CI

1. Open Keychain Access
2. Find your "Developer ID Application" certificate
3. Right-click → Export
4. Choose `.p12` format
5. Set a strong password (you'll need this for GitHub Secrets)

### Step 3: Configure GitHub Secrets

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

- `APPLE_CERTIFICATE`: Base64-encoded `.p12` certificate
  ```bash
  base64 -i YourCertificate.p12 | pbcopy
  ```
- `APPLE_CERTIFICATE_PASSWORD`: The password you set when exporting
- `APPLE_SIGNING_IDENTITY`: Your team ID + certificate name
  - Format: `Developer ID Application: YOUR_TEAM_ID (YOUR_NAME)`
  - Find your Team ID at https://developer.apple.com/account/team
- `APPLE_ID`: Your Apple Developer email
- `APPLE_PASSWORD`: App-specific password for notarization
  - Generate at https://appleid.apple.com/account/manage
  - Label: "Tauri Notarization"

### Step 4: Update tauri.conf.json

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: YOUR_TEAM_ID",
      "entitlements": "src-tauri/entitlements.plist",
      "hardenedRuntime": true,
      "providerShortName": "YOUR_TEAM_ID"
    }
  }
}
```

### Step 5: Create entitlements.plist

Create `src-tauri/entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

### Step 6: Update GitHub Actions Workflow

Add notarization steps to `.github/workflows/release.yml`:

```yaml
- name: Sign and notarize macOS app
  if: matrix.platform == 'macos-latest'
  env:
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
    APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
  run: |
    # Import certificate
    echo $APPLE_CERTIFICATE | base64 --decode > certificate.p12
    security create-keychain -p "" build.keychain
    security import certificate.p12 -k build.keychain -P $APPLE_CERTIFICATE_PASSWORD -T /usr/bin/codesign
    security list-keychains -s build.keychain
    security default-keychain -s build.keychain
    security unlock-keychain -p "" build.keychain
    security set-key-partition-list -S apple-tool:,apple: -s -k "" build.keychain
    
    # Sign app
    codesign --force --deep --sign "$APPLE_SIGNING_IDENTITY" src-tauri/target/release/bundle/macos/SeatfunPrintAgent.app
    
    # Notarize
    xcrun notarytool submit src-tauri/target/release/bundle/dmg/*.dmg \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_PASSWORD" \
      --team-id "$(echo $APPLE_SIGNING_IDENTITY | awk '{print $NF}' | tr -d '()')" \
      --wait
```

## Windows Code Signing

### Option A: Skip for v1 (Recommended)

If you're shipping internally or to trusted users, you can skip Windows signing. Users will see a SmartScreen warning that they can click through.

Document this in your release notes:
> "Windows may show a SmartScreen warning. Click 'More info' then 'Run anyway' to proceed."

### Option B: Purchase Certificate

**Certum** ($30/year) - Affordable option for open-source projects:
- Sign up at https://www.certum.pl/certum/cert,offer_en.xml
- Choose "Code Signing Certificate for Individual Developers"
- Requires identity verification

**Azure Trusted Signing** ($120/year) - Microsoft's option:
- Sign up at https://learn.microsoft.com/en-us/azure/trusted-signing/
- More expensive but better integration with Microsoft ecosystem

### Step 1: Export Certificate

After purchasing, export as `.pfx` with a strong password.

### Step 2: Configure GitHub Secrets

- `WINDOWS_CERTIFICATE`: Base64-encoded `.pfx` certificate
- `WINDOWS_CERTIFICATE_PASSWORD`: The password you set

### Step 3: Update tauri.conf.json

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "YOUR_CERTIFICATE_THUMBPRINT",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com"
    }
  }
}
```

### Step 4: Update GitHub Actions Workflow

```yaml
- name: Sign Windows app
  if: matrix.platform == 'windows-latest'
  env:
    WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
    WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
  run: |
    # Import certificate
    echo $WINDOWS_CERTIFICATE | base64 --decode > certificate.pfx
    certutil -f -p $WINDOWS_CERTIFICATE_PASSWORD -importpfx certificate.pfx
    
    # Sign app
    signtool sign /f certificate.pfx /p $WINDOWS_CERTIFICATE_PASSWORD /tr http://timestamp.digicert.com /td sha256 /fd sha256 src-tauri/target/release/bundle/nsis/*.exe
```

## Verification

### macOS
```bash
codesign -dv --verbose=4 SeatfunPrintAgent.app
spctl -a -t exec -v SeatfunPrintAgent.app
```

### Windows
```bash
signtool verify /pa SeatfunPrintAgent.exe
```

## Related

- [`./distribution.md`](./distribution.md) — Build and release process
- [`./tauri-migration-todo.md`](./tauri-migration-todo.md) — Migration tracking
