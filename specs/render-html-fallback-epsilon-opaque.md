---
scenario: "HTML fallback shows non-expandable cas:XXXXX at epsilon"
feature: render
tags: [render, html, fallback, structured, epsilon]
---

## Given

- A CAS node tree with depth ≥ 3 levels of `ocas_ref` nesting
- No HTML instance templates exist for any type in the tree
- Format is `'html'`
- Resolution/decay/epsilon are set so that deeper nodes reach epsilon (e.g. `resolution: 1.0, decay: 0.5, epsilon: 0.3`)

## When

- `renderAsync(store, ROOT, { format: 'html' })` processes the root node
- At a certain depth, `currentResolution < epsilon`

## Then

- Nodes at or below epsilon are rendered as opaque `cas:XXXXX` text (where `XXXXX` is the 13-char hash)
- The `cas:XXXXX` reference is NOT wrapped in a `<details>` element (it is not expandable)
- Higher-level nodes above epsilon are still rendered with full structured HTML
