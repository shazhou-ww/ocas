---
scenario: "HTML fallback renders array payloads as <ul> lists"
feature: render
tags: [render, html, fallback, structured]
---

## Given

- A CAS node with hash `ROOT` and type `T`
- The node's payload is an array: `["apple", "banana", "cherry"]`
- No HTML instance template exists at `@ocas/template/html/<type-hash-of-T>`
- Format is `'html'`

## When

- `renderAsync(store, ROOT, { format: 'html' })` processes the node

## Then

- The output contains a `<ul>` element with one `<li>` per array item
- Each `<li>` renders its item value
- Array items appear in their original order
- No `<pre><code>` YAML wrapping is used
