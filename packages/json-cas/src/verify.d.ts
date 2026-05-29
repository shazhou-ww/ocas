import type { CasNode, Hash } from "./types.js";
/**
 * Verify that a stored node matches the given hash.
 * - Self-referencing nodes (type === hash): verified via CBOR-only hash.
 * - Normal nodes: verified via XXH64(type_bytes ++ CBOR(payload)).
 */
export declare function verify(hash: Hash, node: CasNode): Promise<boolean>;
//# sourceMappingURL=verify.d.ts.map