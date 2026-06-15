---
scenario: "Pipe render with object-valued envelope uses template when available"
feature: render
tags: [render, pipe, template, object]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- An `@ocas/output/gc` envelope with object value: `{ type: "<gc-type-hash>", value: { total: 10, reachable: 8, collected: 2, scanned: 10 } }`
- A text template exists at `@ocas/template/text/<gc-type-hash>` (registered by `registerOutputTemplates`)

## When

- `ocas gc | ocas render -p` (pipe mode, default text format)
- The envelope value is an object (not a hash string)

## Then

- The template at `@ocas/template/text/<gc-type-hash>` is used to render the output
- Output matches the text template format: `total: 10\nreachable: 8\ncollected: 2\nscanned: 10`
- The output is NOT raw YAML (the old `renderDirect` behavior)
- Resolution/decay/epsilon options are still respected if provided
