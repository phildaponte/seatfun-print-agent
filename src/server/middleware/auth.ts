import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export interface AuthResult {
  ok: boolean;
  error?: { code: "unauthorized"; message: string };
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyBearer(req: IncomingMessage, expectedToken: string): AuthResult {
  const header = req.headers["authorization"];
  if (!header || Array.isArray(header)) {
    return { ok: false, error: { code: "unauthorized", message: "Authorization header missing" } };
  }
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) {
    return {
      ok: false,
      error: { code: "unauthorized", message: "Authorization header must be 'Bearer <token>'" },
    };
  }
  const presented = m[1]!.trim();
  if (!constantTimeEquals(presented, expectedToken)) {
    return { ok: false, error: { code: "unauthorized", message: "Bearer token invalid" } };
  }
  return { ok: true };
}
