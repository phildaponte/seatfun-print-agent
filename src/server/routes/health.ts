import type { ServerDeps } from "../http.js";

type SendJson = (status: number, body: unknown) => void;

/**
 * GET /v1/health — no auth. Cheap liveness + pairing/printer summary.
 * Reads from the cached background probe so polling never opens new TCP sockets.
 */
export async function handleHealth(deps: ServerDeps, sendJson: SendJson): Promise<void> {
  const { config, pairing, probe } = deps;
  const snap = probe.snapshot();
  const meta = pairing.getMetadata();

  sendJson(200, {
    ok: true,
    agent_version: config.agentVersion,
    protocol_version: config.protocolVersion,
    paired: pairing.isPaired(),
    // Non-secret identity of the device this agent is paired to. Lets the
    // dashboard fetch the bearer matching THIS machine (loopback correctness
    // when an organizer has multiple paired stations). The token itself is
    // never exposed here — only the public identifiers.
    device: {
      device_id: meta.device_id,
      organizer_id: meta.organizer_id,
      device_name: meta.device_name,
    },
    printer: {
      configured: Boolean(config.printerIp),
      ip: config.printerIp,
      reachable: snap.reachable,
      last_status_at: snap.last_status_at,
      // Serial/model/firmware require an FGL status query — deferred (see protocol.md).
      serial: null,
      model: null,
      firmware: null,
    },
  });
}
