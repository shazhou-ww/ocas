---
scenario: "list, list-meta, list-schema HTML templates use card layout with styled tables"
feature: render
tags: [output, html, template, table, list, beautify]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- Output envelope nodes with payload arrays:
  - `@ocas/output/list` — `[{ hash, created, updated }, ...]`
  - `@ocas/output/list-meta` — `[{ hash, created, updated }, ...]`
  - `@ocas/output/list-schema` — `[{ hash, created, updated }, ...]`

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called for each

## Then

- Each renders inside a `<div class="ocas-card">` container
- Card header uses human-readable title with entry count:
  - `list` → `Nodes · N entries` (where N = payload.size)
  - `list-meta` → `Meta-Schemas · N entries`
  - `list-schema` → `Schemas · N entries`
- Table uses `<table class="ocas-table">` (not just `ocas-output`)
- `<th>` headers display column names: HASH, CREATED, UPDATED
- Hash cells render as `<code class="ocas-hash">...</code>`
- Time cells use `class="ocas-col-time"` for muted tabular-nums styling
- Output still contains `<table`, `<code`, and all hash values from input
- All three templates share the same 3-column structure
