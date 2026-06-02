# OCAS — Object Content Addressable Store

## Overview

OCAS is a self-describing content-addressable store for typed JSON data. Every node has a `type` field (hash of a JSON Schema) and a `payload`. Hashes are 13-character Crockford Base32 strings (XXH64 over deterministic CBOR).

All commands output `{ type, value }` JSON envelopes, making them composable via pipes.

**Install:** `bun add -g @ocas/cli`

**Packages:** `@ocas/core` (engine) · `@ocas/fs` (filesystem store) · `@ocas/cli` (CLI)

## When to Use

- Storing structured, schema-validated JSON data with content addressing
- Building knowledge graphs or DAGs with typed nodes and `cas_ref` edges
- Agent memory, config versioning, or any use case needing immutable data + mutable pointers
- Don't use for: binary blobs, large files, or high-throughput streaming

## Quick Start

```bash
# Register a schema (from stdin)
echo '{
  "type": "object",
  "properties": { "title": { "type": "string" }, "done": { "type": "boolean" } },
  "required": ["title", "done"],
  "additionalProperties": false
}' | ocas put @ocas/schema -p
# → { "type": "...", "value": "<schema-hash>" }

# Name it
ocas var set @todo/schema <schema-hash>

# Store data
echo '{ "title": "Buy milk", "done": false }' | ocas put @todo/schema -p

# Retrieve + verify
ocas get <hash>
ocas verify <hash>
```

## Core Concepts

### Hashes
13-char uppercase Crockford Base32 (e.g. `9S7JEYS3FKSDH`). Deterministic: same content → same hash.

### Envelope Format
Every command outputs `{ type, value }`. `type` is the hash of the result schema. Pipe any envelope into `render -p` to render it human-readable.

### Variables
Mutable pointers to immutable data (like git branches → commits). All names must follow `@scope/name` format:
- `@myapp/config` ✅
- `@ocas/schema` ✅ (builtin, read-only)
- `config` ❌ (no scope)

### Templates
LiquidJS templates bound to a schema. `render` uses the template for the node's type, falling back to YAML.

## CLI Reference

### Store & Retrieve

```bash
ocas put <type> <file>          # store node → hash
ocas put <type> -p              # read payload from stdin
ocas get <hash>                 # retrieve node
ocas has <hash>                 # check existence
ocas hash <type> <file>         # compute hash without storing
ocas verify <hash>              # integrity + schema validation
```

### Graph Traversal

```bash
ocas refs <hash>                # direct cas_ref edges
ocas walk <hash>                # recursive DAG traversal
ocas walk <hash> --format tree  # tree view
```

### Listing & Querying

```bash
ocas list --type <hash|name>    # list nodes by type
ocas list-schema                # all schemas
ocas list-meta                  # meta-schema hashes
```

Sorting and pagination:

```bash
ocas list --type @todo/schema --sort updated --desc --limit 20
ocas list --type @todo/schema --offset 20 --limit 20   # page 2
```

### Variables

```bash
ocas var set @myapp/config <hash>              # bind name → hash
ocas var set @myapp/config <hash> --tag env:prod --tag pinned
ocas var get @myapp/config                     # look up
ocas var delete @myapp/config                  # remove
ocas var list [prefix]                         # list (prefix filter)
ocas var list @myapp/ --tag env:prod           # filter by scope + tag
ocas var history @myapp/config                 # last 10 values (LRU)
ocas var tag @myapp/config --schema <h> status:active   # add tag
ocas var tag @myapp/config --schema <h> :status          # remove tag
```

**Naming rules:**
- Format: `@scope/name` — `@[a-zA-Z][a-zA-Z0-9]*/segments`
- `@ocas/*` reserved for builtins
- Any command accepting a hash also accepts a variable name

### Templates & Rendering

```bash
ocas template set <schema-hash> --inline "{{ payload.title }}"
ocas template get <schema-hash>
ocas template list
ocas template delete <schema-hash>
ocas render <hash>                     # render with template (or YAML fallback)
ocas render --pipe/-p                  # render from piped envelope
ocas get <hash> -r                     # inline render shorthand
```

Render options: `--resolution N` (max depth), `--decay N` (depth decay), `--epsilon N` (cutoff).

### Garbage Collection

```bash
ocas gc                    # collect unreachable nodes
ocas gc | ocas render -p   # human-readable stats
```

### Global Flags

| Flag | Description |
|------|-------------|
| `--home <path>` | Store directory (default: `$OCAS_HOME` or `~/.ocas`) |
| `--var-db <path>` | Variable database path |
| `--json` | Compact JSON output |
| `-p`, `--pipe` | Read from stdin |
| `-r`, `--render` | Render output inline |
| `--sort created\|updated` | Sort key (default: `created`) |
| `--limit <n>` | Max results (default: 100) |
| `--offset <n>` | Skip first N (default: 0) |
| `--desc` | Sort descending |

## Pipe Composition Patterns

```bash
# Store + render in one go
echo '{"title":"test","done":false}' | ocas put @todo/schema -p | ocas render -p

# Or use -r shorthand
ocas get <hash> -r

# List schemas, extract hashes with jq
ocas list --type @ocas/schema | jq -r '.value[].hash'

# Render GC stats
ocas gc | ocas render -p
```

## Library Usage

```typescript
import { bootstrap, createMemoryStore, putSchema } from "@ocas/core";

const store = createMemoryStore();
await bootstrap(store);

const typeHash = await putSchema(store, {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
  additionalProperties: false,
});

const hash = await store.put(typeHash, { message: "hello" });
```

For filesystem persistence:

```typescript
import { openStore } from "@ocas/fs";
const store = await openStore("/path/to/store");
// store.cas / store.var / store.tag
```

## Common Pitfalls

1. **Variable names without `@scope/`** — all names must be `@scope/name` format. `config` alone will be rejected.
2. **Writing to `@ocas/*` namespace** — reserved for builtins, CLI will reject.
3. **Forgetting `-p` for stdin** — `ocas put <type>` expects a file path; use `-p` to read from stdin.
4. **Expecting `list` to return hashes** — `list` commands return `ListEntry[]` with `{ hash, created, updated }`, not bare hashes.
5. **`workspace:*` in published packages** — only on `main` branch; release branches must have fixed versions.
