import "dotenv/config";

export interface AgentConfig {
  host: string;
  port: number;
  /**
   * Dev-only token override. When set, this bearer takes the place of the keychain-
   * stored one and `/v1/pair` is disabled. Used by `npm run smoke` and integration tests.
   */
  envToken: string | null;
  printerIp: string | null;
  printerPort: number;
  logLevel: "debug" | "info" | "warn" | "error";
  agentVersion: string;
  protocolVersion: string;
  /** Browser origins allowed by CORS. Loopback CLI clients (curl) don't need this. */
  allowedOrigins: string[];
  /** Outbound heartbeat URL on the dashboard (scaffolded but disabled in v1-lite). */
  heartbeatUrl: string | null;
  heartbeatIntervalMs: number;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

const DEFAULT_ALLOWED_ORIGINS = [
  "https://app.seatfun.com",
  "http://localhost:3000",
  "tauri://localhost", // Tauri webview origin for tray windows
];

export function loadConfig(): AgentConfig {
  const rawOrigins = process.env["SEATFUN_ALLOWED_ORIGINS"];
  const allowedOrigins = rawOrigins
    ? rawOrigins.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    : DEFAULT_ALLOWED_ORIGINS;

  return {
    host: optional("SEATFUN_AGENT_HOST", "127.0.0.1"),
    port: Number.parseInt(optional("SEATFUN_AGENT_PORT", "9787"), 10),
    envToken: process.env["SEATFUN_AGENT_TOKEN"]?.trim() || null,
    printerIp: process.env["PRINTER_IP"] || null,
    printerPort: Number.parseInt(optional("PRINTER_PORT", "9100"), 10),
    logLevel: optional("LOG_LEVEL", "info") as AgentConfig["logLevel"],
    agentVersion: "0.1.0",
    protocolVersion: "1",
    allowedOrigins,
    heartbeatUrl: process.env["SEATFUN_HEARTBEAT_URL"]?.trim() || null,
    heartbeatIntervalMs: Number.parseInt(optional("SEATFUN_HEARTBEAT_INTERVAL_MS", "60000"), 10),
  };
}
