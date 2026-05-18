import * as AjvModule from "ajv";

// ajv CJS default export: runtime `.default` holds the constructor,
// but tsc with verbatimModuleSyntax sees the namespace wrapper.
// biome-ignore lint/suspicious/noExplicitAny: CJS interop
const Ajv = ((AjvModule as any).default ?? AjvModule) as {
	new (): { addFormat(name: string, re: RegExp): void; validate(schema: unknown, data: unknown): boolean };
};

import { bootstrap } from "./bootstrap.js";
import type { CasNode, Hash, Store } from "./types.js";

export type JSONSchema = Record<string, unknown>;

const ajv = new Ajv();
ajv.addFormat("cas_ref", /^[0-9A-HJKMNP-TV-Z]{13}$/);

/**
 * Store a JSON Schema as a CAS node typed by the meta-schema hash.
 * The returned hash becomes the typeHash for nodes that conform to this schema.
 */
export async function putSchema(
  store: Store,
  jsonSchema: JSONSchema,
): Promise<Hash> {
  const metaHash = await bootstrap(store);
  return store.put(metaHash, jsonSchema);
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
  return ajv.validate(
    schema as Parameters<typeof ajv.validate>[0],
    node.payload,
  ) as boolean;
}

/**
 * Recursively collect values of all properties whose schema has format: 'cas_ref'.
 * Handles: direct format, anyOf (nullable refs), items (array refs),
 * properties (nested objects), and additionalProperties (record refs).
 */
function collectRefs(schema: JSONSchema, value: unknown): Hash[] {
  const result: Hash[] = [];

  if (schema.format === "cas_ref") {
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

  if (schema.type === "array" && schema.items && Array.isArray(value)) {
    const itemSchema = schema.items as JSONSchema;
    for (const item of value as unknown[]) {
      result.push(...collectRefs(itemSchema, item));
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
  }

  return result;
}

/**
 * Return all hashes referenced by this node via cas_ref fields in its schema.
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
