# @ocas/fs

Filesystem-backed CAS store.

## Overview

`@ocas/fs` implements a persistent `Store` backed by `node:sqlite` (`DatabaseSync`). Nodes are stored as CBOR blobs in SQLite tables. Stores support bootstrap via the same `BOOTSTRAP_STORE` symbol as the in-memory implementation.

Depends on `@ocas/core` for hashing, CBOR encoding, and types.

**Dependencies:** `@ocas/core`, `cborg`

## Installation

```bash
pnpm add @ocas/fs
```

## API

Exported from `src/index.ts`:

```typescript
function openStore(path: string): Promise<Store>;
```

Returns a unified `Store` with `cas`, `var`, and `tag` sub-stores, backed by SQLite. Bootstraps automatically on open.

### Example

```typescript
import { putSchema } from "@ocas/core";
import { openStore } from "@ocas/fs";

const store = await openStore("./my-cas-store");

const typeHash = await putSchema(store, {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
  additionalProperties: false,
});

const hash = await store.put(typeHash, { id: "item-1" });
console.log(store.has(hash)); // true after restart if same dir
```

## Internal Structure

| File | Purpose |
|------|---------|
| `store.ts` | `createFsStore`, load/save nodes and type index |
| `index.ts` | Public export |
| `store.test.ts` | Filesystem store tests |
