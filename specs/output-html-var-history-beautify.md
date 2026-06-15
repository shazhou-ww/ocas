---
scenario: "@ocas/output/var-history HTML template uses card layout with current marker"
feature: render
tags: [output, html, template, beautify, var-history]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/var-history` envelope with payload:
  ```json
  {
    "name": "@user/myvar",
    "schema": "AAAAAAAAAAAAA",
    "values": ["CCCCCCCCCCCCC", "BBBBBBBBBBBBB"]
  }
  ```
  (index 0 = current value, index 1 = older value)

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in `<div class="ocas-card">`
- Card header: `<div class="ocas-card-header">Variable History</div>`
- Meta section uses `<dl class="ocas-dl">` with key-value pairs:
  - `<dt>Name</dt><dd>@user/myvar</dd>`
  - `<dt>Schema</dt><dd><code class="ocas-hash">AAAAAAAAAAAAA</code></dd>`
- History values rendered as `<ol>` starting from index 0
- Index 0 entry (current value) has a `← current` marker visible in the output
- All hash values use `<code class="ocas-hash">` pill styling
- No legacy `ocas-output` wrapper class — uses `ocas-card` layout
- The static template CSS includes `.ocas-card`, `.ocas-dl`, `.ocas-hash`, and history-specific styling
