import { renderTicket, RenderError } from "../../fgl/index.js";
import type { TicketRenderData } from "../../fgl/index.js";
import type { PrinterClient } from "../../printer/client.js";
import type { Logger } from "../../logger.js";

/**
 * Shared print-job runner. Used by both POST /v1/print and POST /v1/test-print so they
 * share identical batch semantics (sequential render → TCP write → 50ms gap → next).
 */

export interface PrintJobInput {
  job_id: string;
  reason: "bulk" | "walkup" | "reprint" | "reissue" | "test";
  tickets: Array<{ ticket_id: string; fields: TicketRenderData }>;
  options?: { copies?: number; abort_on_first_error?: boolean };
}

export interface PerTicketResult {
  ticket_id: string;
  result: "ok" | "error";
  printed_at?: string;
  printer_serial?: string;
  error_code?: string;
  error_text?: string;
}

export interface PrintJobOutput {
  job_id: string;
  started_at: string;
  finished_at: string;
  results: PerTicketResult[];
  /** HTTP status the route should return: 200 (all ok), 207 (partial), 502 (none ok). */
  status: 200 | 207 | 502;
}

const STOP_BATCH_ON: ReadonlySet<string> = new Set([
  "printer_unreachable",
  "printer_timeout",
  "printer_paper_out",
  "printer_head_up",
  "printer_jam",
]);

const INTER_TICKET_GAP_MS = 50;

export async function runPrintJob(deps: {
  printer: PrinterClient;
  logger: Logger;
  requestId: string;
  job: PrintJobInput;
}): Promise<PrintJobOutput> {
  const { printer, logger, requestId, job } = deps;
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

  for (let i = 0; i < job.tickets.length; i++) {
    const ticket = job.tickets[i]!;
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
      logger.info("print_ticket.fgl", {
        request_id: requestId,
        ticket_id: ticket.ticket_id,
        fgl_length: fgl.length,
        fgl_full: fgl,
      });
    } catch (err) {
      const msg =
        err instanceof RenderError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
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

    if (!stopRemaining && i < job.tickets.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_TICKET_GAP_MS));
    }
  }

  const finishedAt = new Date().toISOString();
  const anyOk = results.some((r) => r.result === "ok");
  const anyErr = results.some((r) => r.result === "error");
  let status: 200 | 207 | 502 = 200;
  if (anyErr && anyOk) status = 207;
  else if (anyErr && !anyOk) status = 502;

  logger.info("print_job.done", {
    request_id: requestId,
    job_id: job.job_id,
    status,
    ok_count: results.filter((r) => r.result === "ok").length,
    err_count: results.filter((r) => r.result === "error").length,
  });

  return { job_id: job.job_id, started_at: startedAt, finished_at: finishedAt, results, status };
}
