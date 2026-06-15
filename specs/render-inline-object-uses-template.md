---
scenario: "Inline render flag (-r) with object-valued envelope uses template system"
feature: render
tags: [render, inline, template, object]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- A CLI command that produces an object-valued envelope (e.g. `ocas gc`, `ocas var list`, `ocas list`)
- The `out()` helper in `index.ts` handles `--render`/`-r` flag by rendering inline

## When

- `ocas gc -r` (inline render of gc output)
- The `out()` helper detects `inlineRender` is true and the data is an envelope with object value

## Then

- The template at `@ocas/template/text/<gc-type-hash>` is used to render the output (not raw YAML via `renderDirect`)
- Output matches the text template format
- The `--format` flag (if provided) is also respected in the inline render path
