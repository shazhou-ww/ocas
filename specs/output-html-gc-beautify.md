---
scenario: "@ocas/output/gc HTML template uses card layout with stats grid"
feature: render
tags: [output, html, template, beautify, gc]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/gc` envelope with payload:
  ```json
  { "total": 100, "reachable": 80, "collected": 20, "scanned": 5 }
  ```

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in `<div class="ocas-card">`
- Card header: `<div class="ocas-card-header">Garbage Collection</div>`
- Body uses a stats grid layout (`<div class="ocas-stats-grid">`) with 4 stat blocks:
  - Each stat has a large number (`<span class="ocas-stat-value">`) and a human-readable label (`<span class="ocas-stat-label">`)
  - Labels use human-readable names: "total nodes", "reachable", "collected", "scanned"
- All four numeric values (100, 80, 20, 5) appear in the output
- No legacy `ocas-output ocas-gc ocas-stats` wrapper — uses `ocas-card` + `ocas-stats-grid`
- The static template CSS includes:
  - `.ocas-stats-grid` — 2-column grid layout
  - `.ocas-stat-value` — large font (`var(--ocas-metric-size)`), bold, `font-variant-numeric: tabular-nums`
  - `.ocas-stat-label` — muted color

## Given (zero collected variant)

- Same as above but with `{ "total": 50, "reachable": 50, "collected": 0, "scanned": 3 }`

## Then

- When collected = 0, the collected stat gets `ocas-success` class (green = "nothing to collect is good")
