# CLAUDE.md — ocas

Self-describing content-addressable storage with JSON Schema typed nodes.

## Project Structure

Monorepo with 4 packages under `packages/`:

| Package | Description |
|---------|-------------|
| `ocas` | Core CAS engine — hashing, schema, store, verify, bootstrap |
| `ocas-fs` | Filesystem-backed CAS store |
| `cli` | CLI tool |

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict mode, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
- **Build:** `tsc --build` (composite project references)
- **Test:** `bun test`
- **Lint/Format:** Biome (`biome check .` / `biome format --write .`)
- **Publish:** Changesets → npmjs (`@ocas/*`)

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

- `noConsole: "error"` globally (except `cli`)
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
- `Store` — abstract storage interface (get/put)

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
