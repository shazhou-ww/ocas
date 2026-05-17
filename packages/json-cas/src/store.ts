import { computeHash, computeSelfHash } from "./hash.js";
import type { CasNode, Hash, Store } from "./types.js";

export function createMemoryStore(): Store {
  const data = new Map<Hash, CasNode>();

  return {
    async put(typeHash: Hash | null, payload: unknown): Promise<Hash> {
      const hash =
        typeHash === null
          ? await computeSelfHash(payload)
          : await computeHash(typeHash, payload);

      if (!data.has(hash)) {
        const type = typeHash === null ? hash : typeHash;
        data.set(hash, { type, payload, timestamp: Date.now() });
      }

      return hash;
    },

    get(hash: Hash): CasNode | null {
      return data.get(hash) ?? null;
    },

    has(hash: Hash): boolean {
      return data.has(hash);
    },

    list(): Hash[] {
      return [...data.keys()];
    },
  };
}
