---
scenario: "Format option defaults to 'text' when not specified"
feature: render
tags: [render, map-reduce-compose, options]
---

## Given

- A store with a root node
- No format option provided in renderAsync call

## When

- `renderAsync(store, rootHash)` is called without options
- Or `renderAsync(store, rootHash, {})` with empty options

## Then

- Format defaults to `'text'`
- Template discovery uses `@ocas/template/text/...` namespace
- Compose template discovery uses `@ocas/template/text/@compose`
- Static templates use `@ocas/template/text/{typeHash}/static`
- Existing behavior is preserved (all current callers get text format)
