---
scenario: "Text format fallback is unchanged — still produces YAML"
feature: render
tags: [render, text, fallback, regression]
---

## Given

- A CAS node with hash `ROOT` and type `T`
- No text instance template exists for type `T`
- Format is `'text'` (the default)

## When

- `renderAsync(store, ROOT, { format: 'text' })` processes the node

## Then

- Output is plain YAML text (same as before this change)
- No HTML tags appear in the output
- The structured HTML fallback is not triggered for text format
