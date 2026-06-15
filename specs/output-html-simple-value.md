---
scenario: "Simple value output schemas render concise HTML fragments"
feature: render
tags: [output, html, template, simple-value]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- Output envelope nodes of simple-value schemas:
  - `@ocas/output/put` — payload is a hash string (ocas_ref)
  - `@ocas/output/has` — payload is a boolean
  - `@ocas/output/hash` — payload is a hash string (ocas_ref)
  - `@ocas/output/verify` — payload is one of `"ok"`, `"corrupted"`, `"invalid"`
  - `@ocas/output/template-get` — payload is a template string
  - `@ocas/output/template-delete` — payload is `{ deleted: boolean }`

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called for each

## Then

- **put**: renders the hash in a concise element (e.g. `<code>` or similar inline display)
- **has**: renders the boolean result clearly (true/false)
- **hash**: renders the computed hash in a concise element
- **verify**: renders the verification status with clear indication (ok/corrupted/invalid)
- **template-get**: renders the raw template content (preserving whitespace, e.g. `<pre>`)
- **template-delete**: renders whether deletion succeeded
- All outputs are valid HTML fragments suitable for wrapping in the builtin HTML shell
- No `<table>` used — these are single-value displays
