---
"@ocas/core": minor
"@ocas/cli": minor
---

Add CAS closure export/import (`ocas export` / `ocas import`):

- **`@ocas/core`**: New `computeClosure(store, roots)` traverses references and schema chains to gather a complete CAS closure. New `exportBundle()` / `importBundle()` / `loadBundleStore()` produce and consume self-contained POSIX-tar bundles (`cas/*.bin` CBOR payloads, `vars.jsonl`, `tags.jsonl`). Added `@ocas/output/export` and `@ocas/output/import` builtin output schemas.
- **`@ocas/cli`**: New `ocas export <root> [<root> ...] -o <bundle.tar>` and `ocas import <bundle.tar> [--scope @new]` commands. New global `--store <bundle.tar>` flag opens a bundle as a read-only store for inspection commands (`get`, `walk`, `refs`, `var list`, …). Write commands reject `--store` with a clear error.
