---
scenario: "var-list HTML template uses card layout with name-bold table"
feature: render
tags: [output, html, template, table, var-list, beautify]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/var-list` envelope with payload:
  ```json
  [
    { "name": "@test/a", "schema": "AAAAAAAAAAAAA", "value": "BBBBBBBBBBBBB" },
    { "name": "@test/b", "schema": "CCCCCCCCCCCCC", "value": "DDDDDDDDDDDDD" }
  ]
  ```

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Renders inside a `<div class="ocas-card">` container
- Card header reads `Variables · 2 entries` (count from payload.size)
- Table uses `<table class="ocas-table">`
- `<th>` headers display: NAME, SCHEMA, VALUE
- Name cells use `class="ocas-col-name"` for bold (font-weight: 500) styling
- Schema and value cells render as `<code class="ocas-hash">...</code>`
- Output contains all variable names (`@test/a`, `@test/b`) and hash values
