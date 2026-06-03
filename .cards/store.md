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
  cas: CasStore;
  var: VarStore;
  tag: TagStore;
};
```

### CasStore

Content-addressed storage. Handles `put`, `get`, `has`, and list operations over CAS nodes.

### VarStore

Mutable name → hash bindings (variables). Replaces the old standalone `VariableStore`.

### TagStore

Tag-based grouping and querying of CAS nodes.

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

### FsStore (`@ocas/fs`)

Filesystem-backed store. CAS nodes are stored as CBOR files; variables and tags use SQLite (`node:sqlite`). Created via `openStore(path)`, which:

1. Creates the directory if it doesn't exist
2. Runs [[Bootstrap]] automatically
3. Returns a ready-to-use Store

The default location is `~/.ocas`, configurable via `OCAS_HOME` environment variable or `--home` [[CLI]] flag.
