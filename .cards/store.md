---
title: Store
aliases: [存储接口]
tags: [concept, api]
related: [Content Addressing, Bootstrap]
---

# Store

The Store is the abstract storage interface at the heart of OCAS. All operations — put, get, verify, gc — go through this interface.

## Interface

```typescript
type Store = {
  put(typeHash: Hash, payload: unknown): Promise<Hash>;
  get(hash: Hash): CasNode | null;
  has(hash: Hash): boolean;
  listAll(): Hash[];
  listByType(typeHash: Hash, options?: ListOptions): ListEntry[];
  listMeta(options?: ListOptions): ListEntry[];
  listSchemas(options?: ListOptions): ListEntry[];
};
```

### ListOptions & ListEntry

List methods accept optional `ListOptions` for sorting and pagination:

```typescript
type ListSort = "created" | "updated";
type ListOptions = { sort?: ListSort; desc?: boolean; limit?: number; offset?: number };
type ListEntry = { hash: Hash; created: number; updated: number };
```

When `limit` is `undefined`, all results are returned (no cap). The [[CLI]] defaults `limit` to 100.

`put()` computes the [[Content Addressing|hash]] from `{ type, payload }`, validates the payload against its [[Schema]], and stores the [[Content Addressing|node]]. If a node with the same hash already exists, it's a no-op — content addressing gives deduplication for free.

## Implementations

### MemoryStore

In-memory `Map<Hash, CasNode>`. Used in tests and for ephemeral computation (e.g. computing a hash without persisting). Created via `createMemoryStore()`.

### FsStore

Filesystem-backed store (`@ocas/fs`). Nodes are serialized as CBOR files under a content-addressed directory tree. Created via `openStore(path)`, which:

1. Creates the directory if it doesn't exist
2. Runs [[Bootstrap]] automatically
3. Returns a ready-to-use Store

The default location is `~/.ocas`, configurable via `OCAS_HOME` environment variable or `--home` [[CLI]] flag.

## VariableStore

A companion store for [[Variable]] bindings, backed by SQLite. Created via `createVariableStore(dbPath, store)`. It sits alongside the CAS store — variables point into the CAS but live in their own database.
