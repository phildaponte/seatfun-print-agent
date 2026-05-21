import net from "node:net";

export interface PrintResult {
  ok: boolean;
  errorCode?: "printer_unreachable" | "printer_timeout" | "printer_unknown";
  errorText?: string;
  printerSerial?: string;
}

export interface PrinterClientOptions {
  ip: string;
  port: number;
  connectTimeoutMs?: number;
  writeTimeoutMs?: number;
}

export class PrinterClient {
  private readonly ip: string;
  private readonly port: number;
  private readonly connectTimeoutMs: number;
  private readonly writeTimeoutMs: number;

  constructor(opts: PrinterClientOptions) {
    this.ip = opts.ip;
    this.port = opts.port;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 5_000;
    this.writeTimeoutMs = opts.writeTimeoutMs ?? 30_000;
  }

  async printRaw(fgl: string): Promise<PrintResult> {
    return new Promise<PrintResult>((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const settle = (result: PrintResult): void => {
        if (settled) return;
        settled = true;
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
        resolve(result);
      };

      const connectTimer = setTimeout(() => {
        settle({
          ok: false,
          errorCode: "printer_timeout",
          errorText: `Connect to ${this.ip}:${this.port} timed out after ${this.connectTimeoutMs}ms`,
        });
      }, this.connectTimeoutMs);

      socket.once("error", (err) => {
        clearTimeout(connectTimer);
        const nodeErr = err as NodeJS.ErrnoException;
        const code = nodeErr.code;
        const unreachableCodes = new Set([
          "ECONNREFUSED",
          "EHOSTUNREACH",
          "ENETUNREACH",
          "EHOSTDOWN",
          "ENOTFOUND",
          "ETIMEDOUT",
        ]);
        settle({
          ok: false,
          errorCode: unreachableCodes.has(code ?? "")
            ? "printer_unreachable"
            : "printer_unknown",
          errorText: `${code ?? "ERR"}: ${err.message}`,
        });
      });

      socket.connect(this.port, this.ip, () => {
        clearTimeout(connectTimer);
        socket.setTimeout(this.writeTimeoutMs);
        socket.once("timeout", () => {
          settle({
            ok: false,
            errorCode: "printer_timeout",
            errorText: `Write to printer timed out after ${this.writeTimeoutMs}ms`,
          });
        });
        socket.write(fgl, "utf8", (err) => {
          if (err) {
            settle({
              ok: false,
              errorCode: "printer_unknown",
              errorText: err.message,
            });
            return;
          }
          socket.end(() => {
            settle({ ok: true });
          });
        });
      });
    });
  }

  async ping(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, this.connectTimeoutMs);
      socket.once("error", () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(false);
      });
      socket.connect(this.port, this.ip, () => {
        clearTimeout(timer);
        socket.end();
        resolve(true);
      });
    });
  }
}
