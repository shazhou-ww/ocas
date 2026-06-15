---
scenario: "HTML fallback handles nested objects and arrays recursively"
feature: render
tags: [render, html, fallback, structured, nesting]
---

## Given

- A CAS node with hash `ROOT` and type `T`
- The node's payload has nested structure: `{ "meta": { "tags": ["a", "b"] }, "count": 5 }`
- No HTML instance template exists for type `T`
- Format is `'html'`

## When

- `renderAsync(store, ROOT, { format: 'html' })` processes the node

## Then

- Top-level object is rendered as a `<ul>` with `<li>` per key
- The `meta` key's value (a nested object) is rendered as a nested `<ul>`
- The `tags` key's value (an array) is rendered as a nested `<ul>` list
- The `count` key's value (a number) is rendered inline
- All nesting is valid HTML with proper closing tags
- The structure is naturally collapsible via browser rendering (vertical layout, no horizontal overflow)
