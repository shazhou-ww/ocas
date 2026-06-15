---
id: closure-computation
title: "Four-Phase Transitive Closure for Bundle Export"
sources:
  - packages/core/src/closure.ts
tags: [core, bundle]
created: 2026-06-15
updated: 2026-06-15
---

# Four-Phase Transitive Closure

## Purpose

When exporting a subset of the store (bundle), we need the complete transitive closure — all nodes and metadata needed to reconstruct the subset in another store.

## Four Phases

1. **Walk refs** — BFS from root nodes, collecting all reachable CAS nodes (including type chains)
2. **Template discovery** — Find template variables (`@ocas/template/text/*`) whose schema is in the closure
3. **Variable collection** — Collect non-template variables whose values point into the closure
4. **Tag collection** — Collect tags attached to nodes in the closure

The result is a self-contained portable subset: CAS nodes + variables + tags + templates.

## Why Four Phases

Templates depend on schemas being in the closure (phase 2 needs phase 1). Variables and tags are metadata that reference CAS nodes (phases 3-4 need phase 1). The ordering ensures completeness without redundant walks.
