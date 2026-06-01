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
ocas list --type <hash|alias>   # list nodes by type
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
| `--format tree` | Tree display for `walk` |

## Type Aliases

The CLI resolves `@ocas/*` aliases to hashes automatically:

```bash
ocas put @ocas/object data.json    # resolves @ocas/object → hash
ocas put @ocas/schema schema.json  # auto-routes to putSchema()
ocas list --type @ocas/schema      # list all schemas
```
