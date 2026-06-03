---
Last updated: 2026-06-03
Last change: Initial guide for Node.js bundling decision
Owner: @phildaponte
Status: current
---

# Node.js Bundling Decision Guide

This guide helps you decide how to handle Node.js runtime distribution for the Seatfun Print Agent.

## Current State

The app currently uses the system's installed Node.js:

```rust
// src-tauri/src/lib.rs
let node_path = "node"; // Uses system Node.js
let child = Command::new(node_path)
  .arg(&dist_path)
  .spawn();
```

## Options

### Option A: Require System Node.js (Simpler)

**Approach:** Require users to have Node.js installed on their system.

**Pros:**
- Smaller app download size (~10-15 MB vs ~50-60 MB)
- Simpler build process
- Users likely have Node.js for other tools
- Faster development iteration

**Cons:**
- Users must install Node.js before using the app
- Version compatibility issues (user has Node 18, app needs Node 20)
- Support burden for non-technical users
- Breaks if user uninstalls Node.js

**Implementation:**
- No code changes needed (current approach)
- Document Node.js requirement in README
- Add Node.js version check at startup
- Show error message if Node.js not found or wrong version

**User Experience:**
1. Download Seatfun Print Agent
2. Install Node.js 20+ from nodejs.org
3. Install Seatfun Print Agent
4. Launch app

**Documentation Addition:**
```markdown
## Requirements

- macOS 10.13+ or Windows 10+
- Node.js 20+ (download from https://nodejs.org)
```

### Option B: Bundle Node.js (Better UX)

**Approach:** Bundle Node.js runtime with the app.

**Pros:**
- No external dependencies for users
- Consistent Node.js version across all installations
- Better user experience (one download, one install)
- Works offline after installation

**Cons:**
- Larger app download size (~50-60 MB)
- More complex build process
- Slower CI/CD builds
- Need to update bundled Node.js with each major version

**Implementation Options:**

#### Option B1: Tauri Sidecar Bundling

Use Tauri's built-in sidecar bundling with `tauri-bundler`.

**Setup:**
1. Download Node.js binaries for each platform
2. Place in `src-tauri/sidecar/` directory
3. Update `tauri.conf.json` to bundle sidecar
4. Update Rust code to use bundled Node.js

**tauri.conf.json:**
```json
{
  "bundle": {
    "externalBin": [
      {
        "name": "node",
        "src": "sidecar/node"
      }
    ]
  }
}
```

**lib.rs:**
```rust
let resource_path = app.path().resource_dir().unwrap();
let node_path = if cfg!(target_os = "macos") {
  resource_path.join("node-macos")
} else if cfg!(target_os = "windows") {
  resource_path.join("node.exe")
} else {
  resource_path.join("node-linux")
};
```

**Download Node.js Binaries:**
```bash
# macOS arm64
curl -o src-tauri/sidecar/node-macos https://nodejs.org/dist/v20.11.1/node-v20.11.1-darwin-arm64.tar.gz
tar -xzf node-v20.11.1-darwin-arm64.tar.gz
cp node-v20.11.1-darwin-arm64/bin/node src-tauri/sidecar/node-macos

# macOS x64
curl -o src-tauri/sidecar/node-macos-x64 https://nodejs.org/dist/v20.11.1/node-v20.11.1-darwin-x64.tar.gz
tar -xzf node-v20.11.1-darwin-x64.tar.gz
cp node-v20.11.1-darwin-x64/bin/node src-tauri/sidecar/node-macos-x64

# Windows x64
curl -o src-tauri/sidecar/node.exe https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip
unzip node-v20.11.1-win-x64.zip
cp node-v20.11.1-win-x64/node.exe src-tauri/sidecar/node.exe
```

#### Option B2: pkg (Single Binary)

Use `pkg` to bundle Node.js app into a single executable.

**Pros:**
- Single binary (no separate Node.js process)
- Smaller than full Node.js bundle (~30 MB)
- Faster startup

