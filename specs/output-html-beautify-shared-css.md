---
scenario: "Beautified simple-value HTML templates share design-guide-compliant CSS via static templates"
feature: render
tags: [output, html, template, css, static, beautify, design-guide]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- The 6 simple-value output schemas: `put`, `has`, `hash`, `verify`, `template-get`, `template-delete`

## When

- `registerOutputTemplates(store)` is called
- Each simple-value schema registers a static template at `@ocas/template-static/html/<schema-hash>`

## Then

- All static templates contain valid JSON with a `"css"` key
- The CSS includes design tokens as CSS custom properties matching the design guide:
  - Typography: `--ocas-font`, `--ocas-mono`
  - Card: `--ocas-card-bg`, `--ocas-card-border`, `--ocas-card-shadow`, `--ocas-card-radius`
  - Text: `--ocas-text`, `--ocas-text-muted`
  - Semantic: `--ocas-green`, `--ocas-red`, `--ocas-yellow`
  - Hash: `--ocas-hash-bg`, `--ocas-hash-text`
- The CSS provides styles for:
  - `.ocas-card` — card container with white background, border, shadow, radius
  - `.ocas-card-header` — human-readable title, bold, adequate padding
  - `.ocas-hash` — monospace font, gray background pill, `word-break: break-all`
  - `.ocas-badge` / `.ocas-badge-ok` / `.ocas-badge-error` / `.ocas-badge-warn` — pill-shaped status badges with semantic colors
  - `.ocas-template-content` — `<pre>` code block with background, padding, monospace font
- All class names use the `ocas-` namespace prefix
- CSS from multiple types is deduplicated in the compose phase (existing reduce-phase behavior)
