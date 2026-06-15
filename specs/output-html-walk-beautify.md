---
scenario: "@ocas/output/walk HTML template uses card layout with hash list"
feature: render
tags: [output, html, template, beautify, walk]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/walk` envelope with payload: `["AAAAAAAAAAAAA", "BBBBBBBBBBBBB"]`

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in `<div class="ocas-card">`
- Card header: `<div class="ocas-card-header">Walk · 2 entries</div>` (human-readable title with count)
- Body contains a list where each hash renders as `<code class="ocas-hash">...</code>`
- All walked hashes appear in the output
- No legacy `ocas-output` wrapper class — uses `ocas-card` layout
- The static template CSS includes `.ocas-card`, `.ocas-card-header`, `.ocas-hash` rules using design tokens
