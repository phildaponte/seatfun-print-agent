import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { PrinterClient } from "./printer/client.js";
import { createPrinterProbe } from "./printer/probe.js";
import { createServer } from "./server/http.js";
import { createPairingState, activeBackend } from "./pairing/state.js";
import { createHeartbeat } from "./pairing/heartbeat.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const startedAt = Date.now();

  const printer = config.printerIp
    ? new PrinterClient({ ip: config.printerIp, port: config.printerPort })
    : null;

  if (!printer) {
    logger.warn("printer_not_configured", {
      hint: "Set PRINTER_IP in .env (printer self-test ticket has the IP).",
    });
  }

  const pairing = createPairingState({ envToken: config.envToken });
  await pairing.init();

  if (!pairing.isPaired()) {
    logger.warn("agent.unpaired", {
      hint: "POST /v1/pair from the dashboard, or set SEATFUN_AGENT_TOKEN for dev.",
      secret_backend: activeBackend(),
    });
  }

  const probe = createPrinterProbe({ printer });
  probe.start();

  const heartbeat = config.heartbeatUrl
    ? createHeartbeat({
        url: config.heartbeatUrl,
        intervalMs: config.heartbeatIntervalMs,
        agentVersion: config.agentVersion,
        pairing,
        probe,
        logger,
      })
    : null;
  heartbeat?.start();

  const server = createServer({
    config,
    logger,
    printer,
    probe,
    pairing,
    cors: { allowedOrigins: new Set(config.allowedOrigins) },
    startedAt,
  });

  server.listen(config.port, config.host, () => {
    logger.info("agent.listening", {
      host: config.host,
      port: config.port,
      agent_version: config.agentVersion,
      protocol_version: config.protocolVersion,
      printer_configured: Boolean(printer),
      paired: pairing.isPaired(),
      secret_backend: activeBackend(),
      allowed_origins: config.allowedOrigins,
      heartbeat_enabled: Boolean(heartbeat),
    });
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info("agent.shutdown", { signal });
    probe.stop();
    heartbeat?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: "error", msg: "fatal", error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
