import type { CasNode, Hash, Store } from "./types.js";
export type JSONSchema = Record<string, unknown>;
export declare class SchemaValidationError extends Error {
    readonly name = "SchemaValidationError";
}
/**
 * Store a JSON Schema as a CAS node typed by the meta-schema hash.
 * The returned hash becomes the typeHash for nodes that conform to this schema.
 */
export declare function putSchema(store: Store, jsonSchema: JSONSchema): Promise<Hash>;
/**
 * Retrieve the JSON Schema payload for a given type hash.
 * Returns null if no node exists at that hash.
 */
export declare function getSchema(store: Store, typeHash: Hash): JSONSchema | null;
/**
 * Validate a node's payload against the schema identified by node.type.
 * Returns false if the schema cannot be found or validation fails.
 */
export declare function validate(store: Store, node: CasNode): boolean;
/**
 * Return all hashes referenced by this node via cas_ref fields in its schema.
 * Null/undefined values are skipped.
 */
export declare function refs(store: Store, node: CasNode): Hash[];
/**
 * BFS traversal starting from rootHash.
 * Calls visitor(hash, node) for each reachable node exactly once.
 * Handles cycles via a visited set.
 */
export declare function walk(store: Store, rootHash: Hash, visitor: (hash: Hash, node: CasNode) => void): void;
//# sourceMappingURL=schema.d.ts.map