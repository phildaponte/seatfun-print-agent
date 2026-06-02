import type { Logger } from "../logger.js";
import type { PairingState } from "./state.js";
import type { PrinterProbe } from "../printer/probe.js";

/**
 * Outbound heartbeat to the dashboard. Disabled in v1-lite by default — pass a URL
 * via `SEATFUN_HEARTBEAT_URL` to enable. The dashboard reads agent presence by polling
 * `/v1/status` directly for now. See docs/protocol.md § POST /v1/heartbeat.
 *
 * If the dashboard responds with 401, the agent should clear its pairing state and
 * refuse subsequent print calls until re-paired. v1-lite logs the revocation but does
 * NOT yet wipe the keychain — flagged TODO until the dashboard endpoint is real.
 */

export interface CreateHeartbeatOptions {
  url: string;
  intervalMs: number;
  agentVersion: string;
  pairing: PairingState;
  probe: PrinterProbe;
  logger: Logger;
}

export interface Heartbeat {
  start(): void;
  stop(): void;
}

export function createHeartbeat(opts: CreateHeartbeatOptions): Heartbeat {
  let timer: NodeJS.Timeout | null = null;

  async function beat(): Promise<void> {
    const token = await opts.pairing.getToken();
    if (!token) return; // not paired, nothing to heartbeat about
    const snap = opts.probe.snapshot();
    try {
      const res = await fetch(opts.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          agent_version: opts.agentVersion,
          printer: { reachable: snap.reachable },
        }),
      });
      if (res.status === 401) {
        opts.logger.warn("heartbeat.revoked", { status: 401 });
        // TODO(v1.0): once dashboard endpoint is live, clear pairing here.
        return;
      }
      if (!res.ok) {
        opts.logger.warn("heartbeat.non_ok", { status: res.status });
      }
    } catch (err) {
      opts.logger.debug("heartbeat.network_error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    start() {
      if (timer) return;
      void beat();
      timer = setInterval(() => void beat(), opts.intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