**Cons:**
- Limited Node.js API support (some modules don't work)
- Harder to debug
- Not ideal for long-running HTTP server

**Not recommended** for this use case.

#### Option B3: Nexe (Single Binary)

Similar to `pkg` but with different trade-offs.

**Not recommended** for this use case.

### Option C: Hybrid (Best of Both Worlds)

**Approach:** Try system Node.js first, fall back to bundled if not found.

**Pros:**
- Smaller download for users with Node.js
- Works for users without Node.js
- Flexible deployment

**Cons:**
- More complex code
- Larger download than Option A
- Two code paths to test

**Implementation:**
```rust
let node_path = if let Ok(system_node) = which::which("node") {
  system_node
} else {
  resource_path.join("bundled-node")
};
```

## Recommendation

**For v1 Production: Use Option A (Require System Node.js)**

**Rationale:**
1. Target users (box office staff) likely have IT support
2. Simpler to ship and maintain
3. Faster iteration during early releases
4. Can add bundling later if user feedback indicates need

**For v2+: Consider Option B1 (Bundle Node.js)**

**Rationale:**
1. After validating user base
2. If support burden from Node.js issues is high
3. When app is more stable and Node.js version is locked

## Implementation for Option A

### 1. Add Node.js Version Check

Create `src/node-check.ts`:

```typescript
import { execSync } from "node:child_process";
import { Logger } from "./logger.js";

export function checkNodeVersion(logger: Logger): boolean {
  try {
    const version = execSync("node --version", { encoding: "utf-8" }).trim();
    const majorVersion = parseInt(version.replace("v", "").split(".")[0]);
    
    if (majorVersion < 20) {
      logger.error("node_check", {
        message: `Node.js version ${version} is too old. Requires Node.js 20+`,
        current: version,
        required: "20+"
      });
      return false;
    }
    
    logger.info("node_check", {
      message: "Node.js version check passed",
      version
    });
    return true;
  } catch (error) {
    logger.error("node_check", {
      message: "Node.js not found. Please install Node.js 20+ from https://nodejs.org",
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}
```

### 2. Update lib.rs

```rust
use std::process::Command;

fn check_node_version() -> Result<(), String> {
  match Command::new("node").arg("--version").output() {
    Ok(output) => {
      let version = String::from_utf8_lossy(&output.stdout);
      let major = version.trim().strip_prefix('v')
        .and_then(|v| v.split('.').next())
        .and_then(|n| n.parse::<u32>().ok());
      
      match major {
        Some(n) if n >= 20 => Ok(()),
        Some(n) => Err(format!("Node.js version {}.x is too old. Requires Node.js 20+", n)),
        None => Err("Could not parse Node.js version".to_string()),
      }
    }
    Err(e) => Err(format!("Node.js not found. Please install Node.js 20+ from https://nodejs.org: {}", e))
  }
}

// In setup():
if let Err(e) = check_node_version() {
  eprintln!("{}", e);
  // Don't crash, but log the error
}
```

### 3. Update README.md

```markdown
## Requirements

- **macOS**: 10.13 (High Sierra) or later
- **Windows**: Windows 10 or later
- **Node.js**: 20.x or later ([download](https://nodejs.org))

## Installation

1. Install [Node.js 20+](https://nodejs.org) if not already installed
2. Download the latest release for your platform
3. Install the app
4. Launch from Applications (macOS) or Start Menu (Windows)
```

### 4. Update Dashboard Download Page

Add a note in the dashboard settings page:

```tsx
<div className="text-xs text-muted-foreground">
  Requires Node.js 20+ to be installed on this computer. 
  <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" className="underline">
    Download Node.js
  </a>
</div>
```

## Implementation for Option B1 (Future)

If you decide to bundle Node.js later, follow the steps in the "Option B1: Tauri Sidecar Bundling" section above.

## Size Comparison

| Option | Download Size | Installed Size |
|--------|---------------|----------------|
| A: System Node.js | ~10 MB | ~30 MB |
| B1: Bundle Node.js | ~50 MB | ~100 MB |
| C: Hybrid | ~50 MB | ~100 MB |

## Related

- [`./distribution.md`](./distribution.md) — Build and release process
- [`./tauri-migration-todo.md`](./tauri-migration-todo.md) — Migration tracking
