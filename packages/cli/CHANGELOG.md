# @ocas/cli

## 0.5.0 — 2026-06-10

- Fix `ocas has` to return `{ value: false }` for unresolvable inputs instead of dying. Variable names that don't exist in the store no longer crash the predicate; they are simply reported as not present. Also rename the shared resolver error from `Schema not found:` to `Name not found:` since the lookup is by variable name, not schema (affects `get`, `verify`, `refs`, `walk`, etc. when given an unknown name).
- Add `followType` option to `walk()` to control schema chain traversal.
  
  Core API: `WalkOptions.followType` (default `true` for backward compatibility) controls whether `node.type` edges are enqueued during BFS traversal. GC and closure callers are unaffected.
  
  CLI: `ocas walk` now defaults to `followType: false` (cleaner output for users). Pass `--follow-type` to include the full schema chain.
- Tighten `resolveHash`/`tryResolveHash` to classify inputs as `hash → @scope/name → malformed` and short-circuit malformed inputs without querying `store.var`. Unify the unresolved-input error wording across all CLI commands that take a `<hash-or-name>` argument (`get`, `verify`, `refs`, `walk`, `put`, `hash`, `render`, `tag`, `untag`, etc.) to `Error: Unknown hash or variable: <input>` (replacing the misleading `Name not found:` text). `ocas has` now correctly returns `{value: false}` for malformed inputs too — its no-die contract is preserved. `cmdPut`'s `Schema not found: <hash>` message is unchanged (it fires after a valid hash resolves but has no schema node). Exposes a new `isValidName(name)` predicate from `@ocas/core` alongside the existing `validateName(name)`.
  
  Fixes #136.
- Add workflow testing documentation to triage-issues.yaml. The workflow now includes a comment explaining how to test it with `uwf thread start triage-issues -p "Test run"` before production use or after making changes.

## 0.4.0 — 2026-06-07

- New `ocas export <root> [<root>...] -o <bundle.tar>` — export CAS closures as self-contained tar bundles.
- New `ocas import <bundle.tar> [--scope @new]` — import bundles into a store.
- New global `--store <bundle.tar>` flag — open a bundle as read-only store for inspection commands.
- Rename `ocas prompt setup` to `ocas prompt bootstrap` with programmatic generation.
- New `ocas prompt list` subcommand.

## 0.3.1 — 2026-06-04

- Fix prompt docs: `bun` → `pnpm` install instructions, remove stale `--var-db` flag.

## 0.3.0 — 2026-06-03

- No CLI-specific changes. Coordinated version bump with `@ocas/fs` 0.3.0.

## 0.2.2 — 2026-06-03

- Lint and format fixes.

## 0.2.1 — 2026-06-03

- Full CLI build support with `tsc` emit + Node compatibility.
- Migrate runtime from Bun to Node.js + pnpm.

## 0.2.0 — 2026-06-02

### Breaking Changes

- `ocas var tag` subcommand removed — use `ocas tag` / `ocas untag` instead.

### New Features

- Top-level `ocas tag <target> <tag>...` and `ocas untag <target> <tag>...` commands.
- `ocas get` and `ocas var get` now include tag info in output.
- `ocas list --tag` and `ocas var list --tag` filter support.

## 0.1.2 — 2026-06-02

- Fix render output missing trailing newline.
- Add agent skill setup hint with version to help output.
- Remove postinstall script.

## 0.1.1 — 2026-06-02

- Add `ocas prompt usage` and `ocas prompt setup` commands.
- Add `--version` flag.

## 0.1.0 — 2026-06-01

Initial release. CLI tool for OCAS with put, get, list, render, verify, gc, var, and template commands.
