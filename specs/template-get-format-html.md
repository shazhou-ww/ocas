---
scenario: "template get --format html retrieves HTML instance template"
feature: template
tags: [template, html, cli]
---

## Given

- A store with bootstrap applied
- An HTML instance template previously set via `ocas template set <schemaHash> tpl.html --format html`
- The template content is `<div class="person"><h2>{{ name }}</h2></div>`

## When

- `ocas template get <schemaHash> --format html` is executed

## Then

- The output envelope has type `@ocas/output/template-get` with the template string as payload
- The payload is `<div class="person"><h2>{{ name }}</h2></div>`
- Exit code is 0

## And — not found

Given no HTML template has been set for `<otherSchema>`:

- `ocas template get <otherSchema> --format html` exits with non-zero code
- Error message: `Error: Template not found for schema: <otherSchema>`
- Even if a text template exists for `<otherSchema>`, it is not returned when `--format html` is specified
