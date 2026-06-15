---
scenario: "Pipe render with object-valued envelope respects --format html"
feature: render
tags: [render, pipe, template, html, format]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/gc` envelope with object value: `{ type: "<gc-type-hash>", value: { total: 5, reachable: 3, collected: 2, scanned: 5 } }`
- An HTML template exists at `@ocas/template/html/<gc-type-hash>` (registered by `registerOutputTemplates`)
- An HTML static template exists at `@ocas/template-static/html/<gc-type-hash>` with shared CSS

## When

- `ocas gc | ocas render -p --format html`
- The envelope value is an object (not a hash string)

## Then

- The HTML template at `@ocas/template/html/<gc-type-hash>` is used to render the content
- Output contains HTML markup from the template (e.g. `<div class="ocas-output ocas-gc ocas-stats">`)
- The compose phase applies the builtin HTML shell (since no custom compose template exists), wrapping with `<!DOCTYPE html>`, `<head>`, `<body>`
- Static CSS is included in `<style>` blocks in `<head>`
- The `--format html` flag is no longer ignored for object-valued envelopes
