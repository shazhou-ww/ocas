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

GC uses variable values as roots — any CAS node reachable from a variable binding is considered live. Variables are fetched via `store.var.list()` with no limit, returning the full variable set.

## Template-Aware Two-Phase Collection

The key design: text-format instance template variables (`@ocas/template/text/*`) are deferred to a second phase. The constant `TEMPLATE_VAR_PREFIX = "@ocas/template/text/"` controls this filtering.

1. **Phase 1 (mark)** — Walk all variable values as roots, **except** those whose name starts with `@ocas/template/text/`. Uses `walk()` which traverses both `ocas_ref` payload edges and `node.type`, so the entire schema chain is reached automatically.
2. **Phase 2 (template)** — Snapshot the reachable set, then for each reachable hash, look up `@ocas/template/text/<hash>` and walk its content. This preserves template content only when the referenced schema has live data. The snapshot prevents template-only nodes from transitively pulling in further templates.
3. **Sweep** — Delete all CAS nodes not in the reachable set.

## Template Namespace Coverage Asymmetry

The deferred-template logic only targets `@ocas/template/text/*`. With the three-namespace template system (see [template-namespace-system](template-namespace-system.md)), this creates an asymmetry:

| Namespace | Variable pattern | GC behavior |
|-----------|-----------------|-------------|
| Instance (text) | `@ocas/template/text/{hash}` | Deferred — only preserved if schema is reachable |
| Instance (html) | `@ocas/template/html/{hash}` | Treated as regular root — always preserves its content |
| Static | `@ocas/template-static/{format}/{hash}` | Treated as regular root — always preserves its content |
| Compose | `@ocas/template-compose/{format}` | Treated as regular root — always preserves its content |

This means HTML templates, static templates, and compose templates keep their content nodes alive unconditionally, while only text instance templates get the conditional preservation behavior. The template phase also does not walk non-text templates for schemas in the reachable set.

## Output

Returns `GcStats`: `{ total, reachable, collected, scanned }` — total CAS nodes before GC, nodes marked reachable, nodes deleted, and variables scanned as roots.
