---
scenario: "Beautified @ocas/output/template-delete HTML template uses card layout with boolean status"
feature: render
tags: [output, html, template, template-delete, beautify]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/template-delete` envelope node whose payload is `{ deleted: boolean }`

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in a card container: `<div class="ocas-card">`
- Card has a human-readable header: `<div class="ocas-card-header">Template Deleted</div>`
- The deletion result is displayed as a status badge using semantic colors:
  - `deleted: true` → green badge with success indicator (e.g. `✓ deleted`)
  - `deleted: false` → red badge with failure indicator (e.g. `✗ not found`)
- Badge uses pill shape matching the `.ocas-badge` pattern from the design guide
- All CSS classes use the `ocas-` namespace prefix
- The static template provides CSS with design tokens as custom properties
- No `<table>` or `<dl>` used — this is a single-value boolean display
- The rendered output is a valid HTML fragment suitable for wrapping in the builtin compose shell
