# @ocas/core

Core CAS engine — hashing, schema, store, verify, bootstrap.

## Overview

`@ocas/core` is the foundation of the ocas monorepo. It defines content-addressed nodes (`CasNode`), the `Store` interface, XXH64-based hashing with deterministic CBOR, JSON Schema registration and validation (including `cas_ref` links between nodes), bootstrap seeding, and integrity verification.

Other packages build on this layer: `@ocas/fs` provides persistence, and `@ocas/cli` exposes store operations on the command line.

**Dependencies:** `ajv`, `cborg`, `liquidjs`, `xxhash-wasm`

## Installation

```bash
pnpm add @ocas/core
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

type Store = { cas: CasStore; var: VarStore; tag: TagStore; };

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

type OnDangling = (hash: Hash) => void;
interface RefsOptions { onDangling?: OnDangling }
interface WalkOptions { onDangling?: OnDangling }

function refs(store: Store, node: CasNode, options?: RefsOptions): Hash[];
function walk(
  store: Store,
  rootHash: Hash,
  visitor: (hash: Hash, node: CasNode) => void,
  options?: WalkOptions,
): void;
```

- `putSchema` — stores a schema typed by the meta-schema; returned hash is the `typeHash` for conforming payloads.
- `refs` — collects all `format: "cas_ref"` values in the payload per schema shape. Pass `onDangling` to be notified once per unique referenced hash that is missing from the store; the returned array is unaffected.
- `walk` — BFS from `rootHash`, following `cas_ref` edges; cycles are visited once. Dangling refs (including a missing root) are silently skipped by default; pass `onDangling` to be notified once per unique missing hash discovered during the traversal.

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

### Closure & Bundles

```typescript
type ClosureResult = {
  nodes: Set<Hash>;
  vars: Variable[];
  tags: Map<Hash, Tag[]>;
};
function computeClosure(store: Store, roots: Hash[]): ClosureResult;

type ExportStats = { nodes: number; vars: number; tags: number };
type ImportOptions = { scope?: string };
type ImportStats = {
  nodes: { imported: number; skipped: number };
  vars: { created: number; updated: number };
  tags: number;
};
async function exportBundle(
  store: Store,
  roots: Hash[],
  outputPath: string,
): Promise<ExportStats>;
async function importBundle(
  bundlePath: string,
  target: Store,
  options?: ImportOptions,
): Promise<ImportStats>;
async function loadBundleStore(bundlePath: string): Promise<Store>;
```

- `computeClosure` — walks `cas_ref` edges and schema chains from each root,
  also gathering every `Variable` whose `value` lands in the closure and every
  `Tag` attached to an in-closure target.
- `exportBundle` — writes a self-contained POSIX-tar archive containing
  `cas/<hash>.bin` (CBOR-encoded payloads), `vars.jsonl`, and `tags.jsonl`.
- `importBundle` — content-addressed merge into `target`. Idempotent:
  re-importing the same bundle yields zero `imported` and zero `created`.
  `options.scope` rewrites the leading `@scope/` of every imported variable
  name except `@ocas/*` builtins.
- `loadBundleStore` — convenience that returns an in-memory `Store` populated
  from a bundle (for read-only inspection without touching the persistent store).

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
| `closure.ts` | `computeClosure` — refs + schema chain traversal |
| `bundle.ts` | `exportBundle`, `importBundle`, `loadBundleStore` (POSIX tar) |
| `index.ts` | Public exports |

Tests live in `src/*.test.ts` and `tests/`.
