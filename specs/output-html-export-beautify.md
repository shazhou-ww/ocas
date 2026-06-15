---
scenario: "@ocas/output/export HTML template uses card layout with stats grid"
feature: render
tags: [output, html, template, beautify, export]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/export` envelope with payload:
  ```json
  { "nodes": 42, "vars": 15, "tags": 8 }
  ```

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in `<div class="ocas-card">`
- Card header: `<div class="ocas-card-header">Export Summary</div>`
- Body uses a stats grid layout (`<div class="ocas-stats-grid">`) with 3 stat blocks:
  - Each stat has a large number (`<span class="ocas-stat-value">`) and a human-readable label (`<span class="ocas-stat-label">`)
  - Labels: "nodes", "variables", "tags" (human-readable, not abbreviations)
- All three numeric values (42, 15, 8) appear in the output
- No legacy `ocas-output ocas-export ocas-stats` wrapper — uses `ocas-card` + `ocas-stats-grid`
- The static template CSS includes `.ocas-stats-grid`, `.ocas-stat-value`, `.ocas-stat-label` rules
