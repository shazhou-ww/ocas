---
scenario: "Beautified @ocas/output/hash HTML template uses card layout with hash display"
feature: render
tags: [output, html, template, hash, beautify]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/hash` envelope node whose payload is a 13-char hash string (e.g. `"4RTP58MHBWVF6"`)

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in a card container: `<div class="ocas-card">`
- Card has a human-readable header: `<div class="ocas-card-header">Hash</div>`
- The hash is displayed inside `<code class="ocas-hash">4RTP58MHBWVF6</code>`
- Uses the same hash display pattern as `@ocas/output/put` (monospace pill)
- All CSS classes use the `ocas-` namespace prefix
- The static template provides CSS with design tokens as custom properties
- No `<table>` or `<dl>` used — this is a single-value display
- The rendered output is a valid HTML fragment suitable for wrapping in the builtin compose shell
