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

1. **Walk refs** — BFS from root nodes, collecting all reachable CAS nodes (including type chains). Uses `walk()` which traverses both `ocas_ref` payload edges and `node.type`, so the entire schema chain is reached automatically.
2. **Template discovery** — For each schema hash found in phase 1, look up `@ocas/template/text/<schema-hash>` and walk the template content node into the closure.
3. **Variable collection** — Scan all variables; include any whose value hash is already in the closure. Template variables from phase 2 are deduplicated via a `name\0schema` composite key.
4. **Tag collection** — Collect tags attached to nodes in the closure.

The result is a self-contained portable subset: CAS nodes + variables + tags + templates.

## Why Four Phases

Templates depend on schemas being in the closure (phase 2 needs phase 1). Variables and tags are metadata that reference CAS nodes (phases 3-4 need phase 1). The ordering ensures completeness without redundant walks.

## Template Namespace Coverage Gap

Phase 2 currently hardcodes `@ocas/template/text/<hash>` for template discovery. With the three-namespace template system (see [template-namespace-system](template-namespace-system.md)), this means:

| Namespace | Variable pattern | Discovered by closure? |
|-----------|-----------------|----------------------|
| Instance (text) | `@ocas/template/text/{hash}` | Yes — explicit phase 2 lookup |
| Instance (html) | `@ocas/template/html/{hash}` | Partially — caught by phase 3 only if content hash is already in the closure |
| Static | `@ocas/template-static/{format}/{hash}` | Partially — caught by phase 3 only if content hash is already in the closure |
| Compose | `@ocas/template-compose/{format}` | Partially — caught by phase 3 only if content hash is already in the closure |

Phase 3 (variable collection) acts as a safety net: it includes any variable whose value is already in the node set. However, static and compose template content nodes are not walked in phase 2, so their transitive refs (if any) may be missed. For bundles that rely on HTML rendering with static assets, the closure may be incomplete.
