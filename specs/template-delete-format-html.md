---
scenario: "template delete --format html removes HTML instance template"
feature: template
tags: [template, html, delete, cli]
---

## Given

- A store with bootstrap applied
- An HTML instance template set for `<schemaHash>` (via `ocas template set <schemaHash> ... --format html`)
- A text template also set for `<schemaHash>` (via `ocas template set <schemaHash> ...`)

## When

- `ocas template delete <schemaHash> --format html` is executed

## Then

- The variable `@ocas/template/html/<schemaHash>` is removed
- The output envelope has type `@ocas/output/template-delete` with payload `{ deleted: true }`
- Exit code is 0
- The text template at `@ocas/template/text/<schemaHash>` is NOT affected
- A subsequent `ocas template get <schemaHash> --format html` fails with "Template not found"
- A subsequent `ocas template get <schemaHash>` (text) still succeeds

## And — not found

Given no HTML template exists for `<otherSchema>`:

- `ocas template delete <otherSchema> --format html` exits with non-zero code
- Error message: `Error: Template not found for schema: <otherSchema>`
