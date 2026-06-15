---
scenario: "template commands without --format default to text (backward compat)"
feature: template
tags: [template, backward-compat, cli]
---

## Given

- A store with bootstrap applied
- A valid schema hash `<schemaHash>` that exists in CAS
- A file `tpl.txt` containing `Name: {{ name }}`

## When

- `ocas template set <schemaHash> tpl.txt` is executed (no `--format` flag)

## Then

- The variable is created at `@ocas/template/text/<schemaHash>` (text namespace)
- Behavior is identical to the pre-existing implementation
- Exit code is 0

## And — get default

- `ocas template get <schemaHash>` (no `--format`) retrieves from `@ocas/template/text/<schemaHash>`

## And — list default

- `ocas template list` (no `--format`) lists templates under `@ocas/template/text/` prefix only

## And — delete default

- `ocas template delete <schemaHash>` (no `--format`) removes from `@ocas/template/text/<schemaHash>` only
