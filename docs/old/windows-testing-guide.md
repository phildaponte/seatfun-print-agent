---
Last updated: 2026-06-03
Last change: Initial guide for Windows testing
Owner: @phildaponte
Status: current
---

# Windows Testing Guide

This guide covers testing the Seatfun Print Agent on Windows before production release.

## Testing Environment Options

Since you're developing on macOS, you have several options for Windows testing:

### Option 1: GitHub Actions CI (Recommended)

Use the existing GitHub Actions workflow to build and test on Windows runners.

**Pros:**
- Free for public repositories
- Real Windows environment
- Automated testing
- No local setup required

**Cons:**
- Slower feedback loop
- Limited to CLI testing (no GUI interaction)

**Setup:**
1. Push your code to GitHub
2. The `.github/workflows/release.yml` already includes Windows builds
3. Check the Actions tab to see build results

### Option 2: Virtual Machine

Run Windows on your Mac using virtualization software.

**Options:**
- **Parallels Desktop** ($99/year) - Best performance, seamless integration
- **VMware Fusion** ($149/year) - Good performance, enterprise features
- **VirtualBox** (Free) - Open source, slower performance
- **UTM** (Free) - Apple Silicon optimized, good for testing

**Windows License:**
- Purchase from Microsoft ($139 for Windows 11 Home)
- Use evaluation version (90 days, renewable)

**Setup with Parallels:**
```bash
# Install Parallels Desktop
brew install --cask parallels-desktop

# Download Windows 11 ISO from Microsoft
# Create new VM in Parallels using the ISO
```

### Option 3: Windows Dev Box

Use a cloud-based Windows development environment.

**Options:**
- **GitHub Codespaces** - Free for open source, Windows available
- **AWS EC2** - Pay-as-you-go, Windows Server AMIs available
- **Azure Dev Box** - Microsoft's cloud dev environment

### Option 4: Physical Windows Machine

If you have access to a Windows laptop/desktop.

## Manual Testing Checklist

Once you have Windows access, test the following:

### Installation
- [ ] Download NSIS installer from GitHub releases
- [ ] Run installer (double-click `.exe`)
- [ ] Verify app installs to `C:\Users\<user>\AppData\Local\Programs\seatfun-print-agent`
- [ ] Verify desktop shortcut created (if configured)
- [ ] Verify Start Menu entry created

### First Launch
- [ ] Launch app from Start Menu or desktop shortcut
- [ ] Verify system tray icon appears in notification area
- [ ] Click tray icon, verify menu shows "Show Status", "Show Settings", "Quit"
- [ ] Click "Show Status", verify window opens
- [ ] Verify status window shows agent running
- [ ] Close status window, verify it hides (doesn't quit)

### HTTP Server
- [ ] Open PowerShell and run: `Test-NetConnection -ComputerName 127.0.0.1 -Port 9787`
- [ ] Verify connection succeeds
- [ ] Open browser to `http://127.0.0.1:9787/v1/health`
- [ ] Verify JSON response with health status

### Settings
- [ ] Click "Show Settings" from tray menu
- [ ] Verify settings window opens
- [ ] Enter printer IP (e.g., `192.168.1.47`)
- [ ] Click "Save Settings"
- [ ] Verify success message appears
- [ ] Restart app
- [ ] Verify printer IP persists in settings

### Pairing
- [ ] Open Seatfun dashboard in browser
- [ ] Navigate to Box Office settings
- [ ] Click "Pair this device"
- [ ] Enter device name
- [ ] Click "Pair"
- [ ] Verify pairing succeeds
- [ ] Verify device appears in "Paired devices" list

### Printing
- [ ] Connect BOCA Lemur printer to network
- [ ] Configure printer IP in settings
- [ ] Click "Test print" in dashboard
- [ ] Verify printer prints test ticket
- [ ] Verify ticket content is correct

### Auto-Start
- [ ] Reboot Windows
- [ ] Verify app launches automatically on login
- [ ] Verify tray icon appears
- [ ] Verify HTTP server is running

### Uninstallation
- [ ] Go to Settings → Apps → Installed apps
- [ ] Find "Seatfun Print Agent"
- [ ] Click "Uninstall"
- [ ] Verify app is removed
- [ ] Verify no leftover files in Program Files
- [ ] Verify no registry entries remain

## Automated Testing

Add Windows-specific tests to your test suite:

### HTTP Server Tests
```typescript
// scripts/smoke-print.ts already tests the HTTP server
# Run on Windows via CI or locally
pnpm smoke
```

### Integration Tests
Create `src/server/windows-integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createServer } from './http';

describe('Windows-specific integration', () => {
  it('should handle Windows path separators', () => {
    // Test that .env file reading works with Windows paths
  });

  it('should handle Windows line endings', () => {
    // Test that .env parsing handles CRLF line endings
  });
});
```

## Common Windows Issues

### Path Issues
- **Problem**: Hardcoded Unix-style paths (`/usr/local`)
- **Solution**: Use `path.join()` from Node.js `path` module

### Line Endings
- **Problem**: CRLF vs LF in `.env` files
- **Solution**: Use string splitting that handles both (`content.split(/\r?\n/)`)

### Firewall
- **Problem**: Windows Firewall blocks port 9787
- **Solution**: Add firewall exception during installation

### Permissions
- **Problem**: App can't write to Program Files
- **Solution**: Store `.env` in user's AppData directory

## CI/CD Testing

The GitHub Actions workflow already builds for Windows. Add testing steps:

```yaml
- name: Run tests on Windows
  if: matrix.platform == 'windows-latest'
  run: pnpm test

- name: Smoke test on Windows
  if: matrix.platform == 'windows-latest'
  run: pnpm smoke
```

## Release Testing

Before each release:

1. **Build on Windows CI**: Verify GitHub Actions succeeds
2. **Download artifact**: Get the `.exe` from Actions
3. **Install on clean Windows VM**: Test fresh installation
4. **Run full manual checklist**: Complete all items above
5. **Document any issues**: Add to release notes

## Related

- [`./distribution.md`](./distribution.md) — Build and release process
- [`./code-signing-guide.md`](./code-signing-guide.md) — Code signing setup
- [`./tauri-migration-todo.md`](./tauri-migration-todo.md) — Migration tracking
