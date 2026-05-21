/**
 * Manual smoke test against a real BOCA Lemur on the LAN.
 *
 * Usage:
 *   PRINTER_IP=192.168.1.47 npm run smoke
 *
 * Prints one ticket from src/fgl/__golden__/basic.json directly via TCP.
 * Does not go through the HTTP server.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

import { renderTicket } from "../src/fgl/index.js";
import { PrinterClient } from "../src/printer/client.js";
import type { TicketRenderData } from "../src/fgl/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const ip = process.env.PRINTER_IP;
  if (!ip) {
    console.error("Set PRINTER_IP in .env first.");
    process.exit(1);
  }
  const port = Number.parseInt(process.env.PRINTER_PORT ?? "9100", 10);

  const fixturePath = join(__dirname, "..", "src", "fgl", "__golden__", "basic.json");
  const data = JSON.parse(readFileSync(fixturePath, "utf8")) as TicketRenderData;
  data.print_timestamp = new Date().toISOString();

  const fgl = renderTicket(data);
  console.log(`Rendered ${fgl.length} bytes of FGL. Connecting to ${ip}:${port}...`);

  const printer = new PrinterClient({ ip, port });
  const result = await printer.printRaw(fgl);

  if (result.ok) {
    console.log("✓ Printed. Check the printer.");
    process.exit(0);
  } else {
    console.error(`✗ Failed: ${result.errorCode} — ${result.errorText}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
