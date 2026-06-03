---
Last updated: 2026-06-02
Last change: Added BOCA Lemur FGL ticket layout update entry
Owner: @phildaponte
Status: current
---

# Changelog

## 2026-06-02

- **FGL ticket template**: Reworked the BOCA Lemur ticket renderer into a main ticket body plus tear-off stub with large/small QR codes, dashed separator, event, venue, price, date, and order id placement. Why: match the provided reference ticket layout for Lemur FGL output. Docs: [architecture](./architecture.md). Code: `src/fgl/template.ts`.

## Related

- [Architecture](./architecture.md)
- [Protocol](./protocol.md)
- [Distribution](./distribution.md)
