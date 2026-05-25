import {
  BOOTSTRAP_STORE,
  isBootstrapCapableStore,
} from "./bootstrap-capable.js";
import type { Hash, Store } from "./types.js";

const JSON_SCHEMA_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
] as const;

/**
 * Self-describing JSON Schema meta-schema for the supported schema subset.
 * Stored as the bootstrap node's payload; its hash equals the node's type field.
 */
const BOOTSTRAP_PAYLOAD = {
  type: "object",
  additionalProperties: false,
  description: "json-cas JSON Schema meta-schema",
  properties: {
    type: {
      anyOf: [
        { type: "string", enum: [...JSON_SCHEMA_TYPES] },
        {
          type: "array",
          items: { type: "string", enum: [...JSON_SCHEMA_TYPES] },
        },
      ],
    },
    properties: {
      type: "object",
      additionalProperties: { type: "object", additionalProperties: false },
    },
    required: {
      type: "array",
      items: { type: "string" },
    },
    additionalProperties: {
      anyOf: [{ type: "boolean" }, { type: "object", additionalProperties: false }],
    },
    anyOf: {
      type: "array",
      items: { type: "object", additionalProperties: false },
    },
    items: { type: "object", additionalProperties: false },
    format: { type: "string" },
    title: { type: "string" },
    enum: { type: "array" },
    const: {},
    description: { type: "string" },
  },
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
