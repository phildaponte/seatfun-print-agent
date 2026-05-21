---
trigger: always_on
description: Documentation discipline for the SeatFun dashboard. Auto-loaded into every Cascade session.
---

# Documentation Rules — MANDATORY

This is a **production project**. Every change must be traceable. These rules apply to every session in this workspace.

## Source of truth

- `docs/` is the **single source of truth** for how the system works.
- `docs/README.md` is the **index** — start here when you need orientation.
- `docs/CHANGELOG.md` is the **dated, append-only log** of every change.
- `schema-meta-bubble.json` (repo root) is the **canonical Bubble backend contract**. When in doubt about a Bubble type or endpoint, read it.
- `docs/archive/` is **historical / read-only**. Never edit, never reference as current truth.

## Hard rules

### Before you implement anything

1. **Read the relevant doc first.** If you're touching a feature, integration, page, or backend call, find and read its doc in `docs/` before editing code.
2. If no doc exists for the area you're touching, **create one** (use `docs/_templates/doc-template.md`) before or alongside the code change.
3. If the doc seems out of date, flag it to the user and offer to update it before proceeding.

### After you implement anything

4. **Update the corresponding doc(s)** in the same task. Code change + doc change ship together. No exceptions.
5. **Append a `CHANGELOG.md` entry** at the top of the file under today's date with: what changed, why, and links to the affected docs.
6. **Update the frontmatter** of every doc you touched:
   - `Last updated: YYYY-MM-DD` → today's date
   - `Last change:` → one-line summary of what changed
7. If the change introduces a new Bubble endpoint, type, or field, update `docs/02-backend-bubble/` accordingly.
8. If the change introduces a new route, page, or major component, update `docs/03-frontend/`.

### Never

- Never edit anything in `docs/archive/`.
- Never delete a doc — mark `Status: deprecated` in frontmatter and explain in CHANGELOG.
- Never duplicate information across docs. Link instead.
- Never leave a doc without frontmatter.
- Never claim a feature is implemented in docs if the code doesn't back it up.

## Frontmatter format (every doc must start with this)

```markdown
---
Last updated: YYYY-MM-DD
Last change: <one-line summary>
Owner: @phildaponte
Status: current | draft | deprecated
---
```

## CHANGELOG entry format

Newest entries at the top. Group by date. Format:

```markdown
## YYYY-MM-DD

- **<area>**: <what changed>. Why: <reason>. Docs: [link](path/to/doc.md), [link](path/to/other.md). Code: `src/path/file.ts`.
```

## Cross-linking conventions

- **Doc → doc**: relative markdown links — `[label](../02-backend-bubble/workflows-api.md)`.
- **Doc → section**: anchor links — `[label](../02-backend-bubble/workflows-api.md#stripe_create_customer)`.
- **Doc → code**: backticked repo-relative path — `` `src/app/events/[id]/page.tsx` ``.
- Every doc ends with a **## Related** section listing 3–5 sibling links.

## Bubble API examples must be testable

In `docs/02-backend-bubble/`, every endpoint entry must include:

1. A clickable browser URL (for GET) or an HTTP-style code block (for POST).
2. A copy/paste cURL block.
3. The list of frontend files that call it (backticked paths).

Use `{BUBBLE_BASE_URL}` and `{BUBBLE_ENV}` placeholders defined once in `docs/02-backend-bubble/README.md`.

## When the user asks you to do something

Working order:
1. Read relevant docs in `docs/`.
2. Read relevant code.
3. Plan the change.
4. Implement code + docs together.
5. Append CHANGELOG entry.
6. Confirm completion to the user, listing the docs you updated.

This is non-negotiable. Skipping documentation = the change is incomplete.
