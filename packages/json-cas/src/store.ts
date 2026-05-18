import { BOOTSTRAP_STORE } from "./bootstrap-capable.js";
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

  async function putSelfReferencing(payload: unknown): Promise<Hash> {
    const hash = await computeSelfHash(payload);
    if (!data.has(hash)) {
      data.set(hash, { type: hash, payload, timestamp: Date.now() });
      indexHash(hash, hash);
    }
    return hash;
  }

  const store: Store = {
    async put(typeHash: Hash, payload: unknown): Promise<Hash> {
      const hash = await computeHash(typeHash, payload);

      if (!data.has(hash)) {
        data.set(hash, { type: typeHash, payload, timestamp: Date.now() });
        indexHash(typeHash, hash);
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

    [BOOTSTRAP_STORE]: putSelfReferencing,
  };

  return store;
}
