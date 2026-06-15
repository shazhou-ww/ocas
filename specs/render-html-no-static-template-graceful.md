---
scenario: "Types without static templates render normally with empty statics"
feature: render
tags: [render, html, type-statics, graceful-degradation]
---

## Given

- A store with bootstrap
- A schema `noteSchema` with properties `{ text: string }`
- An HTML instance template registered at `@ocas/template/html/<noteSchema>`
  - Content: `<div class="note">{{ text }}</div>`
- **No** static template registered at `@ocas/template-static/html/<noteSchema>`
- A note node stored with `{ text: "Hello world" }`

## When

- `renderAsync(store, noteHash, { format: 'html' })` is called
- `collectTypeStatics` queries `@ocas/template-static/html/<noteSchema>`
- The variable is not found

## Then

- The note renders normally: `<div class="note">Hello world</div>`
- The output is a complete HTML5 document (via builtin or custom compose)
- No `<style>` or `<script>` tags are generated for the note type
- No errors are thrown — missing static templates are silently skipped
- The `type_statics` passed to compose is an empty record `{}` for this type
