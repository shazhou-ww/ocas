---
scenario: "Nodes without HTML templates fall back to YAML in <pre><code>"
feature: render
tags: [render, html, fallback]
---

## Given

- A node of type `T`
- No HTML instance template exists at `@ocas/template/html/<type-hash-of-T>`
- Format is `'html'`

## When

- `renderAsync(store, rootHash, { format: 'html' })` processes the node
- Map phase fails to find an HTML template for type `T`
- Fallback render is invoked

## Then

- The node's payload is serialized to YAML format
- Output is wrapped in `<pre><code>` tags: `<pre><code>field: value\n...</code></pre>`
- The fallback HTML fragment is valid and safe (no unescaped angle brackets in YAML content)
- The fragment is passed to reduce/compose phases like any other rendered fragment
