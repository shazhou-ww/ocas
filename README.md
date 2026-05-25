# json-cas

Self-describing content-addressable storage with JSON Schema typed nodes.

## Overview

json-cas is a monorepo for storing and validating JSON data in a content-addressable store (CAS). Each node has a typed payload: its `type` field is the hash of a JSON Schema node that describes the payload shape. Hashes are 13-character Crockford Base32 strings derived from XXH64 over deterministic CBOR encoding.

A bootstrap meta-schema is stored as a self-referencing seed node (`type === hash`). All other schemas are registered as nodes typed by that meta-schema. Payloads can reference other nodes via `format: "cas_ref"` fields; the library provides traversal, reference extraction, and integrity verification.

Use the in-memory store for tests and embedded apps, the filesystem store for persistence, the workflow package for pre-built agent/workflow schemas, and the CLI for local store management.

## Architecture

```
                    ┌─────────────────┐
                    │  cli-json-cas   │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
     ┌─────────────────┐          ┌──────────────────────┐
     │  json-cas-fs    │          │ json-cas-workflow    │
     └────────┬────────┘          └──────────┬───────────┘
              │                              │
              └──────────────┬───────────────┘
                             ▼
                    ┌─────────────────┐
                    │    json-cas     │  (core)
                    └─────────────────┘
```

| Layer | Package | Role |
|-------|---------|------|
| Core | `@uncaged/json-cas` | Hashing, schemas, stores, verify, bootstrap |
| Storage | `@uncaged/json-cas-fs` | Filesystem-backed `Store` |
| Domain | `@uncaged/json-cas-workflow` | Workflow/agent JSON Schemas and payload types |
| CLI | `@uncaged/cli-json-cas` | `json-cas` command-line tool |

## Packages

| Package | Description | Type |
|---------|-------------|------|
| [`@uncaged/json-cas`](packages/json-cas/README.md) | Core CAS engine — hashing, schema, store, verify, bootstrap | lib |
| [`@uncaged/json-cas-fs`](packages/json-cas-fs/README.md) | Filesystem-backed CAS store | lib |
| [`@uncaged/json-cas-workflow`](packages/json-cas-workflow/README.md) | Workflow integration layer (schemas + types) | lib |
| [`@uncaged/cli-json-cas`](packages/cli-json-cas/README.md) | CLI tool (`json-cas` binary) | cli |

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

Binary: `json-cas` (from `@uncaged/cli-json-cas`). Default store: `~/.uncaged/json-cas`.

```
Usage: json-cas [--store <path>] [--json] <command> [args]

Commands:
  init                              Create store dir and write bootstrap seed
  bootstrap                         Write meta-schema seed, print hash
  schema put <file.json>            Register schema, print type hash
  schema get <type-hash>            Print schema JSON
  schema list                       List all schemas (name + hash)
  schema validate <hash>            Validate node against its schema
  put <type-hash> <file.json>       Store node, print hash
  get <hash>                        Print node as JSON
  has <hash>                        Print true/false
  verify <hash>                     Verify integrity, print ok/corrupted
  refs <hash>                       List direct cas_ref edges
  walk <hash> [--format tree]       Recursive traversal
  hash <type-hash> <file.json>      Compute hash without storing (dry run)
  cat <hash> [--payload]            Output node (--payload for payload only)

Flags:
  --store <path>   Store directory (default: ~/.uncaged/json-cas)
  --json           Compact JSON output
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
