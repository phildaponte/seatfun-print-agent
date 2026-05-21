import type { FontSize } from "./types.js";

export function rc(row: number, col: number): string {
  return `<RC${row},${col}>`;
}

export function font(size: FontSize): string {
  return `<F${size}>`;
}

export function qr(size: number, payload: string): string {
  return `<QR${size}>${payload}`;
}

export function logo(slot: number): string {
  return `<LOGO${slot}>`;
}

export const PRINT = "<p>";
export const CANCEL = "<CAN>";

const FGL_FORBIDDEN_IN_TEXT = /[<>]/g;

export function sanitizeText(input: string | undefined | null): string {
  if (input == null) return "";
  return String(input).replace(FGL_FORBIDDEN_IN_TEXT, "");
}

export function assertQrSafe(payload: string): void {
  if (/[<>]/.test(payload)) {
    throw new RenderError(
      "qr_payload contains '<' or '>' which would break the FGL parser",
    );
  }
}

export class RenderError extends Error {
  readonly code = "render_error" as const;
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}
