---
scenario: "TypeStatics structure and parsing from static templates"
feature: render
tags: [render, map-reduce-compose, type-statics, data-structure]
---

## Given

- A type `T1` with static template at `@ocas/template-static/html/T1`
- The static template renders to JSON or YAML with slot structure:
  ```yaml
  css: ".foo { color: red; }"
  js: "console.log('foo');"
  ```

## When

- Reduce phase queries and renders the static template
- Static template receives minimal context (no node-specific data)
- Output is parsed to extract slot name → content mapping

## Then

- TypeStatics for `T1` is:
  ```typescript
  {
    "css": ".foo { color: red; }",
    "js": "console.log('foo');"
  }
  ```
- Type signature: `Record<string, string>` (slot name as key, raw content as value)
- Engine does not hardcode slot names like "css" or "js"
- Compose template decides which slots to use and how to assemble them
- If static template renders to non-object, treat as empty TypeStatics `{}`
- If static template is missing, TypeStatics for that type is `undefined` or `{}`
