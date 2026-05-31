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
      anyOf: [
        { type: "boolean" },
        { type: "object", additionalProperties: false },
      ],
    },
    anyOf: {
      type: "array",
      items: { type: "object", additionalProperties: false },
    },
    oneOf: {
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
 * Write the meta-schema seed node into the store and register built-in schemas.
 * The returned object contains aliases for the meta-schema and 5 primitive schemas.
 * Idempotent: calling bootstrap multiple times returns the same hashes.
 */
export async function bootstrap(store: Store): Promise<Record<string, Hash>> {
  if (!isBootstrapCapableStore(store)) {
    throw new Error("Store does not support bootstrap");
  }

  // 1. Bootstrap the meta-schema (self-referential)
  const metaHash = await store[BOOTSTRAP_STORE](BOOTSTRAP_PAYLOAD);

  // 2. Register built-in primitive schemas directly (without putSchema to avoid recursion)
  const stringHash = await store.put(metaHash, { type: "string" });
  const numberHash = await store.put(metaHash, { type: "number" });
  const objectHash = await store.put(metaHash, { type: "object" });
  const arrayHash = await store.put(metaHash, { type: "array" });
  const boolHash = await store.put(metaHash, { type: "boolean" });

  // 3. Return map of aliases to hashes
  return {
    "@schema": metaHash,
    "@string": stringHash,
    "@number": numberHash,
    "@object": objectHash,
    "@array": arrayHash,
    "@bool": boolHash,
  };
}
