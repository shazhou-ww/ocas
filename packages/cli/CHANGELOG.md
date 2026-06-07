# @ocas/cli

## 0.4.0 — 2026-06-07

- Rename `ocas prompt setup` to `ocas prompt bootstrap` with programmatic generation (dynamic CLI_VERSION injection). Add `ocas prompt list` subcommand.
- Add CAS closure export/import (`ocas export` / `ocas import`):
  
  - **`@ocas/core`**: New `computeClosure(store, roots)` traverses references and schema chains to gather a complete CAS closure. New `exportBundle()` / `importBundle()` / `loadBundleStore()` produce and consume self-contained POSIX-tar bundles (`cas/*.bin` CBOR payloads, `vars.jsonl`, `tags.jsonl`). Added `@ocas/output/export` and `@ocas/output/import` builtin output schemas.
  - **`@ocas/cli`**: New `ocas export <root> [<root> ...] -o <bundle.tar>` and `ocas import <bundle.tar> [--scope @new]` commands. New global `--store <bundle.tar>` flag opens a bundle as a read-only store for inspection commands (`get`, `walk`, `refs`, `var list`, …). Write commands reject `--store` with a clear error.

## 0.3.1

### Patch Changes

- Fix prompt docs: `bun` → `pnpm` install instructions, remove stale `--var-db` flag from usage docs.

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

- Fix render output missing trailing newline.
- Fix TypeScript LSP errors: tsconfig `noEmit`, `exactOptionalPropertyTypes` conditional spread, `schemaHash` scope.
- Add agent skill setup hint with version to help output. Remove postinstall script (blocked by bun security policy). Update `ocas prompt setup` to guide cleanup of old skill versions before installing new ones.

- Updated dependencies:
  - @ocas/core@0.1.2
  - @ocas/fs@0.1.2

## 0.1.1

### Patch Changes

- Add `ocas prompt usage` and `ocas prompt setup` commands for agent skill management. Prompt content is bundled with the CLI and versioned with it.
- Add `--version` flag to display CLI version.

- Updated dependencies:
  - @ocas/core@0.1.1
  - @ocas/fs@0.1.1

## 0.1.0

Initial release as `@ocas/cli`. CLI tool for OCAS with put, get, list, render, verify, gc, var, and template commands. Envelope output format with pipe composition support.
