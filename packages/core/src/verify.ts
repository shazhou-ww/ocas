import { computeHash, computeSelfHash } from "./hash.js";
import type { CasNode, Hash } from "./types.js";

/**
 * Verify that a stored node matches the given hash.
 * - Self-referencing nodes (type === hash): verified via CBOR-only hash.
 * - Normal nodes: verified via XXH64(type_bytes ++ CBOR(payload)).
 */
export async function verify(hash: Hash, node: CasNode): Promise<boolean> {
  if (node.type === hash) {
    const computed = await computeSelfHash(node.payload);
    return computed === hash;
  }
  const computed = await computeHash(node.type, node.payload);
  return computed === hash;
}
