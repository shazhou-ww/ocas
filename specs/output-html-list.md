---
scenario: "List/array output schemas render as HTML tables or lists"
feature: render
tags: [output, html, template, list, table]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- Output envelope nodes of list/array schemas:
  - `@ocas/output/refs` — array of hash strings
  - `@ocas/output/walk` — array of strings
  - `@ocas/output/list` — array of `{ hash, created, updated }`
  - `@ocas/output/list-meta` — array of `{ hash, created, updated }`
  - `@ocas/output/list-schema` — array of `{ hash, created, updated }`
  - `@ocas/output/var-list` — array of `{ name, schema, value, ... }`
  - `@ocas/output/var-history` — `{ name, schema, values: [...hashes] }`
  - `@ocas/output/template-list` — array of `{ schemaHash, contentHash }`
  - `@ocas/output/tag` — array of `{ key, value?, target, created }`
  - `@ocas/output/untag` — array of `{ key, value?, target, created }`

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called for each

## Then

- **refs**: renders hash list (e.g. `<ul>` with `<code>` items or a simple `<table>`)
- **walk**: renders walked node list
- **list / list-meta / list-schema**: renders as a `<table>` with columns for hash, created, updated
- **var-list**: renders as a `<table>` with columns for name, schema, value
- **var-history**: renders variable name + schema header, then a list/table of historical values
- **template-list**: renders as a `<table>` with schema hash and content hash columns
- **tag / untag**: renders tag entries showing key, value (if present), and target hash
- Empty arrays render an empty state (e.g. empty `<table>` body or a "no items" message)
- Hash values within table cells use `<code>` elements
