import * as AjvModule from "ajv";
// ajv CJS default export: runtime `.default` holds the constructor,
// but tsc with verbatimModuleSyntax sees the namespace wrapper.
// biome-ignore lint/suspicious/noExplicitAny: CJS interop
const Ajv = (AjvModule.default ?? AjvModule);
import { bootstrap } from "./bootstrap.js";
export class SchemaValidationError extends Error {
    name = "SchemaValidationError";
}
const ajv = new Ajv();
ajv.addFormat("cas_ref", /^[0-9A-HJKMNP-TV-Z]{13}$/);
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
function isValidTypeValue(type) {
    if (typeof type === "string") {
        return JSON_SCHEMA_TYPES.has(type);
    }
    if (Array.isArray(type)) {
        if (type.length === 0)
            return false;
        return type.every((entry) => typeof entry === "string" && JSON_SCHEMA_TYPES.has(entry));
    }
    return false;
}
function isValidSchema(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const schema = value;
    for (const key of Object.keys(schema)) {
        if (!ALLOWED_SCHEMA_KEYS.has(key))
            return false;
    }
    if ("type" in schema && !isValidTypeValue(schema.type))
        return false;
    if ("properties" in schema) {
        const properties = schema.properties;
        if (properties === null ||
            typeof properties !== "object" ||
            Array.isArray(properties)) {
            return false;
        }
        for (const nested of Object.values(properties)) {
            if (!isValidSchema(nested))
                return false;
        }
    }
    if ("required" in schema) {
        if (!Array.isArray(schema.required))
            return false;
        for (const entry of schema.required) {
            if (typeof entry !== "string")
                return false;
        }
    }
    if ("additionalProperties" in schema) {
        const additionalProperties = schema.additionalProperties;
        if (typeof additionalProperties === "boolean") {
            // allowed
        }
        else if (!isValidSchema(additionalProperties)) {
            return false;
        }
    }
    if ("anyOf" in schema) {
        if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0)
            return false;
        for (const entry of schema.anyOf) {
            if (!isValidSchema(entry))
                return false;
        }
    }
    if ("oneOf" in schema) {
        if (!Array.isArray(schema.oneOf) || schema.oneOf.length === 0)
            return false;
        for (const entry of schema.oneOf) {
            if (!isValidSchema(entry))
                return false;
        }
    }
    if ("items" in schema && !isValidSchema(schema.items))
        return false;
    if ("format" in schema && typeof schema.format !== "string")
        return false;
    if ("title" in schema && typeof schema.title !== "string")
        return false;
    if ("description" in schema && typeof schema.description !== "string") {
        return false;
    }
    if ("enum" in schema) {
        if (!Array.isArray(schema.enum) || schema.enum.length === 0)
            return false;
    }
    return true;
}
function isMetaSchemaNode(store, node) {
    const schema = getSchema(store, node.type);
    return schema !== null && schema === node.payload;
}
/**
 * Store a JSON Schema as a CAS node typed by the meta-schema hash.
 * The returned hash becomes the typeHash for nodes that conform to this schema.
 */
export async function putSchema(store, jsonSchema) {
    const metaHash = await bootstrap(store);
    if (!isValidSchema(jsonSchema)) {
        throw new SchemaValidationError("Invalid schema: input does not conform to the json-cas JSON Schema meta-schema");
    }
    return store.put(metaHash, jsonSchema);
}
/**
 * Retrieve the JSON Schema payload for a given type hash.
 * Returns null if no node exists at that hash.
 */
export function getSchema(store, typeHash) {
    const node = store.get(typeHash);
    if (node === null)
        return null;
    return node.payload;
}
/**
 * Validate a node's payload against the schema identified by node.type.
 * Returns false if the schema cannot be found or validation fails.
 */
export function validate(store, node) {
    const schema = getSchema(store, node.type);
    if (schema === null)
        return false;
    if (isMetaSchemaNode(store, node)) {
        return isValidSchema(node.payload);
    }
    return ajv.validate(schema, node.payload);
}
/**
 * Recursively collect values of all properties whose schema has format: 'cas_ref'.
 * Handles: direct format, anyOf (nullable refs), items (array refs),
 * properties (nested objects), and additionalProperties (record refs).
 */
function collectRefs(schema, value) {
    const result = [];
    if (schema.format === "cas_ref") {
        if (typeof value === "string") {
            result.push(value);
        }
        return result;
    }
    if (Array.isArray(schema.anyOf)) {
        for (const sub of schema.anyOf) {
            result.push(...collectRefs(sub, value));
        }
        return result;
    }
    if (schema.type === "array" && schema.items && Array.isArray(value)) {
        const itemSchema = schema.items;
        for (const item of value) {
            result.push(...collectRefs(itemSchema, item));
        }
        return result;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        if (schema.properties && typeof schema.properties === "object") {
            const props = schema.properties;
            const obj = value;
            for (const [key, subSchema] of Object.entries(props)) {
                result.push(...collectRefs(subSchema, obj[key]));
            }
        }
        if (schema.additionalProperties &&
            typeof schema.additionalProperties === "object") {
            const addlSchema = schema.additionalProperties;
            const obj = value;
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
export function refs(store, node) {
    const schema = getSchema(store, node.type);
    if (schema === null)
        return [];
    return collectRefs(schema, node.payload);
}
/**
 * BFS traversal starting from rootHash.
 * Calls visitor(hash, node) for each reachable node exactly once.
 * Handles cycles via a visited set.
 */
export function walk(store, rootHash, visitor) {
    const visited = new Set();
    const queue = [rootHash];
    while (queue.length > 0) {
        const hash = queue.shift();
        if (visited.has(hash))
            continue;
        visited.add(hash);
        const node = store.get(hash);
        if (node === null)
            continue;
        visitor(hash, node);
        for (const refHash of refs(store, node)) {
            if (!visited.has(refHash)) {
                queue.push(refHash);
            }
        }
    }
}
//# sourceMappingURL=schema.js.map