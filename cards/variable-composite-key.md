---
id: variable-composite-key
title: "Variable Composite Key: (name, schema) with Auto-Derived Schema"
sources:
  - packages/core/src/variable.ts
  - packages/core/src/var-store-helpers.ts
  - packages/core/src/store.ts
tags: [core, variables]
created: 2026-06-15
updated: 2026-06-15
---

# Variable Composite Key

## Design

Variables are keyed by `(name, schema)` — not just name. The schema is auto-extracted from the CAS node's type field via `extractSchema()`.

This means the same variable name can hold values of different types without collision, enabling schema-aware variable lookup.

## Variable Naming Convention

All names must follow `@scope/name` format (`@[a-zA-Z][a-zA-Z0-9]*/segments`):
- `@ocas/*` — reserved for builtins
- User variables use custom scopes

The `@` prefix ensures names are visually distinct from hashes.

## Resolution

`resolveHash(input, store)` in the CLI is the unified resolver: if input matches the 13-char hash format, it's returned as-is; otherwise `store.var` is queried by exact name. Every CLI command that accepts a hash also accepts a variable name.
