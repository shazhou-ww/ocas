# @ocas/fs

## 0.4.0 — 2026-06-07

- `FsStore` now uses lazy loading: at startup it scans only filenames in the `nodes/` subdirectory (no CBOR decoding) and reads each node from disk on first `get()`. This makes startup O(filenames) instead of O(decoded-bytes), keeps memory usage bounded by what's actually accessed, and avoids paying the full-load cost for stores with many nodes. Behaviour is unchanged: `has()`, `listAll()`, `listByType()`, `listMeta()`, and `listSchemas()` return the same results as before. Index/meta migration paths still work — they perform a one-time scan + decode when `_index/` is missing.
- Move CAS node files from the store root into a `nodes/` subdirectory. Pre-existing flat-layout stores are auto-migrated on first open: any `<HASH>.bin` files in the store root are renamed into `nodes/`. Metadata (`_index/`, `_store.db`, `_meta`) remain at the store root unchanged.

## 0.3.0 — 2026-06-03

- Migrate from better-sqlite3 to built-in node:sqlite — zero native addon dependencies, no more NODE_MODULE_VERSION mismatch across Node upgrades.

## 0.2.0

### Breaking Changes

- `Store` is now `{ cas: CasStore, var: VarStore, tag: TagStore }` — all sub-stores accessed via properties
- `bootstrap(store)` and `putSchema(store, schema)` are now **synchronous** (were async)
- `VariableStore` class removed from `@ocas/core` — SQLite implementation moved to `@ocas/fs`
- `createVariableStore()` removed from `@ocas/core`
- `openStoreAndVarStore()` removed — use `openStore()` returning unified `Store`
- `RenderOptions.varStore` removed — templates resolved via `store.var` internally
- `@ocas/core` has zero `bun:sqlite` imports — pure TypeScript
- `ocas var tag` subcommand removed — use `ocas tag` / `ocas untag` instead

### New Features

- `CasStore`, `VarStore`, `TagStore` sub-store types
- `TagStore` — first-class tags on any CAS node (not just variables)
- Top-level `ocas tag <target> <tag>...` and `ocas untag <target> <tag>...` commands
- `ocas get` and `ocas var get` now include tag info in output
- `ocas list --tag` and `ocas var list --tag` filter support
- `var-store-helpers.ts` — shared validation/history logic
- `validation.ts` — shared `validateName()` exported from core

## 0.1.2

### Patch Changes

- Updated dependencies:
  - @ocas/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies:
  - @ocas/core@0.1.1

## 0.1.0

Initial release as `@ocas/fs`. Filesystem-backed CAS store with SQLite indexing and auto-bootstrap.
