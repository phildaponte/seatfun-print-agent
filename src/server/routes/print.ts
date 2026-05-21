import type { IncomingMessage } from "node:http";
import { renderTicket, RenderError } from "../../fgl/index.js";
import type { TicketRenderData } from "../../fgl/index.js";
import { readJsonBody, type ServerDeps } from "../http.js";

type SendJson = (status: number, body: unknown) => void;
type SendError = (status: number, code: string, message: string) => void;

interface PrintJobRequest {
  job_id: string;
  reason: "bulk" | "walkup" | "reprint" | "reissue";
  tickets: Array<{ ticket_id: string; fields: TicketRenderData }>;
  options?: { copies?: number; abort_on_first_error?: boolean };
}

interface PerTicketResult {
  ticket_id: string;
  result: "ok" | "error";
  printed_at?: string;
  printer_serial?: string;
  error_code?: string;
  error_text?: string;
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

const STOP_BATCH_ON: ReadonlySet<string> = new Set([
  "printer_unreachable",
  "printer_timeout",
  "printer_paper_out",
  "printer_head_up",
  "printer_jam",
]);

const INTER_TICKET_GAP_MS = 50;

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

  const job = body;
  const copies = job.options?.copies ?? 1;
  const abortOnFirstError = job.options?.abort_on_first_error ?? false;
  const startedAt = new Date().toISOString();
  const results: PerTicketResult[] = [];
  let stopRemaining = false;

  logger.info("print_job.start", {
    request_id: requestId,
    job_id: job.job_id,
    reason: job.reason,
    ticket_count: job.tickets.length,
    copies,
  });

  for (const ticket of job.tickets) {
    if (stopRemaining) {
      results.push({
        ticket_id: ticket.ticket_id,
        result: "error",
        error_code: "aborted",
        error_text: "Batch aborted due to earlier failure",
      });
      continue;
    }

    let fgl: string;
    try {
      fgl = renderTicket(ticket.fields);
    } catch (err) {
      const msg = err instanceof RenderError ? err.message : err instanceof Error ? err.message : String(err);
      results.push({
        ticket_id: ticket.ticket_id,
        result: "error",
        error_code: "render_error",
        error_text: msg,
      });
      if (abortOnFirstError) stopRemaining = true;
      continue;
    }

    let lastResult: PerTicketResult | null = null;
    for (let copy = 0; copy < copies; copy++) {
      const printResult = await printer.printRaw(fgl);
      if (printResult.ok) {
        lastResult = {
          ticket_id: ticket.ticket_id,
          result: "ok",
          printed_at: new Date().toISOString(),
          ...(printResult.printerSerial ? { printer_serial: printResult.printerSerial } : {}),
        };
      } else {
        lastResult = {
          ticket_id: ticket.ticket_id,
          result: "error",
          error_code: printResult.errorCode ?? "printer_unknown",
          error_text: printResult.errorText ?? "Unknown printer error",
        };
        if (STOP_BATCH_ON.has(lastResult.error_code!) || abortOnFirstError) {
          stopRemaining = true;
        }
        break;
      }
      if (copy < copies - 1) {
        await new Promise((r) => setTimeout(r, INTER_TICKET_GAP_MS));
      }
    }
    if (lastResult) results.push(lastResult);

    if (!stopRemaining && job.tickets.indexOf(ticket) < job.tickets.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_TICKET_GAP_MS));
    }
  }

  const finishedAt = new Date().toISOString();
  const anyOk = results.some((r) => r.result === "ok");
  const anyErr = results.some((r) => r.result === "error");
  let status = 200;
  if (anyErr && anyOk) status = 207;
  else if (anyErr && !anyOk) status = 502;

  logger.info("print_job.done", {
    request_id: requestId,
    job_id: job.job_id,
    status,
    ok_count: results.filter((r) => r.result === "ok").length,
    err_count: results.filter((r) => r.result === "error").length,
  });

  sendJson(status, {
    job_id: job.job_id,
    started_at: startedAt,
    finished_at: finishedAt,
    results,
  });
}
