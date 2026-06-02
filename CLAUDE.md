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

- **Runtime:** Bun
- **Language:** TypeScript (strict mode, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
- **Build:** `tsc --build` (composite project references)
- **Test:** `bun test`
- **Lint/Format:** Biome (`biome check .` / `biome format --write .`)
- **Publish:** Changesets + `bun publish` → npmjs (`@ocas/*`)

## Commands

```bash
bun test          # Run all tests
bun run build     # Build all packages
bun run check     # Biome lint
bun run format    # Biome format (auto-fix)
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
- **`openStore()`** returns a unified `Store` with `cas`, `var`, and `tag` sub-stores, and bootstraps automatically. `@ocas/core` has zero `bun:sqlite` dependency.

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

1. `bun test` — all tests pass
2. `bun run check` — no lint errors
3. `bun run build` — builds cleanly

## Release Process

Releases use a **release branch** workflow with three phases: prepare → candidate → finalize.

`main` always keeps `workspace:*` for internal deps; release branches fix them to real versions.
Changeset files are **only consumed once** during finalize — prerelease (rc) never touches them.

### Adding a Changeset

Add changesets alongside feature PRs on `main`:

```markdown
<!-- .changeset/my-change.md -->
---
"@ocas/cli": patch
---

Description of the change
```

Changesets live in `.changeset/` as markdown files. Bump types: `patch` / `minor` / `major`.
One changeset can cover multiple packages.

### Phase 1: Prepare (cut release branch)

- **Precondition:** on `main`, clean tree, `.changeset/` has pending changesets
- **Steps:**
  1. Determine target version (from changeset bump types or manually)
  2. `git checkout -b release/<version>`
  3. Fix `workspace:*` → real version numbers in all `package.json`
  4. Commit
- **Does NOT** run `changeset version`, does NOT write CHANGELOG

### Phase 2: Candidate (publish rc for validation)

- **Precondition:** on `release/*` branch
- **Steps:**
  1. Set version to `<version>-rc.N` (first time rc.1, increment on subsequent runs)
  2. `bun install && bun run build && bun test && bun run check`
  3. Publish: `bun publish --tag rc` (order: core → fs → cli)
  4. Commit + push
- **Repeatable:** fix bugs → add new changesets on the release branch → rc.N+1
- **Does NOT** consume changesets, does NOT write CHANGELOG
- Install for testing: `bun add -g @ocas/cli@rc`

### Phase 3: Finalize (official release)

- **Precondition:** on `release/*` branch, rc validated
- **Steps:**
  1. Consume all `.changeset/*.md` → write CHANGELOG entries (use `changeset version` or manual)
  2. Set final version `<version>` (remove `-rc.N`)
  3. `bun install && bun run build && bun test && bun run check`
  4. Publish: `bun publish --tag latest` (order: core → fs → cli)
  5. Git tag `v<version>`
  6. Merge back to `main` (CHANGELOG comes along)
  7. Restore `workspace:*` on `main`
  8. Delete release branch

### Key Rules

- **Publish order** is always `@ocas/core` → `@ocas/fs` → `@ocas/cli`
- **`workspace:*`** must be fixed before any publish — `bun publish` does NOT auto-replace them
- **CHANGELOG** only contains official releases, never rc entries
- **Changesets added on release branch** (bug fixes during rc) are consumed together at finalize
