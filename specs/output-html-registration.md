---
scenario: "registerOutputTemplates registers HTML instance templates for all @ocas/output/* schemas"
feature: render
tags: [output, html, template, registration]
---

## Given

- A store with bootstrap completed
- `registerOutputTemplates(store)` has been called

## When

- For each of the 24 `@ocas/output/*` schemas registered in bootstrap:
  - `put`, `get`, `has`, `hash`, `verify`, `refs`, `walk`, `list`, `list-meta`, `list-schema`, `var-set`, `var-get`, `var-delete`, `var-list`, `var-history`, `tag`, `untag`, `template-set`, `template-get`, `template-list`, `template-delete`, `gc`, `export`, `import`
- Query `store.var.get("@ocas/template/html/<schema-hash>", stringHash)`

## Then

- Every `@ocas/output/*` schema has a corresponding `@ocas/template/html/<hash>` variable
- Each variable points to a CAS node of type `@ocas/string` containing a valid LiquidJS template
- The HTML templates are distinct from the text templates (registered under `/text/` prefix)
- Registration is idempotent — calling `registerOutputTemplates` multiple times returns the same hashes
