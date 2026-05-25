# @uncaged/json-cas-fs

Filesystem-backed CAS store.

## Overview

`@uncaged/json-cas-fs` implements a persistent `Store` on disk. Each node is stored as `<hash>.bin` (CBOR-encoded `CasNode`). A `_index/` directory maps type hashes to content hashes for `listByType`. Stores support bootstrap via the same `BOOTSTRAP_STORE` symbol as the in-memory implementation.

Depends on `@uncaged/json-cas` for hashing, CBOR encoding, and types.

**Dependencies:** `@uncaged/json-cas`, `cborg`

## Installation

```bash
bun add @uncaged/json-cas-fs
```

## API

Exported from `src/index.ts`:

```typescript
function createFsStore(dir: string): BootstrapCapableStore;
```

`BootstrapCapableStore` is re-exported from `@uncaged/json-cas` (via the return type). The store loads existing `.bin` files on open and migrates or builds the type index on first use.

### Example

```typescript
import { bootstrap, putSchema } from "@uncaged/json-cas";
import { createFsStore } from "@uncaged/json-cas-fs";

const store = createFsStore("./my-cas-store");
await bootstrap(store);

const typeHash = await putSchema(store, {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
  additionalProperties: false,
});

const hash = await store.put(typeHash, { id: "item-1" });
console.log(store.has(hash)); // true after restart if same dir
```

### On-disk layout

```
my-cas-store/
├── <hash>.bin          # CBOR CasNode
├── _index/
│   └── <typeHash>      # newline-separated content hashes
└── ...
```

Writes use atomic rename (`<hash>.tmp` → `<hash>.bin`).

## Internal Structure

| File | Purpose |
|------|---------|
| `store.ts` | `createFsStore`, load/save nodes and type index |
| `index.ts` | Public export |
| `store.test.ts` | Filesystem store tests |
