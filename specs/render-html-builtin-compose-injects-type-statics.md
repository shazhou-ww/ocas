---
scenario: "Builtin HTML compose shell injects type_statics CSS in head and JS in body"
feature: render
tags: [render, html, compose-template, type-statics, builtin]
---

## Given

- A store with bootstrap
- A schema with an HTML instance template and a static template providing CSS and JS
- No custom compose template registered at `@ocas/template/html/_compose`
- `collectTypeStatics` returns a non-empty `Record<Hash, TypeStatics>` with at least one type having both `css` and `js` slots

## When

- `renderAsync(store, nodeHash, { format: 'html' })` is called
- `findComposeTemplate` returns `null` (no custom compose template)
- The builtin HTML compose shell is used

## Then

- The builtin shell produces a complete HTML5 document: `<!DOCTYPE html><html>...</html>`
- CSS from `type_statics` is injected as `<style>` tags inside `<head>`, before `</head>`
- JS from `type_statics` is injected as `<script>` tags at the bottom of `<body>`, after the content and before `</body>`
- The rendered instance content appears inside `<body>`
- The builtin shell now accepts `type_statics` (previously it only accepted `content`)
- Each type's CSS produces one `<style>` block; each type's JS produces one `<script>` block
- The document structure is:
  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OCAS Render</title>
    <style>/* type T1 css */</style>
    <style>/* type T2 css */</style>
  </head>
  <body>
    {{ content }}
    <script>/* type T1 js */</script>
    <script>/* type T2 js */</script>
  </body>
  </html>
  ```
