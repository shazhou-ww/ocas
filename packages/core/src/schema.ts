import * as AjvModule from "ajv";

// ajv CJS default export: runtime `.default` holds the constructor,
// but tsc with verbatimModuleSyntax sees the namespace wrapper.
// biome-ignore lint/suspicious/noExplicitAny: CJS interop
const Ajv = ((AjvModule as any).default ?? AjvModule) as {
  new (): {
    addFormat(name: string, re: RegExp): void;
    validate(schema: unknown, data: unknown): boolean;
  };
};

import { bootstrap } from "./bootstrap.js";
import type { CasNode, Hash, Store } from "./types.js";

export type JSONSchema = Record<string, unknown>;

export class SchemaValidationError extends Error {
  override readonly name = "SchemaValidationError";
}

const ajv = new Ajv();
ajv.addFormat("ocas_ref", /^[0-9A-HJKMNP-TV-Z]{13}$/);

const ALLOWED_SCHEMA_KEYS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "anyOf",
  "oneOf",
  "items",
  "format",
  "title",
  "enum",
  "const",
  "description",
  // P1 leaf constraints (no collectRefs impact)
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  // P2 combinators + conditionals (need collectRefs)
  "allOf",
  "if",
  "then",
  "else",
  "patternProperties",
  "prefixItems",
  // P2 leaf constraints
  "multipleOf",
  "minProperties",
  "maxProperties",
  "default",
  // P3 combinators (need collectRefs)
  "not",
  "contains",
  "propertyNames",
  // P3 metadata (no collectRefs impact)
  "examples",
  "readOnly",
  "writeOnly",
  "deprecated",
  "$comment",
]);

const JSON_SCHEMA_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

function isValidTypeValue(type: unknown): boolean {
  if (typeof type === "string") {
    return JSON_SCHEMA_TYPES.has(type);
  }
  if (Array.isArray(type)) {
    if (type.length === 0) return false;
    return type.every(
      (entry) => typeof entry === "string" && JSON_SCHEMA_TYPES.has(entry),
    );
  }
  return false;
}

function isValidSchema(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const schema = value as JSONSchema;
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) return false;
  }

  if ("type" in schema && !isValidTypeValue(schema.type)) return false;

  if ("properties" in schema) {
    const properties = schema.properties;
    if (
      properties === null ||
      typeof properties !== "object" ||
      Array.isArray(properties)
    ) {
      return false;
    }
    for (const nested of Object.values(properties as Record<string, unknown>)) {
      if (!isValidSchema(nested)) return false;
    }
  }

  if ("required" in schema) {
    if (!Array.isArray(schema.required)) return false;
    for (const entry of schema.required) {
      if (typeof entry !== "string") return false;
    }
  }

  if ("additionalProperties" in schema) {
    const additionalProperties = schema.additionalProperties;
    if (typeof additionalProperties === "boolean") {
      // allowed
    } else if (!isValidSchema(additionalProperties)) {
      return false;
    }
  }

  if ("anyOf" in schema) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) return false;
    for (const entry of schema.anyOf) {
      if (!isValidSchema(entry)) return false;
    }
  }

  if ("oneOf" in schema) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length === 0) return false;
    for (const entry of schema.oneOf) {
      if (!isValidSchema(entry)) return false;
    }
  }

  if ("items" in schema && !isValidSchema(schema.items)) return false;
  if ("format" in schema && typeof schema.format !== "string") return false;
  if ("title" in schema && typeof schema.title !== "string") return false;
  if ("description" in schema && typeof schema.description !== "string") {
    return false;
  }
  if ("enum" in schema) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) return false;
  }

  // P1 leaf constraints — type checks only
  if ("minimum" in schema && typeof schema.minimum !== "number") return false;
  if ("maximum" in schema && typeof schema.maximum !== "number") return false;
  if (
    "exclusiveMinimum" in schema &&
    typeof schema.exclusiveMinimum !== "number"
  )
    return false;
  if (
    "exclusiveMaximum" in schema &&
    typeof schema.exclusiveMaximum !== "number"
  )
    return false;
  if ("minLength" in schema && typeof schema.minLength !== "number")
    return false;
  if ("maxLength" in schema && typeof schema.maxLength !== "number")
    return false;
  if ("pattern" in schema && typeof schema.pattern !== "string") return false;
  if ("minItems" in schema && typeof schema.minItems !== "number") return false;
  if ("maxItems" in schema && typeof schema.maxItems !== "number") return false;
  if ("uniqueItems" in schema && typeof schema.uniqueItems !== "boolean")
    return false;

  // P2 combinators + conditionals — recursive sub-schema checks
  if ("allOf" in schema) {
    if (!Array.isArray(schema.allOf) || schema.allOf.length === 0) return false;
    for (const entry of schema.allOf) {
      if (!isValidSchema(entry)) return false;
    }
  }

  if ("if" in schema && !isValidSchema(schema.if)) return false;
  if ("then" in schema && !isValidSchema(schema.then)) return false;
  if ("else" in schema && !isValidSchema(schema.else)) return false;

  if ("patternProperties" in schema) {
    const pp = schema.patternProperties;
    if (pp === null || typeof pp !== "object" || Array.isArray(pp))
      return false;
    for (const nested of Object.values(pp as Record<string, unknown>)) {
      if (!isValidSchema(nested)) return false;
    }
  }

  if ("prefixItems" in schema) {
    if (!Array.isArray(schema.prefixItems) || schema.prefixItems.length === 0)
      return false;
    for (const entry of schema.prefixItems) {
      if (!isValidSchema(entry)) return false;
    }
  }

  // P2 leaf constraints — type checks only
  if ("multipleOf" in schema && typeof schema.multipleOf !== "number")
    return false;
  if ("minProperties" in schema && typeof schema.minProperties !== "number")
    return false;
  if ("maxProperties" in schema && typeof schema.maxProperties !== "number")
    return false;
  // "default" accepts any value — no type check needed

  // P3 combinators — recursive sub-schema checks
  if ("not" in schema && !isValidSchema(schema.not)) return false;
  if ("contains" in schema && !isValidSchema(schema.contains)) return false;
  if ("propertyNames" in schema && !isValidSchema(schema.propertyNames))
    return false;

  // P3 metadata — type checks only
  if ("examples" in schema && !Array.isArray(schema.examples)) return false;
  if ("readOnly" in schema && typeof schema.readOnly !== "boolean")
    return false;
  if ("writeOnly" in schema && typeof schema.writeOnly !== "boolean")
    return false;
  if ("deprecated" in schema && typeof schema.deprecated !== "boolean")
    return false;
  if ("$comment" in schema && typeof schema.$comment !== "string") return false;

  return true;
}

