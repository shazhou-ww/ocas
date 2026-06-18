# @ocas/fs

## 0.5.0 — 2026-06-18

- feat: add FsCasStore.reindex() for proactive index repair and `ocas reindex` CLI command

## 0.4.1 — 2026-06-10

- fix: dedupe type index files and rewrite on delete to prevent unbounded growth across store reopens. `parseIndexFile` now dedupes on read, `appendToTypeIndex` skips entries already present in memory, and `delete()` rewrites the on-disk type-index file even when the underlying node cannot be decoded (missing or corrupted .bin). Fixes #116.

## 0.4.0 — 2026-06-07

- Lazy loading: `FsStore` scans only filenames in `nodes/` at startup (no CBOR decoding), reads each node from disk on first `get()`. Startup is O(filenames) instead of O(decoded-bytes).
- Move CAS node files from store root into `nodes/` subdirectory. Pre-existing flat-layout stores are auto-migrated on first open.

## 0.3.0 — 2026-06-03

- Migrate from `better-sqlite3` to built-in `node:sqlite` — zero native addon dependencies.

## 0.2.2 — 2026-06-03

- Lint and format fixes.

## 0.2.1 — 2026-06-03

- Migrate var/tag store from JSONL to `better-sqlite3`.
- `openStore()` now returns unified `Store` with `cas`, `var`, `tag` sub-stores.
- Migrate runtime from Bun to Node.js + pnpm.

## 0.2.0 — 2026-06-02

### Breaking Changes

- `openStoreAndVarStore()` removed — use `openStore()` returning unified `Store`.
- `RenderOptions.varStore` removed — templates resolved via `store.var` internally.

### New Features

- SQLite-backed `VarStore` and `TagStore` implementations.
- `TagStore` — first-class tags on any CAS node.
- `var-store-helpers.ts` — shared validation/history logic.

## 0.1.2 — 2026-06-02

- Updated dependencies.

## 0.1.1 — 2026-06-02

- Updated dependencies.

## 0.1.0 — 2026-06-01

Initial release. Filesystem-backed CAS store with SQLite indexing and auto-bootstrap.
