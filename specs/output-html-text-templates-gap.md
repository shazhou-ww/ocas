---
scenario: "Text templates are added for schemas missing them (list-meta, list-schema, export, import)"
feature: render
tags: [output, template, text, gap]
---

## Given

- Bootstrap registers 24 `@ocas/output/*` schemas
- `output-templates.ts` currently has text templates for only 20 schemas
- Missing text templates: `@ocas/output/list-meta`, `@ocas/output/list-schema`, `@ocas/output/export`, `@ocas/output/import`

## When

- `registerOutputTemplates(store)` is called

## Then

- All 24 `@ocas/output/*` schemas have both text AND html templates registered
- `@ocas/output/list-meta` text template formats as a list of `{ hash, created, updated }` entries (same format as `@ocas/output/list`)
- `@ocas/output/list-schema` text template formats as a list of `{ hash, created, updated }` entries (same format as `@ocas/output/list`)
- `@ocas/output/export` text template shows `nodes`, `vars`, `tags` counts
- `@ocas/output/import` text template shows nested import results (nodes imported/skipped, vars created/updated, tags)
- Existing 20 text templates remain unchanged
