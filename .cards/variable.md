---
title: Variable
aliases: [Mutable Binding, 变量系统]
tags: [concept, api]
related: [Content Addressing, Garbage Collection, Store]
---

# Variable

Variables are **mutable pointers to immutable data** — the same pattern as git branches pointing to commits. They bridge the gap between OCAS's immutable [[Content Addressing|content-addressed]] storage and the need for mutable state.

## Data Model

A variable is a named binding:

```typescript
type Variable = {
  name: string;       // e.g. "myapp/config"
  schema: Hash;       // type of the pointed-to node
  value: Hash;        // hash of the current node
  created: number;    // Unix epoch ms
  updated: number;    // Unix epoch ms
  tags: Record<string, string>;
  labels: string[];
};
```

The primary key is `(name, schema)` — the same name can point to nodes of different types. When using `var set`, the schema is automatically inferred from the node the hash points to, so you don't need to specify it explicitly.

## Operations

```bash
ocas var set <name> <hash> [--tag env:prod] [--tag pinned]
ocas var get <name> --schema <hash>
ocas var delete <name> [--schema <hash>]
ocas var list [prefix] [--schema <hash>] [--tag env:prod]
ocas var tag <name> --schema <hash> status:active pinned :archived
```

`var set` is an upsert — creates or updates. Name prefix filtering replaces the old scope concept: `var list myapp/` returns all variables under `myapp/`.

## Tags and Labels

Tags and labels share a unified command (`var tag`):

- **Tags** are `key:value` pairs — same-key mutually exclusive (e.g. `env:prod` replaces `env:dev`)
- **Labels** are bare strings (e.g. `pinned`, `important`)
- **Deletion** uses `:` prefix (e.g. `:status` deletes the `status` tag, `:pinned` deletes the label)
- Tag keys and label names share a namespace — you can't have both `status:active` and a `status` label

## Namespace Protection

Variable names starting with `@ocas/` are reserved for internal use. [[Bootstrap]] writes the builtin schema bindings (`@ocas/schema`, `@ocas/string`, `@ocas/output/*`, …) into the variable store, and `@ocas/template/text/<hash>` is used for [[Render System|template]] storage. The CLI rejects user attempts to write to this namespace.

## Names as Hash Inputs

Every CLI command that takes a hash argument also accepts a variable name. The `resolveHash()` helper checks whether the input matches the 13-char hash format; if not, it queries the variable store by exact name and returns the first match's value. This unifies builtin schema names and user-defined variables under a single resolution path — there is no separate "alias" concept.

## Value History

Every variable tracks its last `MAX_HISTORY` (default 10) values with LRU rotation:

- **set()** appends to history: if the new value already exists in history, it rotates to position 0; otherwise it's inserted at 0 and the oldest entry beyond MAX_HISTORY is evicted.
- **Idempotent**: setting the same value as the current (position 0) is a no-op — important for [[Bootstrap]] which calls set() repeatedly.

```bash
ocas var history <name> [--schema <hash-or-name>]   # show history, [0] = current
```

## Role in Garbage Collection

Variables are the **roots** of [[Garbage Collection]]. Any node reachable from a variable's value hash (via [[Schema|ocas_ref]] edges) is kept alive; unreachable nodes are swept.
