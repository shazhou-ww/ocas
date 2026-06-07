# @ocas/core

## 0.4.1 — 2026-06-07

- Fix `gc` failing to preserve nodes referenced via `oneOf` — `collectRefs()` now traverses `oneOf` branches alongside existing `anyOf`/`allOf`/`if-then-else` handling.

## 0.4.0 — 2026-06-07

- New `computeClosure(store, roots)` — traverses references and schema chains to gather a complete CAS closure.
- New `exportBundle()` / `importBundle()` / `loadBundleStore()` — produce and consume self-contained POSIX-tar bundles (`cas/*.bin` CBOR payloads, `vars.jsonl`, `tags.jsonl`).
- New builtin output schemas: `@ocas/output/export`, `@ocas/output/import`.

## 0.3.0 — 2026-06-03

- No API changes. Coordinated version bump with `@ocas/fs` 0.3.0.

## 0.2.2 — 2026-06-03

- Lint and format fixes.

## 0.2.1 — 2026-06-03

- Migrate runtime from Bun to Node.js + pnpm.
- Migrate test framework from `bun:test` to Vitest.
- Extract `VariableStore` SQLite implementation to `@ocas/fs`.

## 0.2.0 — 2026-06-02

### Breaking Changes

- `Store` is now `{ cas: CasStore, var: VarStore, tag: TagStore }` — all sub-stores accessed via properties.
- `bootstrap(store)` and `putSchema(store, schema)` are now synchronous.
- `VariableStore` class removed — SQLite implementation moved to `@ocas/fs`.
- `createVariableStore()` removed.
- Zero `bun:sqlite` imports — pure TypeScript.

### New Features

- `CasStore`, `VarStore`, `TagStore` sub-store types.
- `validation.ts` — shared `validateName()` exported from core.

## 0.1.2 — 2026-06-02

- Fix TypeScript LSP errors: tsconfig `noEmit`, `exactOptionalPropertyTypes` conditional spread, `schemaHash` scope.

## 0.1.1 — 2026-06-02

- Internal improvements.

## 0.1.0 — 2026-06-01

Initial release. Content-addressable store engine with JSON Schema typed nodes, XXH64 hashing, variable store, render with resolution decay, and LiquidJS template support.
