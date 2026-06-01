---
title: Garbage Collection
aliases: [GC, 垃圾回收]
tags: [concept, api]
related: [Variable, Schema, Store]
---

# Garbage Collection

OCAS uses **mark-and-sweep** garbage collection to reclaim storage from nodes that are no longer referenced.

## Algorithm

1. **Roots** — all [[Variable]] values are roots
2. **Mark** — from each root, recursively `walk()` the DAG via [[Schema|ocas_ref]] edges, marking every reachable node and its schema
3. **Schema chain preservation** — walk each reachable node's type chain upward to preserve the meta-schema hierarchy
4. **Bootstrap preservation** — self-referencing nodes (where `type === hash`) are always kept alive
5. **Sweep** — delete all unmarked nodes

```bash
ocas gc
# → { total, reachable, collected, scanned }
```

## Key Properties

- **Global** — GC operates on the entire [[Store]], not scoped to any variable prefix. Cross-reference between variables is valid and expected
- **Schema-aware** — the type (schema) of every reachable node is also marked as reachable, preventing orphaned schemas
- **Safe** — bootstrap nodes (the self-referencing meta-schema) are unconditionally preserved, so GC can never break the store's foundation
- **Deterministic** — same store state always produces the same GC result

## What Stays Alive

A node survives GC if any of the following is true:

- A [[Variable]] points to it directly
- It is reachable via `ocas_ref` edges from a variable's value
- It is the schema (type) of any reachable node
- It is a self-referencing [[Bootstrap]] node
