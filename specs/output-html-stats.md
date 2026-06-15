---
scenario: "Statistics output schemas render as card-style HTML"
feature: render
tags: [output, html, template, statistics, gc]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- Output envelope nodes of statistics schemas:
  - `@ocas/output/gc` — `{ total, reachable, collected, scanned }`
  - `@ocas/output/export` — `{ nodes, vars, tags }`
  - `@ocas/output/import` — `{ nodes: { imported, skipped }, vars: { created, updated }, tags }`

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called for each

## Then

- **gc**: renders total, reachable, collected, scanned as labeled metrics (card-style layout)
- **export**: renders nodes, vars, tags counts as labeled metrics
- **import**: renders nested import stats (nodes imported/skipped, vars created/updated, tags count)
- Numeric values are clearly displayed with their labels
- Layout uses a card or metrics-style presentation (e.g. `<dl>` or styled `<div>` blocks)
