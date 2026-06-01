---
title: Content Addressing
aliases: [CAS, 内容寻址]
tags: [concept]
related: [Schema, Store]
---

# Content Addressing

Content addressing is the foundational principle of OCAS: a piece of data is identified by the hash of its content, not by a location or a user-chosen key.

## How It Works

Data goes in → deterministic hash comes out → that hash **is** the address.

```
payload: { "name": "Alice" }
         ↓ CBOR encode → XXH64 → Crockford Base32
hash:    A0QKG4ERMXSFG   (13 characters, always)
```

Same content always produces the same hash. Different content always produces a different hash.

## Hash

OCAS hashes are 13-character uppercase strings using **Crockford Base32** encoding over a **XXH64** digest.

- Input: CBOR-encoded `{ type, payload }` (timestamp excluded — same logical data = same hash)
- Output: `[0-9A-HJKMNP-TV-Z]{13}` (e.g. `A0QKG4ERMXSFG`)
- Crockford Base32 excludes ambiguous characters (I, L, O, U), making hashes safe for copy-paste and verbal communication

The `Hash` type is defined as a plain string — no wrapper object, no overhead.

## Node

Every piece of data stored in OCAS is a **Node** — a three-field record:

```typescript
type CasNode = {
  type: Hash;       // hash of the node's schema (points to a Schema node)
  payload: unknown; // the actual data
  timestamp: number; // Unix epoch ms, set on first store
};
```

- `type` links the node to its [[Schema]], forming a typed DAG
- `payload` is the user's data, validated against the schema on write
- `timestamp` is metadata only — it is **not** included in hash computation, so storing the same logical data twice returns the same hash

## Immutability

Once stored, a node can never change — modifying the payload would change the hash, creating a different node. This gives OCAS several properties for free:

- **Deduplication** — identical data is stored exactly once
- **Integrity verification** — recompute the hash to check for corruption
- **Safe sharing** — a hash is a tamper-proof reference; if you have the hash, you know exactly what data you'll get

Mutability is handled at a higher layer by [[Variable]] — mutable pointers to immutable nodes.
