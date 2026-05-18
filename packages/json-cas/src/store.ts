import { computeHash, computeSelfHash } from "./hash.js";
import type { CasNode, Hash, Store } from "./types.js";

export function createMemoryStore(): Store {
  const data = new Map<Hash, CasNode>();
  const byType = new Map<Hash, Set<Hash>>();

  function indexHash(type: Hash, hash: Hash): void {
    let set = byType.get(type);
    if (!set) {
      set = new Set();
      byType.set(type, set);
    }
    set.add(hash);
  }

  return {
    async put(typeHash: Hash | null, payload: unknown): Promise<Hash> {
      const hash =
        typeHash === null
          ? await computeSelfHash(payload)
          : await computeHash(typeHash, payload);

      if (!data.has(hash)) {
        const type = typeHash === null ? hash : typeHash;
        data.set(hash, { type, payload, timestamp: Date.now() });
        indexHash(type, hash);
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

    listByType(typeHash: Hash): Hash[] {
      const set = byType.get(typeHash);
      return set ? [...set] : [];
    },
  };
}
