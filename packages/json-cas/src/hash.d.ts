import type { Hash } from "./types.js";
/**
 * hash = XXH64(utf8(typeHash) ++ CBOR_deterministic(payload))
 * Used for all normal nodes.
 */
export declare function computeHash(typeHash: Hash, payload: unknown): Promise<Hash>;
/**
 * hash = XXH64(CBOR_deterministic(payload))
 * Used for self-referencing (bootstrap) nodes where type = hash.
 */
export declare function computeSelfHash(payload: unknown): Promise<Hash>;
//# sourceMappingURL=hash.d.ts.map