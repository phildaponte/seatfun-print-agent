import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderTicket, RenderError } from "./index.js";
import type { TicketRenderData } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(__dirname, "__golden__");

function loadGoldenPairs(): Array<{ name: string; input: TicketRenderData; expected: string }> {
  const files = readdirSync(GOLDEN_DIR);
  const jsons = files.filter((f) => f.endsWith(".json"));
  return jsons.map((j) => {
    const name = j.replace(/\.json$/, "");
    const input = JSON.parse(readFileSync(join(GOLDEN_DIR, j), "utf8")) as TicketRenderData;
    const expected = readFileSync(join(GOLDEN_DIR, `${name}.fgl`), "utf8");
    return { name, input, expected };
  });
}

describe("renderTicket — golden fixtures", () => {
  const pairs = loadGoldenPairs();
  it("loaded at least one fixture", () => {
    expect(pairs.length).toBeGreaterThan(0);
  });
  for (const { name, input, expected } of pairs) {
    it(`matches golden output: ${name}`, () => {
      const actual = renderTicket(input);
      expect(actual).toBe(expected);
    });
  }
});

describe("renderTicket — validation", () => {
  const valid: TicketRenderData = {
    event_name: "E",
    venue_name: "V",
    city: "C",
    state: "S",
    event_date_long: "D",
    event_time: "T",
    admission_type: "GA",
    price: "1.00",
    event_code: "X",
    order_id: "O",
    qr_payload: "abc.def.ghi",
    print_timestamp: "2026-01-01T00:00:00Z",
  };

  it("rejects missing required field", () => {
    const bad = { ...valid, event_name: "" };
    expect(() => renderTicket(bad)).toThrow(RenderError);
  });

  it("rejects QR payload containing '<'", () => {
    const bad = { ...valid, qr_payload: "abc<def" };
    expect(() => renderTicket(bad)).toThrow(RenderError);
  });

  it("rejects QR payload containing '>'", () => {
    const bad = { ...valid, qr_payload: "abc>def" };
    expect(() => renderTicket(bad)).toThrow(RenderError);
  });

  it("strips '<' and '>' from text fields silently", () => {
    const out = renderTicket({ ...valid, event_name: "Hello <script>World</script>" });
    expect(out).toContain("Hello scriptWorld/script");
    expect(out).not.toContain("<script>");
  });

  it("is deterministic — same input twice yields the same bytes", () => {
    expect(renderTicket(valid)).toBe(renderTicket(valid));
  });

  it("omits SECTION/ROW/SEAT line when seat info absent", () => {
    const out = renderTicket(valid);
    expect(out).not.toContain("SEC ");
    expect(out).toContain("<RC210,20><F3>GA");
  });

  it("includes SECTION/ROW/SEAT line when seat present", () => {
    const out = renderTicket({ ...valid, section: "A", row: "1", seat: "5" });
    expect(out).toContain("SEC A  ROW 1  SEAT 5");
  });
});
