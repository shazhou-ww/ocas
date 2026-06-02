import type { XXHashAPI } from "xxhash-wasm";
import xxhashFactory from "xxhash-wasm";

import { cborEncode } from "./cbor.js";
import type { Hash } from "./types.js";

/** Crockford Base32 symbol table (32 characters, indices 0–31). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Encode a u64 BigInt as a 13-character Crockford Base32 string. */
function u64ToCrockford(n: bigint): Hash {
  let result = "";
  let x = n;
  for (let i = 0; i < 13; i++) {
    result = CROCKFORD[Number(x & 31n)] + result;
    x >>= 5n;
  }
  return result;
}

/** Encode an ASCII string as bytes without TextEncoder (all hashes are ASCII). */
function asciiToBytes(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    bytes[i] = s.charCodeAt(i);
  }
  return bytes;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

let _instance: XXHashAPI | null = null;
let _pending: Promise<XXHashAPI> | null = null;

async function getInstance(): Promise<XXHashAPI> {
  if (_instance !== null) return _instance;
  if (_pending === null) {
    _pending = xxhashFactory().then((api) => {
      _instance = api;
      return api;
    });
  }
  return _pending;
}

/**
 * Initialize the xxhash WASM instance. After this resolves, the synchronous
 * hashing functions {@link computeHashSync} and {@link computeSelfHashSync}
 * may be called.
 */
export async function initHasher(): Promise<void> {
  await getInstance();
}

/**
 * Synchronous variant of {@link computeHash}. Must only be called after
 * {@link initHasher} has resolved at least once; throws otherwise.
 */
export function computeHashSync(typeHash: Hash, payload: unknown): Hash {
  if (_instance === null) {
    throw new Error("Hasher not initialised — call initHasher() first");
  }
  const input = concatBytes(asciiToBytes(typeHash), cborEncode(payload));
  return u64ToCrockford(_instance.h64Raw(input));
}

/**
 * Synchronous variant of {@link computeSelfHash}. Must only be called after
 * {@link initHasher} has resolved at least once; throws otherwise.
 */
export function computeSelfHashSync(payload: unknown): Hash {
  if (_instance === null) {
    throw new Error("Hasher not initialised — call initHasher() first");
  }
  return u64ToCrockford(_instance.h64Raw(cborEncode(payload)));
}

/**
 * hash = XXH64(utf8(typeHash) ++ CBOR_deterministic(payload))
 * Used for all normal nodes.
 */
export async function computeHash(
  typeHash: Hash,
  payload: unknown,
): Promise<Hash> {
  const api = await getInstance();
  const input = concatBytes(asciiToBytes(typeHash), cborEncode(payload));
  return u64ToCrockford(api.h64Raw(input));
}

/**
 * hash = XXH64(CBOR_deterministic(payload))
 * Used for self-referencing (bootstrap) nodes where type = hash.
 */
export async function computeSelfHash(payload: unknown): Promise<Hash> {
  const api = await getInstance();
  return u64ToCrockford(api.h64Raw(cborEncode(payload)));
}
