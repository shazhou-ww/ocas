# @ocas/cli

CLI tool for ocas stores.

## Overview

`@ocas/cli` provides the `ocas` command for managing a filesystem-backed store: node CRUD, integrity checks, reference listing, graph walks, variables, and output templates. It uses `@ocas/fs` for persistence and `@ocas/core` for core operations.

The store is **auto-created and bootstrapped** on first use, so there is no `init`/`bootstrap` command. Schemas are ordinary `@ocas/schema`-typed nodes — register one with `ocas put @ocas/schema file.json` and list them with `ocas list --type @ocas/schema`; there is no dedicated `schema` subcommand.

**Dependencies:** `@ocas/core`, `@ocas/fs`

## Installation

Published as an npm package with a binary entry:

```bash
pnpm add -g @ocas/cli
# or from the monorepo workspace:
pnpm link
```

**Binary name:** `ocas` (points to `dist/index.js`, run with Node).

In development:

```bash
node packages/cli/dist/index.js <command> [args]
```

## CLI Usage

```
Usage: ocas [--home <path>] [--json] <command> [args]
```

### Global flags

| Flag | Description |
|------|-------------|
| `--home <path>` | Store directory (default: `$OCAS_HOME` or `~/.ocas`) |
| `--var-db <path>` | Variable database path (default: `<home>/variables.db`) |
| `--store <bundle.tar>` | Open a bundle file as a read-only store (write commands rejected) |
| `--json` | Compact (single-line) JSON output |

### Envelope format

Every JSON-emitting command prints a uniform `{ type, value }` envelope. `type` is the hash
of the command's `@output/*` result schema and `value` is the command payload. The output
is therefore self-describing and pipeable: feed any envelope into `render -p` to render its
`value` (embedded `cas_ref` hashes are expanded). `render` is the only command that emits
raw, non-envelope text.

```jsonc
// ocas has <hash>
{ "type": "AYHQD2YA9G667", "value": true }

// ocas template set <schema-hash> --inline "Hi {{ payload.name }}"
{ "type": "9YJZ09DDAYAWR", "value": { "schemaHash": "7XX5H51CVD9H0", "contentHash": "FC8WACA792B6F" } }
```

### Commands

| Command | Envelope `value` | Result schema |
|---------|------------------|---------------|
| `put <type-hash> <file.json>` | stored node hash (string) | `@output/put` |
| `get <hash>` | `{ type, payload, timestamp }` | `@output/get` |
| `has <hash>` | boolean | `@output/has` |
| `verify <hash>` | `ok` / `corrupted` / `invalid` | `@output/verify` |
| `refs <hash>` | hashes (string[]) | `@output/refs` |
| `walk <hash> [--format tree]` | hashes (string[]) or tree string | `@output/walk` |
| `hash <type-hash> <file.json>` | computed hash (string) | `@output/hash` |
| `render <hash> [options]` | raw text (no envelope) | — |
| `render --pipe/-p [options]` | raw text from piped envelope | — |
| `list --type <hash-or-name>` | hashes (string[]) | `@output/list` |
| `var set <name> <hash> [--tag ...]` | variable object | `@output/var-set` |
| `var get <name> --schema <hash>` | variable object | `@output/var-get` |
| `var delete <name> [--schema <hash>]` | variable or variable[] | `@output/var-delete` |
| `var tag <name> --schema <hash> <ops...>` | variable object | `@output/var-tag` |
| `var list [prefix] [--schema <hash>] [--tag ...]` | variable[] | `@output/var-list` |
| `template set <schema-hash> <file> \| --inline <text>` | `{ schemaHash, contentHash }` | `@output/template-set` |
| `template get <schema-hash>` | template content (string) | `@output/template-get` |
| `template list` | `{ schemaHash, contentHash }[]` | `@output/template-list` |
| `template delete <schema-hash>` | `{ deleted: boolean }` | `@output/template-delete` |
| `gc` | `{ total, reachable, collected, scanned }` | `@output/gc` |
| `export <root...> -o <bundle.tar>` | `{ nodes, vars, tags }` | `@output/export` |
| `import <bundle.tar> [--scope @new]` | nested `{ nodes, vars, tags }` stats | `@output/import` |

