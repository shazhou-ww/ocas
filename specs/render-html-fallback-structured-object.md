---
scenario: "HTML fallback renders object payloads as <ul> key-value lists"
feature: render
tags: [render, html, fallback, structured]
---

## Given

- A CAS node with hash `ROOT` and type `T`
- The node's payload is an object: `{ "name": "Alice", "age": 30 }`
- No HTML instance template exists at `@ocas/template/html/<type-hash-of-T>`
- Format is `'html'`

## When

- `renderAsync(store, ROOT, { format: 'html' })` processes the node
- Map phase fails to find an HTML template for type `T`
- Structured HTML fallback is invoked

## Then

- The output contains a `<ul>` element with `<li>` children for each key-value pair
- Each `<li>` displays the key and its value (e.g. key label + rendered value)
- No `<pre><code>` YAML wrapping is used
- The output is valid HTML
- Key ordering matches the object's own key order
