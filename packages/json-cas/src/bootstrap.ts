import type { Hash, Store } from "./types.js";

/**
 * The meta-schema seed payload: describes the structure of every CAS node.
 * This is the root type from which all other type nodes derive.
 */
const BOOTSTRAP_PAYLOAD = {
  description: "json-cas meta-schema seed",
  hashAlgorithm: "xxh64",
  hashEncoding: "crockford-base32-13",
  nodeSchema: {
    payload: "any",
    timestamp: "number",
    type: "Hash",
  },
  payloadEncoding: "cbor-rfc8949-deterministic",
  version: "1",
} as const;

/**
 * Write the meta-schema seed node into the store.
 * The returned hash equals the node's own type field (self-referencing).
 * Idempotent: calling bootstrap multiple times returns the same hash.
 */
export async function bootstrap(store: Store): Promise<Hash> {
  return store.put(null, BOOTSTRAP_PAYLOAD);
}
