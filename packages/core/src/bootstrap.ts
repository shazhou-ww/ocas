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
  description: "ocas JSON Schema meta-schema",
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
    // P3 combinators
    not: { type: "object", additionalProperties: false },
    contains: { type: "object", additionalProperties: false },
    propertyNames: { type: "object", additionalProperties: false },
    // P3 metadata
    examples: { type: "array" },
    readOnly: { type: "boolean" },
    writeOnly: { type: "boolean" },
    deprecated: { type: "boolean" },
    $comment: { type: "string" },
  },
} as const;

const VARIABLE_PROPERTIES = {
  name: { type: "string" },
  schema: { type: "string", format: "ocas_ref" },
  value: { type: "string", format: "ocas_ref" },
  created: { type: "number" },
  updated: { type: "number" },
  tags: { type: "object" },
  labels: { type: "array", items: { type: "string" } },
} as const;

const OUTPUT_SCHEMAS: ReadonlyArray<
  readonly [alias: string, schema: Record<string, unknown>]
> = [
  [
    "@ocas/output/put",
    { type: "string", format: "ocas_ref", title: "ocas put result" },
  ],
  [
    "@ocas/output/get",
    {
      type: "object",
      properties: {
        type: { type: "string", format: "ocas_ref" },
        payload: {},
        timestamp: { type: "number" },
        tags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              value: { type: ["string", "null"] },
              target: { type: "string", format: "ocas_ref" },
              created: { type: "number" },
            },
          },
        },
      },
      title: "ocas get result",
    },
  ],
  ["@ocas/output/has", { type: "boolean", title: "ocas has result" }],
  [
    "@ocas/output/hash",
    { type: "string", format: "ocas_ref", title: "ocas hash result" },
  ],
  [
    "@ocas/output/verify",
    {
      type: "string",
      enum: ["ok", "corrupted", "invalid"],
      title: "ocas verify result",
    },
  ],
  [
    "@ocas/output/refs",
    {
      type: "array",
      items: { type: "string", format: "ocas_ref" },
      title: "ocas refs result",
    },
  ],
  [
    "@ocas/output/walk",
    {
      type: "array",
      items: { type: "string" },
      title: "ocas walk result",
    },
  ],
  [
    "@ocas/output/list",
    {
      type: "array",
      items: {
        type: "object",
        properties: {
          hash: { type: "string", format: "ocas_ref" },
          created: { type: "number" },
          updated: { type: "number" },
        },
        required: ["hash", "created", "updated"],
      },
      title: "ocas list result",
    },
  ],
  [
    "@ocas/output/list-meta",
    {
      type: "array",
      items: {
        type: "object",
        properties: {
          hash: { type: "string", format: "ocas_ref" },
          created: { type: "number" },
          updated: { type: "number" },
        },
        required: ["hash", "created", "updated"],
      },
      title: "ocas list-meta result",
    },
  ],
  [
    "@ocas/output/list-schema",
    {
      type: "array",
      items: {
        type: "object",
        properties: {
          hash: { type: "string", format: "ocas_ref" },
          created: { type: "number" },
          updated: { type: "number" },
        },
        required: ["hash", "created", "updated"],
      },
      title: "ocas list-schema result",
    },
  ],
  [
    "@ocas/output/var-set",
    {
      type: "object",
      properties: { ...VARIABLE_PROPERTIES },
      title: "ocas var set result",
    },
  ],
  [
    "@ocas/output/var-get",
    {
      type: "object",
      properties: {
        ...VARIABLE_PROPERTIES,
        valueTags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              value: { type: ["string", "null"] },
              target: { type: "string", format: "ocas_ref" },
              created: { type: "number" },
            },
          },
        },
      },
      title: "ocas var get result",
    },
  ],
  [
    "@ocas/output/var-delete",
    {
      type: "object",
      properties: { ...VARIABLE_PROPERTIES },
      title: "ocas var delete result",
    },
  ],
  [
    "@ocas/output/var-list",
    {
      type: "array",
      items: { type: "object", properties: { ...VARIABLE_PROPERTIES } },
      title: "ocas var list result",
    },
  ],
  [
    "@ocas/output/var-history",
    {
      type: "object",
      properties: {
        name: { type: "string" },
        schema: { type: "string", format: "ocas_ref" },
        values: {
          type: "array",
          items: { type: "string", format: "ocas_ref" },
        },
      },
      title: "ocas var history result",
    },
  ],
  [
    "@ocas/output/tag",
    {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: ["string", "null"] },
          target: { type: "string", format: "ocas_ref" },
          created: { type: "number" },
        },
      },
      title: "ocas tag result",
    },
  ],
  [
    "@ocas/output/untag",
    {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: ["string", "null"] },
          target: { type: "string", format: "ocas_ref" },
          created: { type: "number" },
        },
      },
      title: "ocas untag result",
    },
  ],
  [
    "@ocas/output/template-set",
    {
      type: "object",
      properties: {
        schemaHash: { type: "string", format: "ocas_ref" },
        contentHash: { type: "string", format: "ocas_ref" },
      },
      title: "ocas template set result",
    },
  ],
  [
    "@ocas/output/template-get",
    { type: "string", title: "ocas template get result" },
  ],
  [
    "@ocas/output/template-list",
    {
      type: "array",
      items: {
        type: "object",
        properties: {
          schemaHash: { type: "string", format: "ocas_ref" },
          contentHash: { type: "string", format: "ocas_ref" },
        },
      },
      title: "ocas template list result",
    },
  ],
  [
    "@ocas/output/template-delete",
    {
      type: "object",
      properties: { deleted: { type: "boolean" } },
      title: "ocas template delete result",
    },
  ],
  [
    "@ocas/output/gc",
    {
      type: "object",
      properties: {
        total: { type: "number" },
        reachable: { type: "number" },
        collected: { type: "number" },
        scanned: { type: "number" },
      },
      title: "ocas gc result",
    },
  ],
  [
    "@ocas/output/export",
    {
      type: "object",
      properties: {
        nodes: { type: "number" },
        vars: { type: "number" },
        tags: { type: "number" },
      },
      title: "ocas export result",
    },
  ],
  [
    "@ocas/output/import",
    {
      type: "object",
      properties: {
        nodes: {
          type: "object",
          properties: {
            imported: { type: "number" },
            skipped: { type: "number" },
          },
        },
        vars: {
          type: "object",
          properties: {
            created: { type: "number" },
            updated: { type: "number" },
          },
        },
        tags: { type: "number" },
      },
      title: "ocas import result",
    },
  ],
];

