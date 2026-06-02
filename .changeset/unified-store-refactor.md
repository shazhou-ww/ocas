---
"@ocas/core": minor
"@ocas/fs": minor
"@ocas/cli": minor
---

Unified Store type refactor (#38)

**Breaking changes:**

- `Store` is now `{ cas: CasStore, var: VarStore, tag: TagStore }` — all sub-stores accessed via properties
- `bootstrap(store)` and `putSchema(store, schema)` are now **synchronous** (were async)
- `VariableStore` class removed from `@ocas/core` — SQLite implementation moved to `@ocas/fs`
- `createVariableStore()` removed from `@ocas/core`
- `openStoreAndVarStore()` removed from CLI internals — use `openStore()` returning unified `Store`
- `RenderOptions.varStore` removed — templates resolved via `store.var` internally
- `@ocas/core` has zero `bun:sqlite` imports — pure TypeScript

**New:**

- `CasStore`, `VarStore`, `TagStore` sub-store types
- `TagStore` — first-class tags on any CAS node (not just variables)
- `var-store-helpers.ts` — shared validation/history logic
- `validation.ts` — shared `validateName()` exported from core