function isMetaSchemaNode(store: Store, node: CasNode): boolean {
  const schema = getSchema(store, node.type);
  return schema !== null && schema === node.payload;
}

/**
 * Store a JSON Schema as a CAS node typed by the meta-schema hash.
 * The returned hash becomes the typeHash for nodes that conform to this schema.
 */
export async function putSchema(
  store: Store,
  jsonSchema: JSONSchema,
): Promise<Hash> {
  const builtinSchemas = await bootstrap(store);
  const metaHash = builtinSchemas["@ocas/schema"];
  if (!metaHash) {
    throw new Error("Meta-schema not found in bootstrap result");
  }
  if (!isValidSchema(jsonSchema)) {
    throw new SchemaValidationError(
      "Invalid schema: input does not conform to the ocas JSON Schema meta-schema",
    );
  }
  return Promise.resolve(store.put(metaHash, jsonSchema));
}

/**
 * Retrieve the JSON Schema payload for a given type hash.
 * Returns null if no node exists at that hash.
 */
export function getSchema(store: Store, typeHash: Hash): JSONSchema | null {
  const node = store.get(typeHash);
  if (node === null) return null;
  return node.payload as JSONSchema;
}

/**
 * Validate a node's payload against the schema identified by node.type.
 * Returns false if the schema cannot be found or validation fails.
 */
export function validate(store: Store, node: CasNode): boolean {
  const schema = getSchema(store, node.type);
  if (schema === null) return false;
  if (isMetaSchemaNode(store, node)) {
    return isValidSchema(node.payload);
  }
  return ajv.validate(
    schema as Parameters<typeof ajv.validate>[0],
    node.payload,
  ) as boolean;
}

/**
 * Recursively collect values of all properties whose schema has format: 'ocas_ref'.
 * Handles: direct format, anyOf/allOf (combinators), oneOf, if/then/else (conditionals),
 * not, contains, items + prefixItems (arrays), properties (nested objects),
 * additionalProperties (record refs), and patternProperties (regex-keyed refs).
 */
