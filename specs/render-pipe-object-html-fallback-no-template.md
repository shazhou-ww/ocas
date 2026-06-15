---
scenario: "Pipe render with object-valued envelope and --format html falls back to YAML in <pre><code> when no template"
feature: render
tags: [render, pipe, html, fallback, object]
---

## Given

- A store with bootstrap completed
- An envelope with an object value whose type hash has NO HTML template: `{ type: "<unknown-type-hash>", value: { key: "value" } }`
- No template exists at `@ocas/template/html/<unknown-type-hash>`

## When

- `echo '...' | ocas render -p --format html`
- Template lookup for the type hash in the html namespace fails

## Then

- Output falls back to YAML wrapped in `<pre><code>` tags (consistent with `renderAsync` fallback for stored nodes)
- The builtin HTML shell is applied (wrapping with `<!DOCTYPE html>`, `<head>`, `<body>`)
- Output is a complete HTML document, not raw YAML
