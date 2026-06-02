import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { activeBackend, deleteToken, getToken, setToken } from "./keychain.js";

/**
 * Pairing state — bearer token (in keychain) + non-secret device metadata (in a json file).
 *
 * The token itself is stored via `keychain.ts`; everything else is stored alongside in
 * a chmod-600 JSON file under the platform app-data dir. Both the token and the metadata
 * are wiped together by `clear()`.
 *
 * v1-lite trust model: the dashboard mints a long-lived bearer (via Vercel) and posts it
 * to `/v1/pair` with the token already set in the `Authorization` header. The agent
 * trusts the pasted token (no callback verification). A v1.0 follow-up will call back to
 * the dashboard to verify before storing. See `docs/protocol.md` and
 * `docs/architecture.md` § Pairing.
 */

export interface PairingMetadata {
  device_id: string | null;
  organizer_id: string | null;
  organizer_name: string | null;
  device_name: string | null;
  paired_at: string | null;
}

const EMPTY_METADATA: PairingMetadata = {
  device_id: null,
  organizer_id: null,
  organizer_name: null,
  device_name: null,
  paired_at: null,
};

function appDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "SeatfunPrintAgent");
  }
  if (process.platform === "win32") {
    const base = process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "SeatfunPrintAgent");
  }
  const xdg = process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config");
  return path.join(xdg, "seatfun-print-agent");
}

function metadataFile(): string {
  return path.join(appDataDir(), "pairing.json");
}

async function readMetadata(): Promise<PairingMetadata> {
  try {
    const raw = await fs.readFile(metadataFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PairingMetadata>;
    return { ...EMPTY_METADATA, ...parsed };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_METADATA };
    throw err;
  }
}

async function writeMetadata(meta: PairingMetadata): Promise<void> {
  const dir = appDataDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(metadataFile(), JSON.stringify(meta, null, 2), { mode: 0o600 });
  await fs.chmod(metadataFile(), 0o600);
}

export interface PairingState {
  /** Returns the bearer token to expect on protected requests, or null if not paired. */
  getToken(): Promise<string | null>;
  /** Cached synchronous accessor — populated on `init()` and `setPaired()`. */
  getCachedToken(): string | null;
  getMetadata(): PairingMetadata;
  isPaired(): boolean;
  init(): Promise<void>;
  setPaired(token: string, meta: Partial<PairingMetadata>): Promise<void>;
  clear(): Promise<void>;
  tokenFingerprint(): string | null;
}

export interface CreatePairingStateOptions {
  /** Dev/smoke override: if set, this token is used instead of the keychain. */
  envToken?: string | null;
}

export function createPairingState(opts: CreatePairingStateOptions = {}): PairingState {
  let cachedToken: string | null = null;
  let cachedMetadata: PairingMetadata = { ...EMPTY_METADATA };
  let envOverride: boolean = false;

  return {
    async init() {
      cachedMetadata = await readMetadata();
      if (opts.envToken && opts.envToken.length > 0) {
        cachedToken = opts.envToken;
        envOverride = true;
      } else {
        cachedToken = await getToken();
        envOverride = false;
      }
    },
    async getToken() {
      if (cachedToken !== null) return cachedToken;
      cachedToken = await getToken();
      return cachedToken;
    },
    getCachedToken() {
      return cachedToken;
    },
    getMetadata() {
      return cachedMetadata;
    },
    isPaired() {
      return Boolean(cachedToken);
    },
    async setPaired(token, meta) {
      if (envOverride) {
        // Don't overwrite an env-set dev token via the pair endpoint.
        throw new Error("Cannot pair while SEATFUN_AGENT_TOKEN env override is set");
      }
      await setToken(token);
      const next: PairingMetadata = {
        ...cachedMetadata,
        ...meta,
        paired_at: new Date().toISOString(),
      };
      await writeMetadata(next);
      cachedToken = token;
      cachedMetadata = next;
    },
    async clear() {
      if (envOverride) throw new Error("Cannot clear pairing while SEATFUN_AGENT_TOKEN is set");
      await deleteToken();
      cachedMetadata = { ...EMPTY_METADATA };
      try {
        await fs.unlink(metadataFile());
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      cachedToken = null;
    },
    tokenFingerprint() {
      if (!cachedToken) return null;
      const hash = createHash("sha256").update(cachedToken, "utf8").digest("hex");
      return `sha256:${hash.slice(0, 16)}`;
    },
  };
}

export { activeBackend };
