import {
  rc,
  font,
  qr,
  qrv,
  sanitizeText,
  toAscii,
  assertQrSafe,
  PRINT,
  RenderError,
} from "./commands.js";
import type { TicketRenderData } from "./types.js";

const REQUIRED_FIELDS: Array<keyof TicketRenderData> = [
  "event_name",
  "venue_name",
  "event_date_long",
  "event_time",
  "admission_type",
  "price",
  "event_code",
  "order_id",
  "qr_payload",
  "print_timestamp",
];

function validate(data: TicketRenderData): void {
  for (const key of REQUIRED_FIELDS) {
    const v = data[key];
    if (typeof v !== "string" || v.length === 0) {
      throw new RenderError(`field '${key}' is required and must be a non-empty string`);
    }
  }
  assertQrSafe(data.qr_payload);
}

export function renderTicket(data: TicketRenderData): string {
  validate(data);

  // sanitizeText strips '<' and '>' so they cannot break the FGL parser.
  // toAscii strips diacritics so multi-byte UTF-8 sequences don't print as garbage
  // on FGL46 firmwares that only understand single-byte ASCII (default Lemur-S).
  const t = (v: string | undefined) => toAscii(sanitizeText(v));
  const hasSeatInfo = Boolean(data.seat || data.row);

  // Layout assumes a 2" × 5.5" tear-stock fed PORTRAIT on a Lemur-S:
  //   - rows go 0..~1100 (the 5.5" feed-direction axis, leading edge prints first)
  //   - cols go 0..~400  (the 2" head axis)
  // The self-test reports "PRINT WIDTH 960" but that's the printer's MAX head
  // width across all stocks; our 2" stock only uses cols 0..~400 of that.
  // Confirmed empirically on 2026-05-21 (round 3 print): col 650 placed the QR
  // off the stock and silently dropped it. All content stays within col 0..400.

  const parts: string[] = [];

  // ── Header ───────────────────────────────────────────────────────────
  parts.push(rc(10, 20) + font(6) + t(data.event_name));
  parts.push(rc(110, 20) + font(2) + `${t(data.venue_name)} - ${t(data.city)}, ${t(data.state)}`);
  // Font 3 is reliable across FGL46 firmware revisions; font 4 has lowercase
  // glitches on some Lemur-S units (observed 2026-05-21).
  parts.push(rc(150, 20) + font(3) + `${t(data.event_date_long)}   ${t(data.event_time)}`);

  // ── Seating / admission ──────────────────────────────────────────────
  if (hasSeatInfo) {
    parts.push(
      rc(210, 20) +
        font(3) +
        `SEC ${t(data.section)}  ROW ${t(data.row)}  SEAT ${t(data.seat)}`,
    );
    parts.push(rc(260, 20) + font(2) + t(data.admission_type));
  } else {
    parts.push(rc(210, 20) + font(3) + t(data.admission_type));
  }

  // ── Price + event code ───────────────────────────────────────────────
  parts.push(rc(310, 20) + font(2) + `$${t(data.price)}    CODE: ${t(data.event_code)}`);

  // ── QR code ──────────────────────────────────────────────────────────
  // Module size 8 × ~21 modules = ~170 dots wide on a ~400-wide stock.
  // Moved to row 350, col 150 for better centering.
  // QRV7 sets QR version to 7 (default density, up to 178 alphanumeric chars).
  parts.push(qrv(7));
  parts.push(rc(350, 150) + qr(8, data.qr_payload));

  // ── Footer ───────────────────────────────────────────────────────────
  // Pushed past the QR (which ends ~row 570) but well within the safe
  // print zone observed on the round 3 ticket.
  parts.push(
    rc(700, 20) +
      font(1) +
      `Order ${t(data.order_id)}  *  Printed ${t(data.print_timestamp)}`,
  );

  parts.push(PRINT);

  return parts.join("");
}
