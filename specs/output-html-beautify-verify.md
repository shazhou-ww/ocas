---
scenario: "Beautified @ocas/output/verify HTML template uses card layout with status badges"
feature: render
tags: [output, html, template, verify, beautify]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/verify` envelope node whose payload is one of `"ok"`, `"corrupted"`, or `"invalid"`

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called

## Then

- Output is wrapped in a card container: `<div class="ocas-card">`
- Card has a human-readable header: `<div class="ocas-card-header">Verify</div>`
- The verification status is displayed as a pill-shaped badge (`.ocas-badge`) with:
  - `"ok"` → green badge with checkmark: `<span class="ocas-badge ocas-badge-ok">✓ ok</span>`
  - `"corrupted"` → red badge with cross: `<span class="ocas-badge ocas-badge-error">✗ corrupted</span>`
  - `"invalid"` → yellow badge with warning: `<span class="ocas-badge ocas-badge-warn">⚠ invalid</span>`
- Badge CSS: `border-radius: 9999px`, colored background tint, contrasting text color
- Semantic color tokens used: `--ocas-green`, `--ocas-red`, `--ocas-yellow`
- All CSS classes use the `ocas-` namespace prefix
- The static template provides CSS with design tokens as custom properties
- No `<table>` or `<dl>` used — this is a single-value status display
- The rendered output is a valid HTML fragment suitable for wrapping in the builtin compose shell
