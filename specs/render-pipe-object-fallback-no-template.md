---
scenario: "Pipe render with object-valued envelope falls back to YAML when no template exists"
feature: render
tags: [render, pipe, fallback, object]
---

## Given

- A store with bootstrap completed
- An envelope with an object value whose type hash has NO registered template: `{ type: "<unknown-type-hash>", value: { foo: "bar", count: 42 } }`
- No template exists at `@ocas/template/text/<unknown-type-hash>`

## When

- The envelope is piped to `ocas render -p` (default text format)
- Template lookup for the type hash fails (no template found)

## Then

- Output falls back to YAML rendering via `renderDirect` (current behavior preserved)
- Output is YAML-formatted: `foo: bar\ncount: 42`
- No error is thrown
