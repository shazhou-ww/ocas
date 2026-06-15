---
scenario: "User-defined @ocas/template-compose/html overrides builtin shell"
feature: render
tags: [render, html, compose-template, customization]
---

## Given

- A store with a root node
- Format is `'html'`
- A custom compose template registered at variable `@ocas/template-compose/html`
- The variable points to a node with type `@ocas/string` containing LiquidJS template

## When

- `renderAsync(store, rootHash, { format: 'html' })` reaches compose phase
- `findComposeTemplate(store, rootType, 'html')` finds the custom template

## Then

- The custom compose template is used instead of the builtin default
- The custom template receives `{ content: <composed-content> }` as LiquidJS context
- Output follows the structure defined in the custom template
- This allows users to customize the document shell, add CSS/JS, change structure, etc.
