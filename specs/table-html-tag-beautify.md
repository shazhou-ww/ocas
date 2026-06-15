---
scenario: "tag and untag HTML templates use card layout with tag pills and empty-value handling"
feature: render
tags: [output, html, template, table, tag, untag, beautify]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/tag` envelope with payload:
  ```json
  [
    { "key": "env", "value": "prod", "target": "AAAAAAAAAAAAA", "created": 1700000000 },
    { "key": "status", "value": null, "target": "BBBBBBBBBBBBB", "created": 1700000000 }
  ]
  ```
- An `@ocas/output/untag` envelope with the same payload structure

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called for each

## Then

- Each renders inside a `<div class="ocas-card">` container
- Card header uses human-readable title with count:
  - `tag` → `Tags · 2 entries`
  - `untag` → `Untagged · 2 entries`
- Table uses `<table class="ocas-table">`
- `<th>` headers display: KEY, VALUE, TARGET
- Key cells display the tag key text
- Value cells show the value when present; show `—` (em dash) in muted color when null/empty
- Target cells render as `<code class="ocas-hash">...</code>`
- Both templates share the same 3-column structure (tag and untag are symmetric)
