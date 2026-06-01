import {
  BOOTSTRAP_STORE,
  type BootstrapCapableStore,
} from "./bootstrap-capable.js";
import { computeHash, computeSelfHash } from "./hash.js";
import type { CasNode, Hash } from "./types.js";

export function createMemoryStore(): BootstrapCapableStore {
  const data = new Map<Hash, CasNode>();
  const byType = new Map<Hash, Set<Hash>>();
  const metaSet = new Set<Hash>();

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
    metaSet.add(hash);
    return hash;
  }

  const store: BootstrapCapableStore = {
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

    listByType(typeHash: Hash): Hash[] {
      const set = byType.get(typeHash);
      return set ? [...set] : [];
    },

    listAll(): Hash[] {
      return Array.from(data.keys());
    },

    listMeta(): Hash[] {
      return Array.from(metaSet);
    },

    listSchemas(): Hash[] {
      const result = new Set<Hash>();
      for (const meta of metaSet) {
        result.add(meta);
        const set = byType.get(meta);
        if (set) {
          for (const h of set) result.add(h);
        }
      }
      return Array.from(result);
    },

    delete(hash: Hash): void {
      const node = data.get(hash);
      if (node) {
        data.delete(hash);
        // Remove from type index
        const set = byType.get(node.type);
        if (set) {
          set.delete(hash);
          if (set.size === 0) {
            byType.delete(node.type);
          }
        }
        metaSet.delete(hash);
      }
    },

    [BOOTSTRAP_STORE]: putSelfReferencing,
  };

  return store;
}
