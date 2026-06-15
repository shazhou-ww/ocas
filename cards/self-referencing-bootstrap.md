---
id: self-referencing-bootstrap
title: "Self-Referencing Bootstrap and BOOTSTRAP_STORE Protocol"
sources:
  - packages/core/src/bootstrap.ts
  - packages/core/src/bootstrap-capable.ts
  - packages/core/src/hash.ts
tags: [core, bootstrap]
created: 2026-06-15
updated: 2026-06-15
---

# Self-Referencing Bootstrap

## The Chicken-and-Egg Problem

The meta-schema node's type field points to its own hash. This creates a circular dependency: you need the hash to create the node, but you need the node to compute the hash.

## Solution: computeSelfHash

`computeSelfHash(payload)` computes `XXH64(CBOR(payload))` — no type prefix — since the type IS the resulting hash. The payload is constructed with a placeholder, then the hash is computed and inserted.

## BOOTSTRAP_STORE Symbol Protocol

`Symbol.for('@ocas/core/bootstrap-store')` is a protocol that store implementations expose to allow creating the self-referencing meta-schema node. Both `MemoryStore` and `FsStore` attach this symbol method.

This keeps the self-hash creation mechanism out of the public `CasStore` interface — only `bootstrap()` uses it.

## Bootstrap Sequence

`bootstrap(store)` writes all builtin schemas and variable bindings:
1. Creates the self-referencing meta-schema node
2. Creates builtin schema nodes (string, output envelopes, etc.)
3. Registers variables (`@ocas/schema`, `@ocas/string`, `@ocas/output/*`, etc.)

Called automatically by `openStore()` in `@ocas/fs`.
