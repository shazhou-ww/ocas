---
scenario: "HTML format uses builtin compose template when none is registered"
feature: render
tags: [render, html, compose-template]
---

## Given

- A store with a root node
- Format is `'html'`
- No user-defined compose template at `@ocas/template/html/_compose`

## When

- `renderAsync(store, rootHash, { format: 'html' })` reaches compose phase
- `findComposeTemplate(store, rootType, 'html')` is called
- No compose template variable exists

## Then

- A builtin default HTML compose template is used
- The compose template wraps the content in a complete HTML document structure:
  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OCAS Render</title>
  </head>
  <body>
    {{ content }}
  </body>
  </html>
  ```
- The `{{ content }}` placeholder is replaced with the rendered content
- Output is a valid, self-contained HTML document
