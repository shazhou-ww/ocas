---
scenario: "@ocas/output/var-get HTML template uses card layout with key-value grid, hash pills, and tag badges"
feature: render
tags: [output, html, template, beautify, var-get]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- A variable get result returning `{ name, schema, value, valueTags? }`
- The variable optionally has value tags (e.g. `[{ key: "env", value: "prod" }]`)

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called on an `@ocas/output/var-get` envelope

## Then

- The HTML output is wrapped in `<div class="ocas-card">`
- A header `<div class="ocas-card-header">Variable Detail</div>` appears at the top
- The body contains `<dl class="ocas-dl">` with key-value pairs:
  - `<dt>Name</dt><dd>` with the variable name as plain text
  - `<dt>Schema</dt><dd><code class="ocas-hash">SCHEMA_HASH</code></dd>`
  - `<dt>Value</dt><dd><code class="ocas-hash">VALUE_HASH</code></dd>`
- When `valueTags` are present, a `<dt>Tags</dt>` row appears with `<dd>` containing tag pills:
  - Each tag rendered as `<span class="ocas-tag">key:value</span>` (or just `key` if no value)
- When `valueTags` are absent, the tags row is omitted entirely
- All hash values use `<code class="ocas-hash">` (monospace pill)
- The static template for this schema contains CSS with `.ocas-card`, `.ocas-card-header`, `.ocas-dl`, `.ocas-hash`, `.ocas-tag` styles following design tokens
