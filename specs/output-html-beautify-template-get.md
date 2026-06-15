---
scenario: "Beautified @ocas/output/template-get HTML template uses card layout with code block"
feature: render
tags: [output, html, template, template-get, beautify]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/template-get` envelope node whose payload is a template content string (e.g. LiquidJS template source)

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in a card container: `<div class="ocas-card">`
- Card has a human-readable header: `<div class="ocas-card-header">Template</div>`
- The template content is rendered in a `<pre>` code block with:
  - Syntax-highlight background color (`--ocas-hash-bg` / `#f3f4f6`)
  - Monospace font (`--ocas-mono`)
  - `white-space: pre-wrap` to preserve formatting while allowing wrapping
  - Padding and rounded corners for readability
  - `overflow-x: auto` for long lines
- All CSS classes use the `ocas-` namespace prefix
- The static template provides CSS with design tokens as custom properties
- No `<table>` or `<dl>` used — this is a single-value code content display
- The rendered output is a valid HTML fragment suitable for wrapping in the builtin compose shell