export function collectRefs(schema: JSONSchema, value: unknown): Hash[] {
  const result: Hash[] = [];

  if (schema.format === "ocas_ref") {
    if (typeof value === "string") {
      result.push(value as Hash);
    }
    return result;
  }

  if (Array.isArray(schema.anyOf)) {
    for (const sub of schema.anyOf as JSONSchema[]) {
      result.push(...collectRefs(sub, value));
    }
    return result;
  }

  // P2: allOf — each sub-schema applies to the same value
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf as JSONSchema[]) {
      result.push(...collectRefs(sub, value));
    }
  }

  // P2: if/then/else — conditional sub-schemas apply to the same value
  if (schema.if && typeof schema.if === "object") {
    result.push(...collectRefs(schema.if as JSONSchema, value));
  }
  if (schema.then && typeof schema.then === "object") {
    result.push(...collectRefs(schema.then as JSONSchema, value));
  }
  if (schema.else && typeof schema.else === "object") {
    result.push(...collectRefs(schema.else as JSONSchema, value));
  }

  if (schema.type === "array" && Array.isArray(value)) {
    // P2: prefixItems — tuple validation, each item has its own schema
    if (Array.isArray(schema.prefixItems)) {
      const tupleSchemas = schema.prefixItems as JSONSchema[];
      const arr = value as unknown[];
      for (let i = 0; i < tupleSchemas.length && i < arr.length; i++) {
        const ts = tupleSchemas[i];
        if (ts) result.push(...collectRefs(ts, arr[i]));
      }
    }

    if (schema.items) {
      const itemSchema = schema.items as JSONSchema;
      // When prefixItems exists, items applies only to remaining elements
      const startIdx = Array.isArray(schema.prefixItems)
        ? (schema.prefixItems as unknown[]).length
        : 0;
      const arr = value as unknown[];
      for (let i = startIdx; i < arr.length; i++) {
        result.push(...collectRefs(itemSchema, arr[i]));
      }
    }

    // P3: contains — sub-schema for array items
    if (schema.contains && typeof schema.contains === "object") {
      const containsSchema = schema.contains as JSONSchema;
      for (const item of value as unknown[]) {
        result.push(...collectRefs(containsSchema, item));
      }
    }

    return result;
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (schema.properties && typeof schema.properties === "object") {
      const props = schema.properties as Record<string, JSONSchema>;
      const obj = value as Record<string, unknown>;
      for (const [key, subSchema] of Object.entries(props)) {
        result.push(...collectRefs(subSchema, obj[key]));
      }
    }

    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      const addlSchema = schema.additionalProperties as JSONSchema;
      const obj = value as Record<string, unknown>;
      for (const val of Object.values(obj)) {
        result.push(...collectRefs(addlSchema, val));
      }
    }

    // P2: patternProperties — regex-keyed property schemas
    if (
      schema.patternProperties &&
      typeof schema.patternProperties === "object"
    ) {
      const pp = schema.patternProperties as Record<string, JSONSchema>;
      const obj = value as Record<string, unknown>;
      for (const [pat, subSchema] of Object.entries(pp)) {
        const re = new RegExp(pat);
        for (const [key, val] of Object.entries(obj)) {
          if (re.test(key)) {
            result.push(...collectRefs(subSchema, val));
          }
        }
      }
    }
  }

  // P3: not — sub-schema applies to the same value
  if (schema.not && typeof schema.not === "object") {
    result.push(...collectRefs(schema.not as JSONSchema, value));
  }

  return result;
}

/**
 * Return all hashes referenced by this node via ocas_ref fields in its schema.
 * Null/undefined values are skipped.
 */
export function refs(store: Store, node: CasNode): Hash[] {
  const schema = getSchema(store, node.type);
  if (schema === null) return [];
  return collectRefs(schema, node.payload);
}

/**
 * BFS traversal starting from rootHash.
 * Calls visitor(hash, node) for each reachable node exactly once.
 * Handles cycles via a visited set.
 */
export function walk(
  store: Store,
  rootHash: Hash,
  visitor: (hash: Hash, node: CasNode) => void,
): void {
  const visited = new Set<Hash>();
  const queue: Hash[] = [rootHash];

  while (queue.length > 0) {
    const hash = queue.shift() as Hash;
    if (visited.has(hash)) continue;
    visited.add(hash);

    const node = store.get(hash);
    if (node === null) continue;

    visitor(hash, node);

    for (const refHash of refs(store, node)) {
      if (!visited.has(refHash)) {
        queue.push(refHash);
      }
    }
  }
}
