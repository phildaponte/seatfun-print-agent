import type { IncomingMessage } from "node:http";
import type { TicketRenderData } from "../../fgl/index.js";
import { readJsonBody, type ServerDeps } from "../http.js";
import { runPrintJob, type PrintJobInput } from "../jobs/runPrintJob.js";

type SendJson = (status: number, body: unknown) => void;
type SendError = (status: number, code: string, message: string) => void;

interface PrintJobRequest {
  job_id: string;
  reason: "bulk" | "walkup" | "reprint" | "reissue";
  tickets: Array<{ ticket_id: string; fields: TicketRenderData }>;
  options?: { copies?: number; abort_on_first_error?: boolean };
}

function isPrintJobRequest(v: unknown): v is PrintJobRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["job_id"] === "string" &&
    typeof r["reason"] === "string" &&
    Array.isArray(r["tickets"]) &&
    (r["tickets"] as unknown[]).every(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as Record<string, unknown>)["ticket_id"] === "string" &&
        typeof (t as Record<string, unknown>)["fields"] === "object",
    )
  );
}

export async function handlePrint(
  deps: ServerDeps,
  req: IncomingMessage,
  sendJson: SendJson,
  sendError: SendError,
  requestId: string,
): Promise<void> {
  const { logger, printer } = deps;

  if (!printer) {
    sendError(503, "printer_unreachable", "Printer not configured. Set PRINTER_IP and restart.");
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendError(400, "invalid_request", err instanceof Error ? err.message : "bad body");
    return;
  }
  if (!isPrintJobRequest(body)) {
    sendError(400, "invalid_request", "Body does not match PrintJobRequest shape");
    return;
  }

  const job: PrintJobInput = body;
  const out = await runPrintJob({ printer, logger, requestId, job });

  // Log the first error for debugging
  const firstErr = out.results.find((r) => r.result === "error");
  if (firstErr) {
    logger.error("print_job.first_error", {
      request_id: requestId,
      job_id: job.job_id,
      error_code: firstErr.error_code,
      error_text: firstErr.error_text,
      ticket_id: firstErr.ticket_id,
    });
  }

  sendJson(out.status, {
    job_id: out.job_id,
    started_at: out.started_at,
    finished_at: out.finished_at,
    results: out.results,
  });
}
