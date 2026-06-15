---
scenario: "template set --format html --static stores at @ocas/template-static/html/<schema-hash>"
feature: template
tags: [template, html, static, cli]
---

## Given

- A store with bootstrap applied
- A valid schema hash `<schemaHash>` that exists in CAS
- A file `static.json` containing `{"css": ".person { color: blue; }", "js": "console.log('loaded');"}`

## When

- `ocas template set <schemaHash> static.json --format html --static` is executed

## Then

- The file content is stored in CAS as a `@ocas/string` node, producing `<contentHash>`
- A variable binding is created at `@ocas/template-static/html/<schemaHash>` pointing to `<contentHash>`
- The output envelope has type `@ocas/output/template-set` with payload `{ schemaHash, contentHash }`
- Exit code is 0
- The variable is distinct from `@ocas/template/html/<schemaHash>` (instance template) and `@ocas/template/text/<schemaHash>` (text template)
