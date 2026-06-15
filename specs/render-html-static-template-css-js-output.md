---
scenario: "Static template CSS/JS appears in rendered HTML document"
feature: render
tags: [render, html, type-statics, css, js]
---

## Given

- A store with bootstrap
- A schema `personSchema` with properties `{ name: string, age: number }`
- An HTML instance template registered at `@ocas/template/html/<personSchema>`
  - Content: `<div class="person"><h2>{{ name }}</h2><p>Age: {{ age }}</p></div>`
- A static template registered at `@ocas/template-static/html/<personSchema>`
  - Content: `{"css": ".person { color: blue; font-size: 14px; }", "js": "console.log('person loaded');"}`
- A person node stored with `{ name: "Alice", age: 30 }`

## When

- `renderAsync(store, personHash, { format: 'html' })` is called

## Then

- The output contains the rendered instance content `<div class="person"><h2>Alice</h2>...`
- The output contains the CSS from the static template inside a `<style>` tag within `<head>`
  - `<style>.person { color: blue; font-size: 14px; }</style>`
- The output contains the JS from the static template inside a `<script>` tag at the bottom of `<body>`
  - `<script>console.log('person loaded');</script>`
- The CSS appears before `</head>` (in the head section)
- The JS appears after the content but before `</body>` (at the bottom of body)
