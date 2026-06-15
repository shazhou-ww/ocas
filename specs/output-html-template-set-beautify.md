---
scenario: "@ocas/output/template-set HTML template uses card layout with key-value grid and hash pills"
feature: render
tags: [output, html, template, beautify, template-set]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- A template set operation returning `{ schemaHash, contentHash }`

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called on an `@ocas/output/template-set` envelope

## Then

- The HTML output is wrapped in `<div class="ocas-card">`
- A header `<div class="ocas-card-header">Template Set</div>` appears at the top
- The body contains `<dl class="ocas-dl">` with key-value pairs:
  - `<dt>Schema</dt><dd><code class="ocas-hash">SCHEMA_HASH</code></dd>`
  - `<dt>Content</dt><dd><code class="ocas-hash">CONTENT_HASH</code></dd>`
- All hash values use `<code class="ocas-hash">` (monospace pill)
- The static template for this schema contains CSS with `.ocas-card`, `.ocas-card-header`, `.ocas-dl`, `.ocas-hash` styles following design tokens
