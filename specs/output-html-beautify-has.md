---
scenario: "Beautified @ocas/output/has HTML template uses card layout with semantic boolean colors"
feature: render
tags: [output, html, template, has, beautify]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/has` envelope node whose payload is a boolean (`true` or `false`)

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in a card container: `<div class="ocas-card">`
- Card has a human-readable header: `<div class="ocas-card-header">Exists</div>`
- The boolean value is displayed as a status badge using semantic colors:
  - `true` → green (`--ocas-green` / `#16a34a`) with a success indicator (e.g. `✓ yes`)
  - `false` → red (`--ocas-red` / `#dc2626`) with a failure indicator (e.g. `✗ no`)
- Badge uses pill shape: `border-radius: 9999px`, colored background, matching the `.ocas-badge` pattern
- All CSS classes use the `ocas-` namespace prefix
- The static template provides CSS with design tokens as custom properties
- No `<table>` or `<dl>` used — this is a single-value boolean display
- The rendered output is a valid HTML fragment suitable for wrapping in the builtin compose shell
