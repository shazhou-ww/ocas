---
scenario: "HTML fallback renders primitive payloads as inline elements"
feature: render
tags: [render, html, fallback, structured]
---

## Given

- A CAS node with hash `ROOT` and type `T`
- The node's payload is a primitive value (string, number, or boolean)
- No HTML instance template exists at `@ocas/template/html/<type-hash-of-T>`
- Format is `'html'`

## When

- `renderAsync(store, ROOT, { format: 'html' })` processes the node

## Then

- String values are rendered as a `<span>` or `<code>` inline element
- Number and boolean values are rendered as a `<span>` or `<code>` inline element
- The value is HTML-escaped (e.g. `<` becomes `&lt;`)
- No `<pre><code>` block-level YAML wrapping is used
