import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AgentConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { PrinterClient } from "../printer/client.js";
import type { PrinterProbe } from "../printer/probe.js";
import type { PairingState } from "../pairing/state.js";
import { handleHealth } from "./routes/health.js";
import { handlePrint } from "./routes/print.js";
import { handleStatus } from "./routes/status.js";
import { handleTestPrint } from "./routes/test-print.js";
import { handlePair } from "./routes/pair.js";
import { verifyBearer } from "./middleware/auth.js";
import { applyCorsHeaders, handlePreflight, type CorsConfig } from "./middleware/cors.js";

export interface ServerDeps {
  config: AgentConfig;
  logger: Logger;
  printer: PrinterClient | null;
  probe: PrinterProbe;
  pairing: PairingState;
  cors: CorsConfig;
  startedAt: number;
}

/**
 * Route map. `auth: true` means the bearer is required (verified against the pairing
 * state's stored token). `/v1/pair` does its own auth (it accepts whatever bearer is
 * pasted in and stores it), so it's marked `auth: false` here.
 */
const ROUTES: Array<{ key: string; auth: boolean }> = [
  { key: "GET /v1/health", auth: false },
  { key: "POST /v1/pair", auth: false },
  { key: "GET /v1/status", auth: true },
  { key: "POST /v1/print", auth: true },
  { key: "POST /v1/test-print", auth: true },
];

export function createServer(deps: ServerDeps): http.Server {
  const { logger, pairing, cors } = deps;

  return http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const route = `${req.method ?? "GET"} ${(req.url ?? "/").split("?")[0]}`;
    const start = Date.now();

    // CORS preflight short-circuits everything else.
    if (handlePreflight(cors, req, res)) {
      logger.debug("preflight", { request_id: requestId, route, origin: req.headers["origin"] });
      return;
    }
    applyCorsHeaders(cors, req, res);

    const sendJson = (status: number, body: unknown): void => {
      const payload = JSON.stringify(body);
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("content-length", Buffer.byteLength(payload, "utf8"));
      res.setHeader("x-request-id", requestId);
      res.writeHead(status);
      res.end(payload);
      logger.info("request", {
        request_id: requestId,
        route,
        status,
        latency_ms: Date.now() - start,
      });
    };

    const sendError = (status: number, code: string, message: string): void => {
      sendJson(status, { error: { code, message, request_id: requestId } });
    };

    try {
      const entry = ROUTES.find((r) => r.key === route);
      if (!entry) {
        sendError(404, "not_found", `Unknown route: ${route}`);
        return;
      }
      if (entry.auth) {
        const auth = verifyBearer(req, pairing.getCachedToken());
        if (!auth.ok) {
          sendError(401, auth.error!.code, auth.error!.message);
          return;
        }
      }

      switch (route) {
        case "GET /v1/health":
          await handleHealth(deps, sendJson);
          return;
        case "POST /v1/pair":
          await handlePair(deps, req, sendJson, sendError, requestId);
          return;
        case "GET /v1/status":
          await handleStatus(deps, sendJson);
          return;
        case "POST /v1/print":
          await handlePrint(deps, req, sendJson, sendError, requestId);
          return;
        case "POST /v1/test-print":
          await handleTestPrint(deps, sendJson, sendError, requestId);
          return;
        default:
          sendError(404, "not_found", `Unknown route: ${route}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("unhandled", { request_id: requestId, route, error: msg });
      sendError(500, "internal_error", msg);
    }
  });
}

export async function readJsonBody(req: http.IncomingMessage, maxBytes = 5_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const buf = Buffer.concat(chunks);
        if (buf.length === 0) {
          resolve({});
          return;
        }
        resolve(JSON.parse(buf.toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
