---
scenario: "HTML output rendering flows through the existing map-reduce-compose pipeline"
feature: render
tags: [output, html, template, pipeline, integration]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An output envelope node (e.g. `ocas gc` result wrapped via `wrapEnvelope`)

## When

- `ocas gc | ocas render -p --format html` (or equivalent `renderAsync` call)

## Then

- **Map phase**: the output envelope's type hash resolves to an HTML instance template via `@ocas/template/html/<type-hash>`; LiquidJS renders the template with the envelope's payload as context
- **Reduce phase**: the envelope's type hash is looked up in `@ocas/template-static/html/<type-hash>`; if found, CSS/JS statics are collected
- **Compose phase**: with no custom compose template, the builtin HTML shell wraps the content with `<!DOCTYPE html>`, `<head>` (including `<style>` blocks from statics), and `<body>`
- The final output is a complete, self-contained HTML document
- Text format rendering (`--format text` or default) is unchanged — existing text templates continue to work identically
