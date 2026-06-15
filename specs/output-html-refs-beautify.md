---
scenario: "@ocas/output/refs HTML template uses card layout with hash list"
feature: render
tags: [output, html, template, beautify, refs]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/refs` envelope with payload: `["AAAAAAAAAAAAA", "BBBBBBBBBBBBB", "CCCCCCCCCCCCC"]`

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in `<div class="ocas-card">`
- Card header: `<div class="ocas-card-header">References · 3 entries</div>` (human-readable title with count from `payload.size`)
- Body contains a list where each hash renders as `<code class="ocas-hash">AAAAAAAAAAAAA</code>`
- All three hashes appear in the output
- No legacy `ocas-output` wrapper class — uses `ocas-card` layout
- The static template CSS includes `.ocas-card`, `.ocas-card-header`, `.ocas-hash` rules using design tokens
