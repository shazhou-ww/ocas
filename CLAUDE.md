# CLAUDE.md — OCAS

Object Content Addressable Store — self-describing CAS with JSON Schema typed nodes.

## Project Structure

Monorepo with 3 packages under `packages/`:

| Package | Directory | Description |
|---------|-----------|-------------|
| `@ocas/core` | `packages/core` | Core CAS engine — hashing, schema, store, verify, bootstrap |
| `@ocas/fs` | `packages/fs` | Filesystem-backed CAS store |
| `@ocas/cli` | `packages/cli` | CLI tool (`ocas` binary) |

## Tech Stack

- **Runtime:** Node.js
- **Language:** TypeScript (strict mode, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
- **Build:** `tsc` (composite project references, sequential: core → fs → cli)
- **Test:** Vitest (`npx vitest run`)
- **Package Manager:** pnpm (workspace)
- **Lint/Format:** Biome (`biome check .` / `biome format --write .`)
- **Publish:** @shazhou/proman (`proman bump` + `proman publish`)

## Commands

```bash
pnpm run test     # Run all tests (vitest)
pnpm run build    # Build all packages (tsc via proman)
pnpm run check    # Biome lint
pnpm run format   # Biome format (auto-fix)
```

## Code Conventions

### TypeScript

- **Strict mode** — no `any`, no unchecked index access, no implicit overrides
- **`verbatimModuleSyntax`** — use `import type` for type-only imports
- **Import paths** — use `.js` extension in imports (ESM convention with bundler resolution)
- **Export style** — named exports only, re-export from `index.ts`

### Biome Rules

- `noConsole: "error"` globally (except `packages/cli`)
- Recommended ruleset enabled
- Auto-organize imports via `assist.actions.source.organizeImports`
- Indent: 2 spaces

### Naming

- Types: `PascalCase` (`CasNode`, `Hash`, `Store`)
- Functions: `camelCase` (`computeHash`, `createMemoryStore`)
- Constants: `UPPER_SNAKE_CASE` (`BOOTSTRAP_STORE`)
- Files: `kebab-case.ts`
- Test files: co-located as `*.test.ts`

### Key Types

- `Hash` — 13-character uppercase Crockford Base32 string (XXH64)
- `CasNode` — content-addressed node with schema
- `Store` — unified storage interface `{ cas: CasStore, var: VarStore, tag: TagStore }`
- `ListOptions` — sorting/pagination options (`sort`, `desc`, `limit`, `offset`)
- `ListEntry` — list result entry (`hash`, `created`, `updated`)

### List Utilities

`packages/core/src/list-utils.ts` provides `applyListOptions()` — in-memory sort/paginate for `ListEntry[]` arrays. Used by `MemoryStore`; `FsStore` pushes sort/limit to SQLite. Core layer treats `limit: undefined` as "no limit"; the CLI defaults to 100 in `parseListOptions()`.

### Architecture Notes

- **No "alias" concept** — every name resolution flows through `store.var`. Builtin schemas (`@ocas/schema`, `@ocas/string`, `@ocas/output/*`, …) are registered as variables during `bootstrap(store)`, alongside user-defined variables created via `ocas var set`.
- **`bootstrap(store)`** synchronously writes builtin name → hash bindings into the unified store; called automatically by `openStore()`.
- **`resolveHash(input, store)`** is the unified hash/name resolver in the CLI. If `input` matches the 13-char hash format it is returned as-is; otherwise `store.var` is queried by exact name. This means every CLI command that accepts a hash argument also accepts a variable name (schema names, user vars, etc.).
- **Variable naming**: all names must follow `@scope/name` format (`@[a-zA-Z][a-zA-Z0-9]*/segments`). `@ocas/*` is reserved for builtins. The `@` prefix ensures names are visually distinct from hashes.
- **`openStore()`** returns a unified `Store` with `cas`, `var`, and `tag` sub-stores, and bootstraps automatically. `@ocas/core` has zero SQLite dependency.

### Internal Dependencies

Workspace packages reference each other with `workspace:*` in `package.json`.
This is resolved to real version numbers only during publishing (see below).

## Git

- Commit format: `type: description` (conventional commits)
- Reference issues: `Fixes #N` / `Closes #N`
- Author: `小橘 <xiaoju@shazhou.work>`

## Project Rules

- [docs/sync-readme.md](docs/sync-readme.md) — README sync conventions

## Before Submitting

1. `pnpm run test` — all tests pass
2. `pnpm run check` — no lint errors
3. `pnpm run build` — builds cleanly

## Release Process

Uses `@shazhou/proman` for releases. No release branches needed.

### Adding a Changeset

Add changesets alongside feature PRs on `main`:

```markdown
<!-- .changeset/my-change.md -->
---
"@ocas/fs": minor
---

Description of the change
```

Changesets live in `.changeset/` as markdown files. Bump types: `patch` / `minor` / `major`.
One changeset can cover multiple packages.

### Release Steps

1. `proman bump` — consume changesets and bump versions
2. `proman publish` — build → test → check → publish → changelog → tag → push

The publish command handles everything: workspace dependency resolution, npm publish order (core → fs → cli), changelog generation, git tagging, and pushing.

### Key Rules

- **Publish order** is always `@ocas/core` → `@ocas/fs` → `@ocas/cli`
- **`workspace:*`** is auto-resolved by pnpm during publish
- **CHANGELOG** only contains official releases
