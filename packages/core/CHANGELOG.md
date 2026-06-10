# @ocas/core

## 0.5.0 — 2026-06-10

- fix: `walk()` now enqueues each node's `type` hash so the schema chain is part of normal BFS traversal. This makes refs embedded inside a schema node's payload (via a custom meta-schema that declares an `ocas_ref` field) reachable via `walk`, `gc`, and `computeClosure` instead of being silently invisible. The visited-set dedup naturally terminates on the self-referencing bootstrap meta-schema. Fixes #130.
- Add `followType` option to `walk()` to control schema chain traversal.
  
  Core API: `WalkOptions.followType` (default `true` for backward compatibility) controls whether `node.type` edges are enqueued during BFS traversal. GC and closure callers are unaffected.
  
  CLI: `ocas walk` now defaults to `followType: false` (cleaner output for users). Pass `--follow-type` to include the full schema chain.
- Tighten `resolveHash`/`tryResolveHash` to classify inputs as `hash → @scope/name → malformed` and short-circuit malformed inputs without querying `store.var`. Unify the unresolved-input error wording across all CLI commands that take a `<hash-or-name>` argument (`get`, `verify`, `refs`, `walk`, `put`, `hash`, `render`, `tag`, `untag`, etc.) to `Error: Unknown hash or variable: <input>` (replacing the misleading `Name not found:` text). `ocas has` now correctly returns `{value: false}` for malformed inputs too — its no-die contract is preserved. `cmdPut`'s `Schema not found: <hash>` message is unchanged (it fires after a valid hash resolves but has no schema node). Exposes a new `isValidName(name)` predicate from `@ocas/core` alongside the existing `validateName(name)`.
  
  Fixes #136.
- fix(render): expose top-level object payload properties as Liquid context variables so templates like `{{name}}` resolve to `payload.name` without an explicit `payload.` prefix. Reserved engine keys (`hash`, `type`, `resolution`, `epsilon`, `payload`, `timestamp`) take precedence and are never shadowed by payload properties of the same name. Non-object payloads (primitives, arrays, null) continue to be accessed via `{{ payload }}`. Fixes #137.
- walk() and refs() now accept an optional onDangling callback so callers can detect dangling CAS refs without traversal aborting. Default behavior is unchanged: dangling refs are silently skipped. Fixes #112.
- Fix documentation: correct format name from cas_ref to ocas_ref, remove incorrect async signatures, add clarifying comments

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
