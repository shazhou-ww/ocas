---
title: Bootstrap
aliases: [Meta-Schema, Self-Reference, 引导]
tags: [concept, architecture]
related: [Schema, Store, Content Addressing]
---

# Bootstrap

Bootstrap solves the chicken-and-egg problem of a typed content-addressed store: every node needs a schema, but schemas are themselves nodes — so what is the schema of the first schema?

## The Self-Referencing Meta-Schema

The answer is a **self-referencing node** — a node whose `type` field points to its own hash:

```
meta-schema node:
  hash: X
  type: X          ← points to itself
  payload: { ... } ← defines what a valid schema looks like
```

This is the only node in the entire store where `type === hash`. It is the root of the type hierarchy — every schema's type chain eventually leads back to it.

## What Bootstrap Registers

`bootstrap(store)` is called once when a [[Store]] is opened (and is idempotent). It registers:

1. **The meta-schema** — defines the structure of all schemas (allowed JSON Schema keywords)
2. **Primitive type schemas** — `@ocas/string`, `@ocas/number`, `@ocas/object`, `@ocas/array`, `@ocas/bool`
3. **Output schemas** — 18 `@ocas/output/*` schemas for [[Render System|CLI envelope]] types

All of these are stored as regular CAS nodes, addressable by hash. The `@ocas/*` aliases are convenience names resolved at runtime.

## Idempotency

Calling `bootstrap()` multiple times returns the same hashes — because the payloads are identical, [[Content Addressing]] guarantees the same hashes. This means `openStore()` can safely bootstrap on every open without worrying about duplicates.

## Why It Matters

Bootstrap is what makes OCAS fully self-describing. There is no external type registry, no hardcoded special cases (except the single self-reference). A store file contains everything needed to understand its own data — schemas, types, and the meta-schema that defines them all.
