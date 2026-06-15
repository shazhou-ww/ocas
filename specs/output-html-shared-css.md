---
scenario: "Shared CSS is provided via static templates for output types"
feature: render
tags: [output, html, template, static, css]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed
- The function registers `@ocas/template-static/html/<hash>` entries for output schema types

## When

- `renderAsync(store, envelopeHash, { format: "html" })` is called for any output envelope
- The reduce phase collects static templates for encountered types
- The compose phase applies the builtin HTML shell (no custom compose template)

## Then

- Static templates contain valid JSON with a `"css"` key providing shared CSS styles
- CSS is injected into `<style>` blocks within `<head>` by the builtin HTML shell
- Styles provide a reasonable default appearance for output elements (tables, code, cards, etc.)
- The CSS uses a scoped naming convention (e.g. class prefixes like `.ocas-`) to avoid conflicts
- When multiple output types appear in a single render, each type's CSS is included once (deduplication by the existing reduce phase)
- The compose template is NOT modified — the builtin HTML shell handles injection as-is
