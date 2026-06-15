---
scenario: "template set stores HTML instance template at @ocas/template/html/<schema-hash>"
feature: template
tags: [template, html, cli]
---

## Given

- A store with bootstrap applied
- A valid schema hash `<schemaHash>` that exists in CAS
- A file `tpl.html` containing `<div class="person"><h2>{{ name }}</h2></div>`

## When

- `ocas template set <schemaHash> tpl.html --format html` is executed

## Then

- The file content is stored in CAS as a `@ocas/string` node, producing `<contentHash>`
- A variable binding is created at `@ocas/template/html/<schemaHash>` pointing to `<contentHash>`
- The output envelope has type `@ocas/output/template-set` with payload `{ schemaHash, contentHash }`
- Exit code is 0
- The variable is NOT stored at `@ocas/template/text/<schemaHash>` (text namespace is untouched)
