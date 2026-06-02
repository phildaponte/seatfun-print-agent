import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export type AuthErrorCode = "unauthorized" | "not_paired";

export interface AuthResult {
  ok: boolean;
  error?: { code: AuthErrorCode; message: string };
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Extract the bearer string from an `Authorization: Bearer <token>` header. */
export function extractBearer(req: IncomingMessage): { token: string | null; reason?: string } {
  const header = req.headers["authorization"];
  if (!header || Array.isArray(header)) {
    return { token: null, reason: "Authorization header missing" };
  }
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return { token: null, reason: "Authorization header must be 'Bearer <token>'" };
  const presented = m[1]!.trim();
  if (presented.length === 0) return { token: null, reason: "Empty bearer token" };
  return { token: presented };
}

/**
 * Verify a request's bearer against the expected token (from pairing state).
 * If `expectedToken` is null, the agent isn't paired yet — return `not_paired` so the
 * dashboard can surface the right CTA.
 */
export function verifyBearer(req: IncomingMessage, expectedToken: string | null): AuthResult {
  if (!expectedToken) {
    return {
      ok: false,
      error: {
        code: "not_paired",
        message: "Agent is not paired. Complete pairing from the dashboard first.",
      },
    };
  }
  const { token, reason } = extractBearer(req);
  if (!token) {
    return { ok: false, error: { code: "unauthorized", message: reason ?? "Unauthorized" } };
  }
  if (!constantTimeEquals(token, expectedToken)) {
    return { ok: false, error: { code: "unauthorized", message: "Bearer token invalid" } };
  }
  return { ok: true };
}
