---
scenario: "Three-phase pipeline execution sequence"
feature: render
tags: [render, map-reduce-compose, pipeline]
---

## Given

- A store with root node and nested structure
- Format is specified (e.g., `'text'` or `'html'`)

## When

- `renderAsync(store, rootHash, { format })` is called

## Then

- **Phase 1 (Map)**: DFS traversal renders content recursively
  - Side-channel collects encountered type hashes in a Set
  - Existing render logic unchanged
  - Produces: `content` string + `encounteredTypes` Set
  
- **Phase 2 (Reduce)**: Type statics collection
  - For each unique type in `encounteredTypes`
  - Query `@ocas/template/{format}/{typeHash}/static`
  - Render static template (if exists)
  - Produces: `typeStatics` Record<Hash, TypeStatics>
  
- **Phase 3 (Compose)**: Final assembly
  - Query `@ocas/template/{format}/@compose` for compose template
  - If exists: render with `{ content, type_statics: typeStatics }`
  - If missing: return `content` as-is (identity)
  - Produces: final output string

- Phases execute sequentially: map → reduce → compose
- Each phase is independent and testable
