import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { PrinterClient } from "./printer/client.js";
import { createServer } from "./server/http.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const printer = config.printerIp
    ? new PrinterClient({ ip: config.printerIp, port: config.printerPort })
    : null;

  if (!printer) {
    logger.warn("printer_not_configured", {
      hint: "Set PRINTER_IP in .env (printer self-test ticket has the IP).",
    });
  }

  const server = createServer({ config, logger, printer });

  server.listen(config.port, config.host, () => {
    logger.info("agent.listening", {
      host: config.host,
      port: config.port,
      agent_version: config.agentVersion,
      protocol_version: config.protocolVersion,
      printer_configured: Boolean(printer),
    });
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info("agent.shutdown", { signal });
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
