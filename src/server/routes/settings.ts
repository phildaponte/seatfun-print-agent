import type { IncomingMessage } from "node:http";
import type { ServerDeps } from "../http.js";
import { readJsonBody } from "../http.js";

type SendJson = (status: number, body: unknown) => void;
type SendError = (status: number, code: string, message: string) => void;

interface SettingsResponse {
  printer_ip: string;
}

interface SettingsRequest {
  printer_ip?: string;
}

/**
 * GET /v1/settings — no auth. Returns current printer configuration.
 * Used by the settings UI to display the currently configured printer IP.
 */
export async function handleGetSettings(
  deps: ServerDeps,
  sendJson: SendJson,
): Promise<void> {
  const { config } = deps;

  sendJson(200, {
    printer_ip: config.printerIp || "",
  } as SettingsResponse);
}

/**
 * POST /v1/settings — no auth. Saves printer configuration to .env file.
 * Used by the settings UI to update the printer IP.
 */
export async function handlePostSettings(
  deps: ServerDeps,
  req: IncomingMessage,
  sendJson: SendJson,
  sendError: SendError,
): Promise<void> {
  const { logger } = deps;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendError(400, "invalid_request", err instanceof Error ? err.message : "bad body");
    return;
  }

  const { printer_ip } = body as SettingsRequest;

  if (printer_ip === undefined) {
    sendError(400, "invalid_request", "Missing printer_ip field");
    return;
  }

  // Write to .env file
  const fs = await import("node:fs");
  const path = await import("node:path");
  const envPath = path.join(process.cwd(), ".env");

  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf-8");
  }

  const lines = content.split("\n");
  let found = false;
  const newLines = lines.map((line: string) => {
    if (line.startsWith("PRINTER_IP=")) {
      found = true;
      return `PRINTER_IP=${printer_ip}`;
    }
    return line;
  });

  if (!found) {
    newLines.push(`PRINTER_IP=${printer_ip}`);
  }

  // Remove empty lines at the end
  while (newLines.length > 0 && newLines[newLines.length - 1]!.trim() === "") {
    newLines.pop();
  }

  try {
    fs.writeFileSync(envPath, newLines.join("\n") + "\n");
    logger.info("settings_saved", { printer_ip, env_path: envPath });
    sendJson(200, { success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("settings_save_failed", { error: msg, printer_ip });
    sendError(500, "internal_error", `Failed to save settings: ${msg}`);
  }
}
