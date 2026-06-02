import type { ServerDeps } from "../http.js";

type SendJson = (status: number, body: unknown) => void;

/**
 * GET /v1/status — auth'd. Detailed printer + queue + agent status. Polled by the
 * dashboard's box-office page every ~12s to render the "Printer Online" badge.
 *
 * v1-lite only fills `reachable` from the background probe. Real BOCA status flags
 * (paper_out / head_up / jam / low_paper, model, firmware, serial) require parsing
 * FGL status responses and are deferred — see docs/protocol.md § Status.
 */

export async function handleStatus(deps: ServerDeps, sendJson: SendJson): Promise<void> {
  const { config, probe, startedAt } = deps;
  const snap = probe.snapshot();

  sendJson(200, {
    printer: {
      ip: config.printerIp,
      reachable: snap.reachable,
      model: null,
      firmware: null,
      serial: null,
      flags: {
        paper_out: false,
        head_up: false,
        jam: false,
        low_paper: false,
      },
      last_status_at: snap.last_status_at,
    },
    queue: {
      in_flight: 0,
      pending: 0,
    },
    agent: {
      version: config.agentVersion,
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    },
  });
}
