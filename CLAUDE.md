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
- `Store` — abstract storage interface (get/put)

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

Releases use a **release branch** workflow. `main` always keeps `workspace:*` for
internal dependencies; version numbers are only fixed on the release branch.

### Prepare

```bash
./scripts/prepare-release.sh
```

This script:
1. Checks you're on `main` with a clean tree and pending changesets
2. Creates `release/<version>` branch
3. Runs `changeset version` to fix versions and generate CHANGELOGs
4. Runs full validation (install, build, lint, test)
5. Commits the version bump

After preparation, review changes and fix any issues on the release branch.

### Publish

```bash
./scripts/publish.sh
```

This script:
1. Validates you're on a `release/*` branch with no pending changesets
2. Runs final build + test
3. Publishes packages in order: `@ocas/core` → `@ocas/fs` → `@ocas/cli`
4. Tags, pushes, merges back to `main`, cleans up the release branch

### Adding a Changeset

Before releasing, add changesets for your changes:

```bash
bunx changeset        # interactive — pick packages + bump type + summary
```

Changesets live in `.changeset/` as markdown files until consumed by `prepare-release.sh`.
