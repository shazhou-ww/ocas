---
scenario: "CLI accepts --format html option for render command"
feature: render
tags: [render, html, cli]
---

## Given

- A store with a valid root node
- The CLI render command supports format options

## When

- `ocas render <hash> --format html` is executed

## Then

- The `--format` option is parsed and passed to `renderAsync(store, hash, { format: 'html' })`
- Output is a complete HTML document written to stdout
- Exit code is 0 on success
- The HTML document starts with `<!DOCTYPE html>`
