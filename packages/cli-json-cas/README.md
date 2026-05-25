# @uncaged/cli-json-cas

CLI tool for json-cas stores.

## Overview

`@uncaged/cli-json-cas` provides the `json-cas` command for managing a filesystem-backed store: bootstrap, schema registration, node CRUD, integrity checks, reference listing, and graph walks. It uses `@uncaged/json-cas-fs` for persistence and `@uncaged/json-cas` for core operations.

**Dependencies:** `@uncaged/json-cas`, `@uncaged/json-cas-fs`

## Installation

Published as an npm package with a binary entry:

```bash
bun add -g @uncaged/cli-json-cas
# or from the monorepo workspace:
bun link
```

**Binary name:** `json-cas` (points to `src/index.ts`, run with Bun).

In development:

```bash
bun packages/cli-json-cas/src/index.ts <command> [args]
```

## CLI Usage

```
Usage: json-cas [--store <path>] [--json] <command> [args]
```

### Global flags

| Flag | Description |
|------|-------------|
| `--store <path>` | Store directory (default: `~/.uncaged/json-cas`) |
| `--json` | Compact JSON output for commands that print JSON |

### Commands

| Command | Description |
|---------|-------------|
| `init` | Create store directory and write bootstrap seed; prints meta hash |
| `bootstrap` | Write meta-schema seed into existing store; prints hash |
| `schema put <file.json>` | Register schema from file; prints type hash |
| `schema get <type-hash>` | Print schema JSON |
| `schema list` | List all schemas (`hash  name`) |
| `schema validate <hash>` | Validate node against its schema; prints `valid` / `invalid` |
| `put <type-hash> <file.json>` | Store node; prints content hash |
| `get <hash>` | Print full node as JSON |
| `has <hash>` | Print `true` or `false` |
| `verify <hash>` | Verify integrity; prints `ok` or `corrupted` |
| `refs <hash>` | Print direct `cas_ref` targets (one per line) |
| `walk <hash>` | BFS traversal; one hash per line |
| `walk <hash> --format tree` | Tree-formatted traversal |
| `hash <type-hash> <file.json>` | Compute hash without storing |
| `cat <hash>` | Print node JSON |
| `cat <hash> --payload` | Print payload only |

### Examples

```bash
# Initialize default store at ~/.uncaged/json-cas
json-cas init

# Use a custom store path
json-cas --store ./data/cas bootstrap

# Register a schema and store a payload
json-cas schema put ./schemas/item.json
# → prints type hash, e.g. 0123456789ABCD

json-cas put 0123456789ABCD ./payloads/item.json
# → prints content hash

json-cas get <content-hash> --json
json-cas verify <content-hash>
json-cas walk <content-hash> --format tree
```

## Internal Structure

| File | Purpose |
|------|---------|
| `index.ts` | Argument parsing, command dispatch, and all CLI logic |

There is no separate `src/` module tree; the CLI is a single entry file. Tests (if present) are co-located under the package.

## Configuration

| Setting | Default | Override |
|---------|---------|----------|
| Store directory | `~/.uncaged/json-cas` | `--store <path>` |

No config file is read; all behavior is controlled via flags and command arguments.
