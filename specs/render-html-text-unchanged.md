---
scenario: "Existing text format rendering is unaffected by HTML feature"
feature: render
tags: [render, html, text, backward-compat]
---

## Given

- All existing tests for text format rendering
- All existing callers of `renderAsync` without explicit format option
- HTML format feature is implemented

## When

- `ocas render <hash>` is executed (no --format option)
- Or `ocas render <hash> --format text` is executed
- Or `renderAsync(store, hash)` is called without options

## Then

- Format defaults to `'text'`
- Template discovery uses `@ocas/template/text/...` namespace
- Compose template uses `@ocas/template/text/@compose` (identity compose)
- All existing tests pass without modification
- Text output format is identical to pre-HTML implementation
- No regression in text rendering behavior
