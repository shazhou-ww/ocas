# @ocas/core

Core CAS engine — hashing, schema, store, verify, bootstrap.

## Overview

`@ocas/core` is the foundation of the ocas monorepo. It defines content-addressed nodes (`CasNode`), the `Store` interface, XXH64-based hashing with deterministic CBOR, JSON Schema registration and validation (including `cas_ref` links between nodes), bootstrap seeding, and integrity verification.

Other packages build on this layer: `ocas-fs` provides persistence, and `cli-ocas` exposes store operations on the command line.

**Dependencies:** `ajv`, `cborg`, `xxhash-wasm`

## Installation

```bash
bun add @ocas/core
```

## API

All symbols below are exported from `src/index.ts`.

### Types

```typescript
/** 13-character uppercase Crockford Base32 (XXH64) */
type Hash = string;

type CasNode<T = unknown> = {
  type: Hash;
  payload: T;
  timestamp: number; // Unix epoch ms
};

type Store = {
  put(typeHash: Hash, payload: unknown): Promise<Hash>;
  get(hash: Hash): CasNode | null;
  has(hash: Hash): boolean;
  listByType(typeHash: Hash): Hash[];
};

type JSONSchema = Record<string, unknown>;

type BootstrapCapableStore = Store & {
  [BOOTSTRAP_STORE](payload: unknown): Promise<Hash>;
};
```

### Hashing

```typescript
function computeHash(typeHash: Hash, payload: unknown): Promise<Hash>;
function computeSelfHash(payload: unknown): Promise<Hash>;
function cborEncode(value: unknown): Uint8Array;
```

`computeHash` — `XXH64(utf8(typeHash) ++ CBOR(payload))` for normal nodes.

`computeSelfHash` — `XXH64(CBOR(payload))` for bootstrap nodes where `type === hash`.

### Bootstrap

```typescript
const BOOTSTRAP_STORE: unique symbol;

async function bootstrap(store: Store): Promise<Hash>;
```

Writes the meta-schema seed node (idempotent). Requires a `BootstrapCapableStore` (e.g. from `createMemoryStore()`).

### Schema

```typescript
class SchemaValidationError extends Error;

async function putSchema(store: Store, jsonSchema: JSONSchema): Promise<Hash>;
function getSchema(store: Store, typeHash: Hash): JSONSchema | null;
function validate(store: Store, node: CasNode): boolean;
function refs(store: Store, node: CasNode): Hash[];
function walk(
  store: Store,
  rootHash: Hash,
  visitor: (hash: Hash, node: CasNode) => void,
): void;
```

- `putSchema` — stores a schema typed by the meta-schema; returned hash is the `typeHash` for conforming payloads.
- `refs` — collects all `format: "cas_ref"` values in the payload per schema shape.
- `walk` — BFS from `rootHash`, following `cas_ref` edges; cycles are visited once.

### Store

```typescript
function createMemoryStore(): BootstrapCapableStore;
```

In-memory `Store` with type indexing, suitable for tests and ephemeral use.

### Verify

```typescript
async function verify(hash: Hash, node: CasNode): Promise<boolean>;
```

Recomputes hash from `node` and compares to `hash` (self-referencing vs normal rules).

### Example

```typescript
import {
  bootstrap,
  createMemoryStore,
  putSchema,
  refs,
  validate,
  walk,
} from "@ocas/core";

const store = createMemoryStore();
const metaHash = await bootstrap(store);

const personType = await putSchema(store, {
  type: "object",
  properties: {
    name: { type: "string" },
    friend: { type: "string", format: "cas_ref" },
  },
  required: ["name"],
  additionalProperties: false,
});

const aliceHash = await store.put(personType, { name: "Alice" });
const bobHash = await store.put(personType, {
  name: "Bob",
  friend: aliceHash,
});

const bob = store.get(bobHash)!;
console.log(validate(store, bob));           // true
console.log(refs(store, bob));               // [aliceHash]
walk(store, bobHash, (h) => console.log(h)); // bobHash, aliceHash
```

## Internal Structure

| File | Purpose |
|------|---------|
| `types.ts` | `Hash`, `CasNode`, `Store` |
| `hash.ts` | `computeHash`, `computeSelfHash` |
| `cbor.ts` | Deterministic CBOR encoding |
| `bootstrap-capable.ts` | `BOOTSTRAP_STORE` symbol and capability check |
| `bootstrap.ts` | Meta-schema seed and `bootstrap()` |
| `store.ts` | `createMemoryStore()` |
| `mem-store.ts` | Alternate in-memory store (tests only; not exported) |
| `schema.ts` | Schema put/get/validate, `refs`, `walk` |
| `verify.ts` | Node integrity verification |
| `index.ts` | Public exports |

Tests live in `src/*.test.ts` and `tests/`.
