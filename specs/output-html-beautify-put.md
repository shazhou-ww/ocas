---
scenario: "Beautified @ocas/output/put HTML template uses card layout with hash display"
feature: render
tags: [output, html, template, put, beautify]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/put` envelope node whose payload is a 13-char hash string (e.g. `"9S7JEYS3FKSDH"`)

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in a card container: `<div class="ocas-card">`
- Card has a human-readable header: `<div class="ocas-card-header">Stored</div>`
- The hash is displayed inside `<code class="ocas-hash">9S7JEYS3FKSDH</code>`
- All CSS classes use the `ocas-` namespace prefix
- The static template (`@ocas/template-static/html/<hash>`) provides CSS that includes:
  - Design tokens as CSS custom properties (from the design guide: `--ocas-font`, `--ocas-mono`, `--ocas-card-bg`, `--ocas-card-border`, `--ocas-card-shadow`, `--ocas-card-radius`, `--ocas-hash-bg`, `--ocas-hash-text`, etc.)
  - Card styling: white background, border, subtle shadow, rounded corners
  - Hash pill styling: monospace font, gray background, rounded, `word-break: break-all`
- No `<table>` or `<dl>` used — this is a single-value display
- The rendered output is a valid HTML fragment suitable for wrapping in the builtin compose shell
