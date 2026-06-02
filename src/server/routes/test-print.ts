import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerDeps } from "../http.js";
import { runPrintJob, type PrintJobInput } from "../jobs/runPrintJob.js";

type SendJson = (status: number, body: unknown) => void;
type SendError = (status: number, code: string, message: string) => void;

/**
 * POST /v1/test-print — prints the bundled golden ticket through the same job runner
 * as /v1/print. No body required. Used by the dashboard's "Test print" button on the
 * box-office settings page.
 *
 * Fixture is `fixtures/sample-job.json` at the repo root; it ships with the agent so
 * it's available no matter the install location.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server/routes  -> ../../../fixtures/sample-job.json
// src/server/routes   -> ../../../fixtures/sample-job.json
const FIXTURE_PATH = path.resolve(here, "../../../fixtures/sample-job.json");

export async function handleTestPrint(
  deps: ServerDeps,
  sendJson: SendJson,
  sendError: SendError,
  requestId: string,
): Promise<void> {
  const { logger, printer } = deps;

  if (!printer) {
    sendError(503, "printer_unreachable", "Printer not configured. Set PRINTER_IP and restart.");
    return;
  }

  let fixture: PrintJobInput;
  try {
    const raw = await fs.readFile(FIXTURE_PATH, "utf8");
    fixture = JSON.parse(raw) as PrintJobInput;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("test_print.fixture_missing", { request_id: requestId, error: msg });
    sendError(500, "internal_error", `Test-print fixture unavailable: ${msg}`);
    return;
  }

  const job: PrintJobInput = {
    ...fixture,
    job_id: `test_${Date.now()}`,
    reason: "test",
  };

  const out = await runPrintJob({ printer, logger, requestId, job });
  sendJson(out.status, {
    job_id: out.job_id,
    started_at: out.started_at,
    finished_at: out.finished_at,
    results: out.results,
  });
}
