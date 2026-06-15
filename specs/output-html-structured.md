---
scenario: "Structured output schemas render as key-value HTML"
feature: render
tags: [output, html, template, structured]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- Output envelope nodes of structured (object) schemas:
  - `@ocas/output/get` — `{ type, payload, timestamp, tags? }`
  - `@ocas/output/var-set` — `{ name, schema, value, created?, updated?, tags?, labels? }`
  - `@ocas/output/var-get` — `{ name, schema, value, created?, updated?, tags?, labels?, valueTags? }`
  - `@ocas/output/var-delete` — `{ name, schema, value, created?, updated?, tags?, labels? }`
  - `@ocas/output/template-set` — `{ schemaHash, contentHash }`

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called for each

## Then

- **get**: renders type, timestamp, and payload as labeled key-value pairs; if tags present, includes them
- **var-set**: renders name, schema hash, and value hash as labeled key-value pairs
- **var-get**: renders name, schema hash, value hash, and value tags if present
- **var-delete**: renders the deleted variable's name, schema hash, and value hash
- **template-set**: renders schema hash and content hash as labeled key-value pairs
- All use a key-value layout (e.g. `<dl>`, `<table>`, or labeled `<div>` pairs)
- Hash values are displayed in `<code>` elements for monospace rendering
