import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileP = promisify(execFile);

/**
 * Platform-aware secret storage.
 *
 * macOS: macOS Keychain via the `security` CLI (no native module dependency).
 * Linux: chmod-600 JSON file under `~/.config/seatfun-print-agent/` (dev only).
 * Windows: TODO — wire to Credential Manager (`cmdkey` or a keytar-equivalent).
 *          Currently falls back to a chmod-600 file under `%LOCALAPPDATA%`.
 *
 * Stored under service `com.seatfun.print-agent`, account `bearer-token`.
 */

const SERVICE = "com.seatfun.print-agent";
const ACCOUNT = "bearer-token";

function fallbackDir(): string {
  if (process.platform === "win32") {
    const base = process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "SeatfunPrintAgent");
  }
  const xdg = process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config");
  return path.join(xdg, "seatfun-print-agent");
}

function fallbackFile(): string {
  return path.join(fallbackDir(), "secret.json");
}

async function fileGet(): Promise<string | null> {
  try {
    const raw = await fs.readFile(fallbackFile(), "utf8");
    const j = JSON.parse(raw) as { token?: string };
    return typeof j.token === "string" && j.token.length > 0 ? j.token : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function fileSet(token: string): Promise<void> {
  const dir = fallbackDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = fallbackFile();
  await fs.writeFile(file, JSON.stringify({ token }, null, 2), { mode: 0o600 });
  // chmod again in case the file already existed with looser perms.
  await fs.chmod(file, 0o600);
}

async function fileDelete(): Promise<void> {
  try {
    await fs.unlink(fallbackFile());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

async function macGet(): Promise<string | null> {
  try {
    const { stdout } = await execFileP("security", [
      "find-generic-password",
      "-s",
      SERVICE,
      "-a",
      ACCOUNT,
      "-w",
    ]);
    const token = stdout.replace(/\r?\n$/, "");
    return token.length > 0 ? token : null;
  } catch (err) {
    // exit code 44 = not found
    const e = err as { code?: number };
    if (e.code === 44 || e.code === 1) return null;
    throw err;
  }
}

async function macSet(token: string): Promise<void> {
  // -U updates if it exists.
  await execFileP("security", [
    "add-generic-password",
    "-s",
    SERVICE,
    "-a",
    ACCOUNT,
    "-w",
    token,
    "-U",
  ]);
}

async function macDelete(): Promise<void> {
  try {
    await execFileP("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
  } catch (err) {
    const e = err as { code?: number };
    if (e.code === 44 || e.code === 1) return;
    throw err;
  }
}

export type SecretBackend = "macos-keychain" | "file";

export function activeBackend(): SecretBackend {
  return process.platform === "darwin" ? "macos-keychain" : "file";
}

export async function getToken(): Promise<string | null> {
  return activeBackend() === "macos-keychain" ? macGet() : fileGet();
}

export async function setToken(token: string): Promise<void> {
  if (token.length < 16) throw new Error("Refusing to store a suspiciously short token");
  return activeBackend() === "macos-keychain" ? macSet(token) : fileSet(token);
}

export async function deleteToken(): Promise<void> {
  return activeBackend() === "macos-keychain" ? macDelete() : fileDelete();
}
