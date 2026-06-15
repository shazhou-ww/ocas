---
scenario: "--static flag without --format html is rejected"
feature: template
tags: [template, static, error-handling, cli]
---

## Given

- A store with bootstrap applied
- A valid schema hash `<schemaHash>` that exists in CAS
- A file `static.json` with valid content

## When

- `ocas template set <schemaHash> static.json --static` is executed (no `--format html`)

## Then

- The command exits with non-zero exit code
- An error message is printed indicating `--static` is only valid with `--format html`
- No variable is created
