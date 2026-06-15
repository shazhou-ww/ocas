---
scenario: "Custom HTML templates take priority over structured HTML fallback"
feature: render
tags: [render, html, fallback, template-priority]
---

## Given

- A CAS node with hash `ROOT` and type `T`
- An HTML instance template IS registered at `@ocas/template/html/<type-hash-of-T>`
- Format is `'html'`

## When

- `renderAsync(store, ROOT, { format: 'html' })` processes the node

## Then

- The custom HTML instance template is used to render the node
- The structured HTML fallback code path is NOT invoked
- Behavior is identical to the existing template rendering (no regression)
