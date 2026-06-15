---
scenario: "template set --format html works with --inline"
feature: template
tags: [template, html, cli, inline]
---

## Given

- A store with bootstrap applied
- A valid schema hash `<schemaHash>` that exists in CAS

## When

- `ocas template set <schemaHash> --inline "<p>{{ name }}</p>" --format html` is executed

## Then

- The inline text `<p>{{ name }}</p>` is stored in CAS as a `@ocas/string` node
- A variable binding is created at `@ocas/template/html/<schemaHash>`
- The output envelope has type `@ocas/output/template-set` with payload `{ schemaHash, contentHash }`
- Exit code is 0
