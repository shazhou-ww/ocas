import {
  BOOTSTRAP_STORE,
  isBootstrapCapableStore,
} from "./bootstrap-capable.js";
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
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["type", "payload", "timestamp"],
    properties: {
      type: { type: "string", description: "Hash of the type descriptor node (or self for bootstrap)" },
      payload: { description: "Arbitrary data" },
      timestamp: { type: "number", description: "Unix epoch ms when the node was first stored" },
    },
    additionalProperties: false,
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
  if (!isBootstrapCapableStore(store)) {
    throw new Error("Store does not support bootstrap");
  }
  return store[BOOTSTRAP_STORE](BOOTSTRAP_PAYLOAD);
}
