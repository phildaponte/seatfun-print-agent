import type { ServerDeps } from "../http.js";

type SendJson = (status: number, body: unknown) => void;

export async function handleHealth(deps: ServerDeps, sendJson: SendJson): Promise<void> {
  const { config, printer } = deps;
  let reachable = false;
  if (printer) {
    try {
      reachable = await printer.ping();
    } catch {
      reachable = false;
    }
  }

  sendJson(200, {
    ok: true,
    agent_version: config.agentVersion,
    protocol_version: config.protocolVersion,
    paired: Boolean(config.token), // v0: token from env counts as "paired"
    printer: {
      configured: Boolean(config.printerIp),
      ip: config.printerIp,
      reachable,
      last_status_at: new Date().toISOString(),
      // Serial/model/firmware require an FGL status query — deferred to v1.
      serial: null,
      model: null,
      firmware: null,
    },
  });
}
