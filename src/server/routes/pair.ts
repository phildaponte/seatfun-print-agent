import type { IncomingMessage } from "node:http";
import { readJsonBody, type ServerDeps } from "../http.js";
import { extractBearer } from "../middleware/auth.js";

type SendJson = (status: number, body: unknown) => void;
type SendError = (status: number, code: string, message: string) => void;

/**
 * POST /v1/pair — completes the pairing handshake.
 *
 * v1-lite trust model: the dashboard mints a long-lived bearer (server-side via Bubble)
 * and the browser POSTs it here with the token already set in the `Authorization` header.
 * The agent trusts what it receives, persists the token via the OS keychain, and stores
 * the non-secret metadata (`device_id`, `organizer_id`, …) for `/v1/health` to surface.
 *
 * Follow-up (tracked in docs/architecture.md § Pairing): call back to the dashboard
 * (`POST /api/box-office/agent-verify`) to confirm `code` + `token` before storing.
 */

interface PairRequest {
  code: string;
  device_name?: string;
  agent_version?: string;
  platform?: string;
  /**
   * v1-lite extension: dashboard passes device/org context here since we don't
   * call back to verify. Once the verify callback exists, the dashboard will stop
   * sending these and the agent will read them from the verify response instead.
   */
  device_id?: string;
  organizer_id?: string;
  organizer_name?: string;
}

function isPairRequest(v: unknown): v is PairRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r["code"] === "string" && r["code"].length > 0;
}

export async function handlePair(
  deps: ServerDeps,
  req: IncomingMessage,
  sendJson: SendJson,
  sendError: SendError,
  requestId: string,
): Promise<void> {
  const { pairing, logger } = deps;

  const { token } = extractBearer(req);
  if (!token) {
    sendError(401, "unauthorized", "Pairing requires the long-lived bearer in Authorization");
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendError(400, "invalid_request", err instanceof Error ? err.message : "bad body");
    return;
  }
  if (!isPairRequest(body)) {
    sendError(400, "invalid_request", "Body must include { code: string }");
    return;
  }

  try {
    await pairing.setPaired(token, {
      device_id: body.device_id ?? null,
      organizer_id: body.organizer_id ?? null,
      organizer_name: body.organizer_name ?? null,
      device_name: body.device_name ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("pair.persist_failed", { request_id: requestId, error: msg });
    sendError(500, "internal_error", `Failed to persist pairing: ${msg}`);
    return;
  }

  const meta = pairing.getMetadata();
  logger.info("pair.success", {
    request_id: requestId,
    device_id: meta.device_id,
    organizer_id: meta.organizer_id,
    token_fingerprint: pairing.tokenFingerprint(),
  });

  sendJson(200, {
    device_id: meta.device_id,
    organizer_id: meta.organizer_id,
    organizer_name: meta.organizer_name,
    token_fingerprint: pairing.tokenFingerprint(),
  });
}