### Examples

```bash
# Register a schema (schemas are plain @ocas/schema nodes) and store a payload
ocas put @ocas/schema ./schemas/item.json
# → { "type": "...", "value": "0123456789ABC" }  (the schema's type hash)

ocas put 0123456789ABC ./payloads/item.json
# → { "type": "...", "value": "<content-hash>" }

ocas get <content-hash> --json
ocas verify <content-hash>
ocas walk <content-hash> --format tree

# List every registered schema, then extract the hashes with jq
ocas list --type @ocas/schema | jq -r '.value[]'
```

### Pipe composition

Because every command shares the `{ type, value }` envelope, output composes directly into
`render -p`:

```bash
# put emits a cas_ref hash envelope; render -p dereferences and renders the node
ocas put @ocas/schema ./schemas/item.json | ocas render -p

# render gc statistics
ocas gc | ocas render -p

# render every schema referenced by a list result
ocas list --type @ocas/schema | ocas render -p
```

### Variable names as hash arguments

Every command that takes a hash also accepts a variable name. Builtin schema names like `@ocas/schema`, `@ocas/string`, `@ocas/output/*` are registered in the variable store during bootstrap; user variables created via `ocas var set <name> <hash>` resolve the same way:

```bash
ocas put @ocas/object data.json     # @ocas/object → builtin schema hash
ocas list --type @ocas/schema       # filter by builtin schema
ocas var set myapp/config <hash>
ocas get myapp/config                # resolves to the user-bound hash
```

There is no separate alias system — names are just variables.

### Templates

`template` commands manage the LiquidJS template bound to a schema (stored as a
`@ocas/template/text/<schema-hash>` variable). `render <hash>` uses the template registered
for the node's type, falling back to YAML when none exists.

```bash
# Bind a template to a schema, then render a node of that type
ocas template set 0123456789ABC --inline "Item: {{ payload.name }}"
ocas render <content-hash>
# → Item: Widget
```

### Bundles (export / import)

`ocas export` walks the transitive CAS closure (refs **and** schema chains) of one or more
roots and writes a self-contained POSIX-tar archive containing every reachable CAS node
(`cas/<hash>.bin`, CBOR-encoded), every variable whose value is in-closure
(`vars.jsonl`), and every tag attached to an in-closure target (`tags.jsonl`).

```bash
ocas export @myapp/config -o myapp.tar             # single root by name
ocas export @myapp/config @myapp/users -o m.tar    # multiple roots
ocas export 1ABC2DEF34567 -o snapshot.tar          # raw hash root

# Import into the current store (idempotent — content-addressed dedup)
ocas import myapp.tar
ocas import myapp.tar --scope @prod                # remap @myapp/* → @prod/*

# Inspect a bundle without unpacking it
ocas get @myapp/config --store myapp.tar
ocas walk @myapp/config --store myapp.tar
ocas var list --store myapp.tar
```

`-o <path>` (required for `export`) names the output tar. `--scope @new` rewrites the
leading `@scope` of every imported variable name except builtins (`@ocas/*`).
`--store <bundle.tar>` swaps the store backend for any read-only command (`get`, `has`,
`refs`, `walk`, `list`, `var list`, `var get`, `verify`, `render`, …); write commands
(`put`, `tag`, `gc`, `import`, `var set`, `template set`, …) refuse with
`--store is read-only` when the flag is set.

## Internal Structure

| File | Purpose |
|------|---------|
| `index.ts` | Argument parsing, command dispatch, and all CLI logic |

There is no separate `src/` module tree; the CLI is a single entry file. Tests (if present) are co-located under the package.

## Configuration

| Setting | Default | Override |
|---------|---------|----------|
| Store directory | `~/.ocas` | `--home <path>` or `OCAS_HOME` env var |

No config file is read; all behavior is controlled via flags and command arguments.
