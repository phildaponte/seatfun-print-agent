import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * CORS handling for the agent.
 *
 * The agent is loopback-only (127.0.0.1). The dashboard runs on `https://app.seatfun.com`
 * (and friends) — modern browsers explicitly allow https→http loopback calls, so the
 * only blocker is CORS. We never use `*` because the request carries an `Authorization`
 * header; we always echo the matching origin and emit `Vary: Origin`.
 *
 * Allowed origins come from `SEATFUN_ALLOWED_ORIGINS` (CSV). Unknown origins are still
 * served (so curl / non-browser clients work) but with no CORS headers attached.
 */

export interface CorsConfig {
  allowedOrigins: ReadonlySet<string>;
}

const ALLOWED_HEADERS = "Authorization, Content-Type";
const ALLOWED_METHODS = "GET, POST, OPTIONS";
const MAX_AGE = "600";

function originAllowed(cfg: CorsConfig, origin: string | undefined): boolean {
  if (!origin) return false;
  return cfg.allowedOrigins.has(origin);
}

/** Apply CORS headers to a response, if the origin is allowed. */
export function applyCorsHeaders(cfg: CorsConfig, req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers["origin"];
  res.setHeader("Vary", "Origin");
  if (typeof origin === "string" && originAllowed(cfg, origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
    res.setHeader("Access-Control-Max-Age", MAX_AGE);
  }
}

/**
 * Handle an OPTIONS preflight. Returns true if the request was a preflight and the
 * response has been sent — caller should stop processing.
 */
export function handlePreflight(
  cfg: CorsConfig,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (req.method !== "OPTIONS") return false;
  applyCorsHeaders(cfg, req, res);
  res.writeHead(204);
  res.end();
  return true;
}

export function parseAllowedOrigins(csv: string | undefined): Set<string> {
  if (!csv) return new Set<string>();
  return new Set(
    csv
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}
