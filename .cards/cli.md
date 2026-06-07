---
title: CLI
aliases: [ocas command, 命令行]
tags: [api]
related: [Store, Render System, Variable, Schema]
---

# CLI

The `ocas` CLI is the primary interface for interacting with an OCAS [[Store]]. All commands output JSON in the [[Render System|envelope]] format (`{ type, value }`), making them composable via pipes.

## Configuration

| Priority | Source | Example |
|----------|--------|---------|
| 1 | `--home <path>` flag | `ocas --home /tmp/mystore put ...` |
| 2 | `OCAS_HOME` env var | `export OCAS_HOME=/data/ocas` |
| 3 | Default | `~/.ocas` |

The SQLite database lives at `<home>/_store.db`.

## Commands

### CAS Operations

```bash
ocas put <type> <file|--pipe>   # store a node, returns its hash
ocas get <hash>                 # retrieve a node
ocas has <hash>                 # check existence
ocas hash <type> <file|--pipe>  # compute hash without storing
ocas verify <hash>              # check integrity + schema validity
ocas refs <hash>                # list direct ocas_ref edges
ocas walk <hash>                # recursive DAG traversal
ocas list --type <hash|name>    # list nodes by type
ocas list --tag <expr>          # filter by tag
ocas list-schema                # list all schema hashes
ocas list-meta                  # list meta-schema hashes
ocas gc                         # garbage collection
```

### [[Variable]] Management

```bash
ocas var set <name> <hash>
ocas var get <name> --schema <hash>
ocas var delete <name> [--schema <hash>]
ocas var list [prefix] [--schema <hash>]
ocas var history <name> [--schema <hash>]
```

### Tagging

```bash
ocas tag <target> <tag>...      # attach tags (key:value) or labels (bare)
ocas untag <target> <tag>...    # remove tags by key or label
```

Tags apply to any target (variable or node). `ocas get` and `ocas var get` include tag info in output.

### [[Render System|Template & Render]]

```bash
ocas template set <schema-hash> <file|--inline text>
ocas template get <schema-hash>
ocas template list
ocas template delete <schema-hash>
ocas render <hash> [--resolution n] [--decay n] [--epsilon n]
ocas render --pipe/-p [options]
```

### Bundle Export / Import

```bash
ocas export <root>... -o <bundle.tar>     # write CAS closure of roots to tar
ocas import <bundle.tar> [--scope @new]   # merge bundle into current store
```

`ocas export` walks `cas_ref` edges **and** schema chains from each root, then
writes a self-contained POSIX-tar archive containing every reachable CAS node
(`cas/<hash>.bin`, CBOR-encoded), every variable whose `value` is in-closure
(`vars.jsonl`), and every tag attached to an in-closure target (`tags.jsonl`).

`ocas import` is content-addressed and idempotent — re-importing the same
bundle is a no-op. `--scope @new` rewrites the leading `@scope/` of every
imported variable name except `@ocas/*` builtins.

`--store <bundle.tar>` is a global flag that swaps the store backend for
read-only commands. Internally this calls `loadBundleStore()` (from
`@ocas/core`) which returns an in-memory `Store` populated from the bundle,
without touching `~/.ocas`. Write commands (`put`, `tag`, `gc`, `import`,
`var set`, `template set`, …) refuse with an explicit error when `--store`
is set.

## Flags

| Flag | Description |
|------|-------------|
| `--home <path>` | Store directory |
| `--var-db <path>` | Variable database path |
| `--store <bundle.tar>` | Open a bundle as a read-only store (write commands rejected) |
| `--json` | Compact JSON output (no pretty-printing) |
| `--pipe`, `-p` | Read from stdin (`put`/`hash`: raw JSON; `render`: envelope) |
| `--schema <hash>` | Schema filter for var commands |
| `--tag <expr>` | Tag/label operations (repeatable) |
| `--render`, `-r` | Render output inline (equivalent to piping to `ocas render -p`) |
| `--inline <text>` | Inline text content for `template set` |
| `--format tree` | Tree display for `walk` |
| `--sort created\|updated` | Sort key for list commands (default: `created`; for CAS nodes both are equivalent) |
| `--limit <n>` | Max results to return (default: 100) |
| `--offset <n>` | Skip first N results (default: 0) |
| `--desc` | Sort descending (default: ascending) |
| `-o <path>` | Output file path (used by `export`) |
| `--scope @new` | Variable scope remap on import (used by `import`) |

## Variable Names

The CLI resolves `@ocas/*` variable names to hashes automatically. All commands that accept a hash argument also accept a variable name — `resolveHash()` queries the [[Variable]] store and returns the bound hash:

```bash
ocas put @ocas/object data.json    # resolves @ocas/object → hash
ocas put @ocas/schema schema.json  # auto-routes to putSchema()
ocas list --type @ocas/schema      # list all schemas
```

All variable names must follow `@scope/name` format. User-defined names work just like builtins — once `ocas var set @myapp/config <hash>` is registered, `ocas get @myapp/config` resolves to that hash.
