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

The variable database lives at `<home>/variables.db` by default, overridable with `--var-db <path>`.

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
ocas list-schema                # list all schema hashes
ocas list-meta                  # list meta-schema hashes
ocas gc                         # garbage collection
```

### [[Variable]] Management

```bash
ocas var set <name> <hash> [--tag key:value] [--tag label]
ocas var get <name> --schema <hash>
ocas var delete <name> [--schema <hash>]
ocas var list [prefix] [--schema <hash>] [--tag ...]
ocas var tag <name> --schema <hash> <operations...>
ocas var history <name> [--schema <hash>]
```

### [[Render System|Template & Render]]

```bash
ocas template set <schema-hash> <file|--inline text>
ocas template get <schema-hash>
ocas template list
ocas template delete <schema-hash>
ocas render <hash> [--resolution n] [--decay n] [--epsilon n]
ocas render --pipe/-p [options]
```

## Flags

| Flag | Description |
|------|-------------|
| `--home <path>` | Store directory |
| `--var-db <path>` | Variable database path |
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

## Variable Names

The CLI resolves `@ocas/*` variable names to hashes automatically. All commands that accept a hash argument also accept a variable name — `resolveHash()` queries the [[Variable]] store and returns the bound hash:

```bash
ocas put @ocas/object data.json    # resolves @ocas/object → hash
ocas put @ocas/schema schema.json  # auto-routes to putSchema()
ocas list --type @ocas/schema      # list all schemas
```

User-defined variable names work the same way — once `ocas var set myapp/config <hash>` is registered, `ocas get myapp/config` resolves to that hash.
