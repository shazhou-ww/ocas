---
scenario: "template list --format html lists only HTML templates"
feature: template
tags: [template, html, list, cli]
---

## Given

- A store with bootstrap applied
- Two text templates set for schemas `A` and `B` (via `ocas template set <A> ... ` and `ocas template set <B> ...`)
- One HTML instance template set for schema `A` (via `ocas template set <A> ... --format html`)
- One HTML static template set for schema `C` (via `ocas template set <C> ... --format html --static`)

## When

- `ocas template list --format html` is executed

## Then

- The output envelope has type `@ocas/output/template-list`
- The payload is an array listing only templates under the `@ocas/template/html/` prefix
- Schema `A` appears (instance template)
- Schema `C` appears with `/static` suffix (static template)
- Text templates for `A` and `B` are NOT included
- Exit code is 0
