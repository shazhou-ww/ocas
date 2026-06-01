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
    // P1 leaf constraints
    minimum: { type: "number" },
    maximum: { type: "number" },
    exclusiveMinimum: { type: "number" },
    exclusiveMaximum: { type: "number" },
    minLength: { type: "number" },
    maxLength: { type: "number" },
    pattern: { type: "string" },
    minItems: { type: "number" },
    maxItems: { type: "number" },
    uniqueItems: { type: "boolean" },
    // P2 combinators + conditionals
    allOf: {
      type: "array",
      items: { type: "object", additionalProperties: false },
    },
    if: { type: "object", additionalProperties: false },
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a thenable
    then: { type: "object", additionalProperties: false },
    else: { type: "object", additionalProperties: false },
    patternProperties: {
      type: "object",
      additionalProperties: { type: "object", additionalProperties: false },
    },
    prefixItems: {
      type: "array",
      items: { type: "object", additionalProperties: false },
    },
    // P2 leaf constraints
    multipleOf: { type: "number" },
    minProperties: { type: "number" },
    maxProperties: { type: "number" },
    default: {},
  },
} as const;

const VARIABLE_PROPERTIES = {
  name: { type: "string" },
  schema: { type: "string", format: "cas_ref" },
  value: { type: "string", format: "cas_ref" },
  created: { type: "number" },
  updated: { type: "number" },
  tags: { type: "object" },
  labels: { type: "array", items: { type: "string" } },
} as const;

const OUTPUT_SCHEMAS: ReadonlyArray<
  readonly [alias: string, schema: Record<string, unknown>]
> = [
  [
    "@output/put",
    { type: "string", format: "cas_ref", title: "ucas put result" },
  ],
  [
    "@output/get",
    {
      type: "object",
      properties: {
        type: { type: "string", format: "cas_ref" },
        payload: {},
        timestamp: { type: "number" },
      },
      title: "ucas get result",
    },
  ],
  ["@output/has", { type: "boolean", title: "ucas has result" }],
  [
    "@output/hash",
    { type: "string", format: "cas_ref", title: "ucas hash result" },
  ],
  [
    "@output/verify",
    {
      type: "string",
      enum: ["ok", "corrupted", "invalid"],
      title: "ucas verify result",
    },
  ],
  [
    "@output/refs",
    {
      type: "array",
      items: { type: "string", format: "cas_ref" },
      title: "ucas refs result",
    },
  ],
  [
    "@output/walk",
    {
      type: "array",
      items: { type: "string" },
      title: "ucas walk result",
    },
  ],
  [
    "@output/list",
    {
      type: "array",
      items: { type: "string", format: "cas_ref" },
      title: "ucas list result",
    },
  ],
  [
    "@output/var-set",
    {
      type: "object",
      properties: { ...VARIABLE_PROPERTIES },
      title: "ucas var set result",
    },
  ],
  [
    "@output/var-get",
    {
      type: "object",
      properties: { ...VARIABLE_PROPERTIES },
      title: "ucas var get result",
    },
  ],
  [
    "@output/var-delete",
    {
      type: "object",
      properties: { ...VARIABLE_PROPERTIES },
      title: "ucas var delete result",
    },
  ],
  [
    "@output/var-tag",
    {
      type: "object",
      properties: { ...VARIABLE_PROPERTIES },
      title: "ucas var tag result",
    },
  ],
  [
    "@output/var-list",
    {
      type: "array",
      items: { type: "object", properties: { ...VARIABLE_PROPERTIES } },
      title: "ucas var list result",
    },
  ],
  [
    "@output/template-set",
    {
      type: "object",
      properties: {
        schemaHash: { type: "string", format: "cas_ref" },
        contentHash: { type: "string", format: "cas_ref" },
      },
      title: "ucas template set result",
    },
  ],
  [
    "@output/template-get",
    { type: "string", title: "ucas template get result" },
  ],
  [
    "@output/template-list",
    {
      type: "array",
      items: {
        type: "object",
        properties: {
          schemaHash: { type: "string", format: "cas_ref" },
          contentHash: { type: "string", format: "cas_ref" },
        },
      },
      title: "ucas template list result",
    },
  ],
  [
    "@output/template-delete",
    {
      type: "object",
      properties: { deleted: { type: "boolean" } },
      title: "ucas template delete result",
    },
  ],
  [
    "@output/gc",
    {
      type: "object",
      properties: {
        total: { type: "number" },
        reachable: { type: "number" },
        collected: { type: "number" },
        scanned: { type: "number" },
      },
      title: "ucas gc result",
    },
  ],
];

/**
 * Write the meta-schema seed node into the store and register built-in schemas.
 * The returned object contains aliases for the meta-schema, 5 primitive schemas,
 * and 18 @output/* schemas (24 total).
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

  // 3. Register @output/* schemas
  const aliases: Record<string, Hash> = {
    "@schema": metaHash,
    "@string": stringHash,
    "@number": numberHash,
    "@object": objectHash,
    "@array": arrayHash,
    "@bool": boolHash,
  };

  for (const [alias, schema] of OUTPUT_SCHEMAS) {
    aliases[alias] = await store.put(metaHash, schema);
  }

  return aliases;
}