/**
 * Write the meta-schema seed node into the store and register built-in schemas.
 * The returned object contains aliases for the meta-schema, primitive schemas,
 * and @ocas/output/* schemas.
 * Idempotent: calling bootstrap multiple times returns the same hashes.
 *
 * All aliases are written to `store.var` via `var.set(name, hash)`, bypassing
 * @ocas/ namespace protection (protection is enforced only at the CLI layer).
 */
export function bootstrap(store: Store): Record<string, Hash> {
  const cas = store.cas;
  if (!isBootstrapCapableStore(cas)) {
    throw new Error("Store does not support bootstrap");
  }

  // 1. Bootstrap the meta-schema (self-referential)
  const metaHash = cas[BOOTSTRAP_STORE](BOOTSTRAP_PAYLOAD);

  // 2. Register built-in primitive schemas directly (without putSchema to avoid recursion)
  const stringHash = cas.put(metaHash, { type: "string" });
  const numberHash = cas.put(metaHash, { type: "number" });
  const integerHash = cas.put(metaHash, { type: "integer" });
  const boolHash = cas.put(metaHash, { type: "boolean" });
  const objectHash = cas.put(metaHash, { type: "object" });
  const arrayHash = cas.put(metaHash, { type: "array" });
  const nullHash = cas.put(metaHash, { type: "null" });

  // 3. Register @ocas/output/* schemas
  const aliases: Record<string, Hash> = {
    "@ocas/schema": metaHash,
    "@ocas/string": stringHash,
    "@ocas/number": numberHash,
    "@ocas/integer": integerHash,
    "@ocas/boolean": boolHash,
    "@ocas/bool": boolHash,
    "@ocas/object": objectHash,
    "@ocas/array": arrayHash,
    "@ocas/null": nullHash,
  };

  for (const [alias, schema] of OUTPUT_SCHEMAS) {
    aliases[alias] = cas.put(metaHash, schema);
  }

  // 4. Write all aliases to the var store. Idempotent: VarStore.set is an
  // upsert. Bypasses @ocas/ namespace protection — protection is enforced
  // only on the CLI `var set` command.
  for (const [name, hash] of Object.entries(aliases)) {
    store.var.set(name, hash);
  }

  return aliases;
}
