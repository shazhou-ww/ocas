---
id: unified-store-composition
title: "Unified Store Composition: FS CAS + SQLite Var/Tag"
sources:
  - packages/fs/src/store.ts
  - packages/fs/src/sqlite-store.ts
tags: [fs, store, architecture]
created: 2026-06-15
updated: 2026-06-15
---

# Unified Store Composition

## Three Sub-Stores

The `Store` interface composes three independent backends:
- `cas: CasStore` — content-addressed node storage
- `var: VarStore` — named variable bindings
- `tag: TagStore` — hash-keyed tag sets

## FS Implementation

`openStore()` in `@ocas/fs` composes:
- **CAS** → filesystem CBOR files (one file per node, named by hash)
- **Variables + Tags** → SQLite WAL-mode database

## Core vs FS

`@ocas/core` provides pure in-memory implementations (`MemoryStore`) with zero SQLite dependency. `@ocas/fs` selectively replaces CAS with filesystem storage and var/tag with SQLite.

## Lazy Loading

At startup, only filenames are scanned (no CBOR decode). Nodes are loaded and cached on first `get()`. Type-index files (`_index/<typeHash>`) enable O(1) `listByType` without full scan.

## Bootstrap

`openStore()` automatically calls `bootstrap(store)` to register builtin schemas and variables.
