# @ocas/cli

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
