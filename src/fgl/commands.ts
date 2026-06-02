import type { FontSize } from "./types.js";

export function rc(row: number, col: number): string {
  return `<RC${row},${col}>`;
}

export function font(size: FontSize): string {
  return `<F${size}>`;
}

export function qr(size: number, payload: string): string {
  // BOCA FGL46 requires curly braces around the payload.
  return `<QR${size}>{${payload}}`;
}

export function qrv(version: 2 | 7 | 11 | 15): string {
  // Set QR version density. Version 7 is default, version 2 is less dense.
  return `<QRV${version}>`;
}

/**
 * Strips diacritics so accented characters print on FGL46 firmwares that only
 * understand single-byte ASCII (default Lemur-S behaviour).
 *
 * Examples: "Montréal" -> "Montreal", "à" -> "a", "ç" -> "c".
 *
 * v1 will replace this with proper code-page selection (FGL <U> / <C> commands)
 * so accented characters render correctly.
 */
export function toAscii(input: string | undefined | null): string {
  if (input == null) return "";
  return String(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Catch a few common ligatures / dashes that NFD doesn't decompose.
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[•·]/g, "*");
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
