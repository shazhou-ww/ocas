---
scenario: "@ocas/output/import HTML template uses card layout with stats grid"
feature: render
tags: [output, html, template, beautify, import]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/import` envelope with payload:
  ```json
  {
    "nodes": { "imported": 10, "skipped": 2 },
    "vars": { "created": 3, "updated": 1 },
    "tags": 5
  }
  ```

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in `<div class="ocas-card">`
- Card header: `<div class="ocas-card-header">Import Summary</div>`
- Body uses a stats grid layout (`<div class="ocas-stats-grid">`) with 5 stat blocks:
  - Each stat has a large number (`<span class="ocas-stat-value">`) and a human-readable label (`<span class="ocas-stat-label">`)
  - Labels: "nodes imported", "nodes skipped", "variables created", "variables updated", "tags"
- All five numeric values (10, 2, 3, 1, 5) appear in the output
- No legacy `ocas-output ocas-import ocas-stats` wrapper — uses `ocas-card` + `ocas-stats-grid`
- The static template CSS includes `.ocas-stats-grid`, `.ocas-stat-value`, `.ocas-stat-label` rules
