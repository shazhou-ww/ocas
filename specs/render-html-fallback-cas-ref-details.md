---
scenario: "HTML fallback renders CAS ref fields as collapsible <details>/<summary>"
feature: render
tags: [render, html, fallback, structured, cas-ref]
---

## Given

- A CAS node with hash `ROOT` and type `T`
- Type `T`'s schema declares a property `author` with `format: "ocas_ref"`
- The `author` field holds hash `CHILD` which points to another valid CAS node
- No HTML instance template exists for type `T` or the child's type
- Format is `'html'`
- Resolution is above epsilon (default options)

## When

- `renderAsync(store, ROOT, { format: 'html' })` processes the node

## Then

- The `author` field is rendered as a `<details>` element
- The `<summary>` identifies the ref field name and target hash
- The `<details>` body contains the recursively rendered child node (structured HTML, not YAML)
- The child node is itself rendered using the structured HTML fallback (nested `<ul>`, etc.)
- Resolution decay is applied to the child rendering (same decay model as YAML path)
