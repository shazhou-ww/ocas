---
scenario: "template-list HTML template uses card layout with 2-column hash table"
feature: render
tags: [output, html, template, table, template-list, beautify]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/template-list` envelope with payload:
  ```json
  [
    { "schemaHash": "AAAAAAAAAAAAA", "contentHash": "BBBBBBBBBBBBB" },
    { "schemaHash": "CCCCCCCCCCCCC", "contentHash": "DDDDDDDDDDDDD" }
  ]
  ```

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Renders inside a `<div class="ocas-card">` container
- Card header reads `Templates · 2 entries` (count from payload.size)
- Table uses `<table class="ocas-table">`
- `<th>` headers display: SCHEMA, CONTENT
- Both schema and content cells render as `<code class="ocas-hash">...</code>`
- Output contains all hash values from input
