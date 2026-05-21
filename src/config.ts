import "dotenv/config";

export interface AgentConfig {
  host: string;
  port: number;
  token: string;
  printerIp: string | null;
  printerPort: number;
  logLevel: "debug" | "info" | "warn" | "error";
  agentVersion: string;
  protocolVersion: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

export function loadConfig(): AgentConfig {
  return {
    host: optional("SEATFUN_AGENT_HOST", "127.0.0.1"),
    port: Number.parseInt(optional("SEATFUN_AGENT_PORT", "9787"), 10),
    token: required("SEATFUN_AGENT_TOKEN"),
    printerIp: process.env.PRINTER_IP || null,
    printerPort: Number.parseInt(optional("PRINTER_PORT", "9100"), 10),
    logLevel: (optional("LOG_LEVEL", "info") as AgentConfig["logLevel"]),
    agentVersion: "0.0.1",
    protocolVersion: "1",
  };
}
