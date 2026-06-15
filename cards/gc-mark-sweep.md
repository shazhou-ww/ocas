---
id: gc-mark-sweep
title: "GC Mark-and-Sweep with Template-Aware Preservation"
sources:
  - packages/core/src/gc.ts
tags: [core, gc]
created: 2026-06-15
updated: 2026-06-15
---

# GC Mark-and-Sweep

## Root Discovery

GC uses variable values as roots — any CAS node reachable from a variable binding is considered live.

## Template-Aware Two-Phase Collection

The key design: template variables (`@ocas/template/text/*`) are deferred to a second phase.

1. **Phase 1** — Walk all non-template variable values, marking reachable nodes
2. **Phase 2** — For template variables, only walk them if their referenced schema is already in the reachable set

This prevents template-only data from keeping entire schema graphs alive. A template for a schema that has no live data won't prevent that schema from being GC'd.

## Output

Returns `{ kept, removed }` counts and the set of removed hashes.
