# json-cas

Self-describing content-addressable storage with JSON Schema typed nodes.

## Overview

json-cas is a monorepo for storing and validating JSON data in a content-addressable store (CAS). Each node has a typed payload: its `type` field is the hash of a JSON Schema node that describes the payload shape. Hashes are 13-character Crockford Base32 strings derived from XXH64 over deterministic CBOR encoding.

A bootstrap meta-schema is stored as a self-referencing seed node (`type === hash`). All other schemas are registered as nodes typed by that meta-schema. Payloads can reference other nodes via `format: "cas_ref"` fields; the library provides traversal, reference extraction, and integrity verification.

Use the in-memory store for tests and embedded apps, the filesystem store for persistence, and the CLI for local store management.

## Architecture

```
     ┌─────────────────┐
     │  cli-json-cas   │
     └────────┬────────┘
              │
              ▼
     ┌─────────────────┐
     │  json-cas-fs    │
     └────────┬────────┘
              │
              ▼
     ┌─────────────────┐
     │    json-cas     │  (core)
     └─────────────────┘
```

| Layer | Package | Role |
|-------|---------|------|
| Core | `@uncaged/json-cas` | Hashing, schemas, stores, verify, bootstrap |
| Storage | `@uncaged/json-cas-fs` | Filesystem-backed `Store` |
| CLI | `@uncaged/cli-json-cas` | `ucas` command-line tool |

## Packages

| Package | Description | Type |
|---------|-------------|------|
| [`@uncaged/json-cas`](packages/json-cas/README.md) | Core CAS engine — hashing, schema, store, verify, bootstrap | lib |
| [`@uncaged/json-cas-fs`](packages/json-cas-fs/README.md) | Filesystem-backed CAS store | lib |
| [`@uncaged/cli-json-cas`](packages/cli-json-cas/README.md) | CLI tool (`ucas` binary) | cli |

## Quick Start

```bash
git clone <repo-url>
cd json-cas
bun install --no-cache
bun run build
```

```typescript
import {
  bootstrap,
  createMemoryStore,
  putSchema,
  validate,
} from "@uncaged/json-cas";

const store = createMemoryStore();
await bootstrap(store);

const typeHash = await putSchema(store, {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
  additionalProperties: false,
});

const hash = await store.put(typeHash, { message: "hello" });
const node = store.get(hash);
console.log(validate(store, node!)); // true
```

For a persistent store:

```typescript
import { createFsStore } from "@uncaged/json-cas-fs";
import { bootstrap } from "@uncaged/json-cas";

const store = createFsStore("/path/to/store");
await bootstrap(store);
```

Or use the CLI (see [CLI Reference](#cli-reference) and [`packages/cli-json-cas/README.md`](packages/cli-json-cas/README.md)).

## CLI Reference

Binary: `ucas` (from `@uncaged/cli-json-cas`; legacy alias `json-cas` is deprecated). Default store:
`~/.uncaged/json-cas`. The store is auto-created and bootstrapped on first use — there is
no `init`/`bootstrap` command, and schemas are ordinary `@schema`-typed nodes (`ucas put
@schema file.json`), so there is no `schema` subcommand.

### Envelope format

Every JSON-emitting command prints a uniform `{ type, value }` envelope. `type` is the hash
of the command's `@output/*` result schema and `value` is the command payload. This makes
output self-describing and pipeable: feed any envelope into `render -p` to render its
`value` (embedded `cas_ref` hashes are expanded). `render` is the only command that emits
raw (non-envelope) text.

```jsonc
// ucas has <hash>
{ "type": "AYHQD2YA9G667", "value": true }
```

```
Usage: ucas [--store <path>] [--json] <command> [args]

Commands (all emit a { type, value } envelope unless noted):
  put <type-hash> <file.json>       Store node (value = hash)          (@output/put)
  get <hash>                        Node payload + metadata            (@output/get)
  has <hash>                        Existence boolean                  (@output/has)
  verify <hash>                     ok / corrupted / invalid           (@output/verify)
  refs <hash>                       Direct cas_ref edges               (@output/refs)
  walk <hash> [--format tree]       Recursive traversal                (@output/walk)
  hash <type-hash> <file.json>      Compute hash without storing       (@output/hash)
  render <hash> [options]           Render node as text (raw output)
  render --pipe/-p [options]        Render a piped envelope (raw output)
  list --type <hash-or-alias>       Hashes for a type (value = list)   (@output/list)
  list-meta                         Meta-schema hashes                 (@output/list-meta)
  list-schema                       All schema hashes                  (@output/list-schema)
  var set|get|delete|tag|list ...   Variable CRUD                      (@output/var-*)
  template set|get|list|delete ...  Output-template CRUD               (@output/template-*)
  gc                                Garbage collection                 (@output/gc)

Flags:
  --store <path>   Store directory (default: ~/.uncaged/json-cas)
  --json           Compact JSON output
  --pipe, -p       Read a { type, value } envelope from stdin for render
```

### Pipe examples

```bash
# Store a node, then render the stored content (the put envelope's hash is
# a cas_ref, so render -p dereferences and renders it):
ucas put @schema ./schemas/item.json | ucas render -p

# Render garbage-collection stats:
ucas gc | ucas render -p

# List every schema, then consume the envelope's value array with jq:
ucas list --type @schema | jq -r '.value[]'
```

## Development

```bash
bun install --no-cache   # install workspace dependencies
bun run build            # tsc --build (libs)
bun run check            # biome check
bun run format           # biome format --write
bun test                 # run all package tests
```

## Publishing

Releases use [Changesets](https://github.com/changesets/changesets). From the repo root:

```bash
bun run release   # changeset version → build → publish to npm (@uncaged/*)
```

Individual packages block `prepublishOnly` and expect releases via the workspace `release` script.
