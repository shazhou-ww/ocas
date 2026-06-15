---
id: content-hash-formula
title: "Content Hash Formula: XXH64 + CBOR + Crockford Base32"
sources:
  - packages/core/src/hash.ts
  - packages/core/src/cbor.ts
tags: [core, hashing]
created: 2026-06-15
updated: 2026-06-15
---

# Content Hash Formula

## How Hashing Works

The hash of a CAS node is computed as:

```
Hash = Base32(XXH64(ASCII(typeHash) ++ CBOR(payload)))
```

Key design choices:

1. **Type is part of the hash input** — the same payload under different types produces different hashes. This is intentional: a node's identity includes its schema.
2. **CBOR deterministic encoding** — payloads are CBOR-encoded with sorted keys before hashing, ensuring the same logical payload always produces the same bytes.
3. **Crockford Base32** — output is 13-character uppercase string (64-bit XXH64 → 13 chars), case-insensitive and avoids ambiguous characters (I/L/O/U).
4. **XXH64** — chosen for speed over cryptographic strength. CAS integrity relies on verified schema types, not collision resistance.

## Self-Referencing Exception

The meta-schema node has `type === hash` (self-referencing). It uses `computeSelfHash()` which hashes CBOR(payload) only (no type prefix), since the type IS the hash being computed.
