import {
  rc,
  font,
  qr,
  sanitizeText,
  assertQrSafe,
  PRINT,
  RenderError,
} from "./commands.js";
import type { TicketRenderData } from "./types.js";

const REQUIRED_FIELDS: Array<keyof TicketRenderData> = [
  "event_name",
  "venue_name",
  "city",
  "state",
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

  const t = (v: string | undefined) => sanitizeText(v);
  const hasSeatInfo = Boolean(data.seat || data.row);

  const parts: string[] = [];

  parts.push(rc(10, 20) + font(6) + t(data.event_name));
  parts.push(rc(60, 20) + font(2) + `${t(data.venue_name)} — ${t(data.city)}, ${t(data.state)}`);
  parts.push(rc(90, 20) + font(4) + `${t(data.event_date_long)}     ${t(data.event_time)}`);

  if (hasSeatInfo) {
    parts.push(
      rc(130, 20) +
        font(2) +
        `SECTION ${t(data.section)}   ROW ${t(data.row)}   SEAT ${t(data.seat)}`,
    );
    parts.push(rc(130, 300) + font(2) + t(data.admission_type));
  } else {
    parts.push(rc(130, 20) + font(2) + t(data.admission_type));
  }

  parts.push(rc(170, 20) + font(2) + `$${t(data.price)}    EVENT CODE: ${t(data.event_code)}`);
  parts.push(rc(200, 20) + qr(8, data.qr_payload));
  parts.push(
    rc(380, 20) +
      font(1) +
      `Order ${t(data.order_id)}  •  Printed ${t(data.print_timestamp)}`,
  );
  parts.push(PRINT);

  return parts.join("");
}
