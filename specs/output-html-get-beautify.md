---
scenario: "@ocas/output/get HTML template uses card layout with key-value grid, hash pills, and tag badges"
feature: render
tags: [output, html, template, beautify, get]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- A CAS node stored with a known type hash and timestamp
- The node optionally has tags (e.g. `[{ key: "env", value: "prod", target: "<hash>" }]`)

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called on an `@ocas/output/get` envelope

## Then

- The HTML output is wrapped in `<div class="ocas-card">`
- A header `<div class="ocas-card-header">Node Detail</div>` appears at the top
- The body contains `<dl class="ocas-dl">` with key-value pairs:
  - `<dt>Type</dt><dd><code class="ocas-hash">TYPE_HASH</code></dd>`
  - `<dt>Timestamp</dt><dd>TIMESTAMP_VALUE</dd>`
- When tags are present, a `<dt>Tags</dt>` row appears with `<dd>` containing tag pills:
  - Each tag rendered as `<span class="ocas-tag">key:value</span>` (or just `key` if no value)
- When tags are absent, the tags row is omitted entirely
- All hash values use `<code class="ocas-hash">` (monospace pill)
- The static template for this schema contains CSS with `.ocas-card`, `.ocas-card-header`, `.ocas-dl`, `.ocas-hash`, `.ocas-tag` styles following design tokens
