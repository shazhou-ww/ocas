---
scenario: "All table HTML templates render an empty state when payload is an empty array"
feature: render
tags: [output, html, template, table, empty-state, beautify]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- Output envelopes with empty arrays (`[]`) for all 7 table templates:
  - `@ocas/output/list`
  - `@ocas/output/list-meta`
  - `@ocas/output/list-schema`
  - `@ocas/output/var-list`
  - `@ocas/output/tag`
  - `@ocas/output/untag`
  - `@ocas/output/template-list`

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called for each

## Then

- Each still renders inside a `<div class="ocas-card">` container
- Card header shows count as `0 entries` (e.g. `Nodes · 0 entries`)
- The table body is empty (no `<tr>` rows inside `<tbody>`)
- The output still contains `<table` (valid HTML table structure is preserved)
- No broken markup or missing closing tags
