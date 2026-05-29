import { computeHash, computeSelfHash } from "./hash.js";
/**
 * Verify that a stored node matches the given hash.
 * - Self-referencing nodes (type === hash): verified via CBOR-only hash.
 * - Normal nodes: verified via XXH64(type_bytes ++ CBOR(payload)).
 */
export async function verify(hash, node) {
    if (node.type === hash) {
        const computed = await computeSelfHash(node.payload);
        return computed === hash;
    }
    const computed = await computeHash(node.type, node.payload);
    return computed === hash;
}
//# sourceMappingURL=verify.js.map