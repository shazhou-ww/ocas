---
scenario: "Compose template is discovered by format and root type"
feature: render
tags: [render, map-reduce-compose, compose-template]
---

## Given

- A store with a root node of type `T_root`
- Compose template registered at variable `@ocas/template/{format}/@compose`
- Format is `'text'` or `'html'`

## When

- `renderAsync(store, rootHash, { format })` is called
- After map+reduce phases complete, compose phase begins
- `findComposeTemplate(store, rootType, format)` queries for compose template

## Then

- First attempt: query variable `@ocas/template/{format}/@compose` (global compose template)
- If found, return the template string
- If not found, return `null` (identity compose will be used)
- The compose template variable must have type `@ocas/string` (string schema)
- If the variable points to a non-string node, return `null`
