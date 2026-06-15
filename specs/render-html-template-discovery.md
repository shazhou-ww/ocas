---
scenario: "HTML format discovers instance templates from @ocas/template/html/<type-hash>"
feature: render
tags: [render, html, template, map-phase]
---

## Given

- A store with nodes of various types
- Format is set to `'html'`
- HTML instance templates registered at `@ocas/template/html/<type-hash>`

## When

- `renderAsync(store, rootHash, { format: 'html' })` is called
- Map phase begins template discovery for each type

## Then

- For each type `T`, query variable `@ocas/template/html/<type-hash-of-T>`
- If found and the variable points to a node with type `@ocas/string`, use it as the LiquidJS template
- If not found or not a string, proceed to fallback behavior
- Template string is compiled by LiquidJS engine
- Instance data (payload + context) is passed to the LiquidJS render
