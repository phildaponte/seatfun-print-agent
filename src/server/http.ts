import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AgentConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { PrinterClient } from "../printer/client.js";
import { handleHealth } from "./routes/health.js";
import { handlePrint } from "./routes/print.js";
import { verifyBearer } from "./middleware/auth.js";

export interface ServerDeps {
  config: AgentConfig;
  logger: Logger;
  printer: PrinterClient | null;
}

const PROTECTED_ROUTES = new Set<string>(["POST /v1/print"]);

export function createServer(deps: ServerDeps): http.Server {
  const { config, logger } = deps;

  return http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const route = `${req.method ?? "GET"} ${(req.url ?? "/").split("?")[0]}`;
    const start = Date.now();

    const sendJson = (status: number, body: unknown): void => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload, "utf8"),
        "x-request-id": requestId,
      });
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
      if (PROTECTED_ROUTES.has(route)) {
        const auth = verifyBearer(req, config.token);
        if (!auth.ok) {
          sendError(401, auth.error!.code, auth.error!.message);
          return;
        }
      }

      if (route === "GET /v1/health") {
        await handleHealth(deps, sendJson);
        return;
      }

      if (route === "POST /v1/print") {
        await handlePrint(deps, req, sendJson, sendError, requestId);
        return;
      }

      sendError(404, "not_found", `Unknown route: ${route}`);
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
