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

The primary key is `(name, schema)` — the same name can point to nodes of different types.

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

Variable names starting with `@ocas/` are reserved for internal use (e.g. `@ocas/template/text/<hash>` for [[Render System|template]] storage). The CLI rejects user attempts to write to this namespace.

## Role in Garbage Collection

Variables are the **roots** of [[Garbage Collection]]. Any node reachable from a variable's value hash (via [[Schema|ocas_ref]] edges) is kept alive; unreachable nodes are swept.
