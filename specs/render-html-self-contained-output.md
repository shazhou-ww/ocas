---
scenario: "HTML render output is a valid self-contained document"
feature: render
tags: [render, html, output, validation]
---

## Given

- A store with a root node (any valid type)
- Format is `'html'`

## When

- `ocas render <hash> --format html` is executed
- Output is captured from stdout

## Then

- Output is a complete, valid HTML5 document
- Document starts with `<!DOCTYPE html>`
- Has `<html>`, `<head>`, and `<body>` elements (from builtin or custom compose template)
- Can be saved to a file and opened in a browser without errors
- Passes basic HTML validation (e.g., W3C validator, browser dev tools)
- All content is embedded inline (no external dependencies required in MVP)
