import type { PrinterClient } from "./client.js";

/**
 * Background printer-reachability probe.
 *
 * Periodically opens a TCP connect to the printer and caches the result, so
 * `/v1/health` and `/v1/status` return a constant-time answer no matter how
 * often the dashboard polls.
 *
 * v1-lite only reports `reachable`. Parsing real BOCA status (model, firmware,
 * serial, paper-out flags, etc.) is deferred — see `docs/protocol.md` § Status.
 */

export interface ProbeSnapshot {
  reachable: boolean;
  last_status_at: string | null;
  last_error: string | null;
}

export interface PrinterProbe {
  start(): void;
  stop(): void;
  snapshot(): ProbeSnapshot;
  /** Force an immediate refresh (used by /v1/status when staleness > threshold). */
  refresh(): Promise<ProbeSnapshot>;
}

export interface CreateProbeOptions {
  printer: PrinterClient | null;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 10_000;

export function createPrinterProbe(opts: CreateProbeOptions): PrinterProbe {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let timer: NodeJS.Timeout | null = null;
  let snapshot: ProbeSnapshot = {
    reachable: false,
    last_status_at: null,
    last_error: opts.printer ? null : "printer_not_configured",
  };
  let inFlight: Promise<ProbeSnapshot> | null = null;

  async function probeOnce(): Promise<ProbeSnapshot> {
    if (!opts.printer) {
      snapshot = {
        reachable: false,
        last_status_at: new Date().toISOString(),
        last_error: "printer_not_configured",
      };
      return snapshot;
    }
    try {
      const ok = await opts.printer.ping();
      snapshot = {
        reachable: ok,
        last_status_at: new Date().toISOString(),
        last_error: ok ? null : "printer_unreachable",
      };
    } catch (err) {
      snapshot = {
        reachable: false,
        last_status_at: new Date().toISOString(),
        last_error: err instanceof Error ? err.message : String(err),
      };
    }
    return snapshot;
  }

  return {
    start() {
      if (timer) return;
      // Kick off an immediate probe so the first request gets a real answer.
      void probeOnce();
      timer = setInterval(() => {
        void probeOnce();
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    snapshot() {
      return snapshot;
    },
    refresh() {
      if (!inFlight) {
        inFlight = probeOnce().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}
