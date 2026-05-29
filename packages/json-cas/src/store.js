import { BOOTSTRAP_STORE, } from "./bootstrap-capable.js";
import { computeHash, computeSelfHash } from "./hash.js";
export function createMemoryStore() {
    const data = new Map();
    const byType = new Map();
    function indexHash(type, hash) {
        let set = byType.get(type);
        if (!set) {
            set = new Set();
            byType.set(type, set);
        }
        set.add(hash);
    }
    async function putSelfReferencing(payload) {
        const hash = await computeSelfHash(payload);
        if (!data.has(hash)) {
            data.set(hash, { type: hash, payload, timestamp: Date.now() });
            indexHash(hash, hash);
        }
        return hash;
    }
    const store = {
        async put(typeHash, payload) {
            const hash = await computeHash(typeHash, payload);
            if (!data.has(hash)) {
                data.set(hash, { type: typeHash, payload, timestamp: Date.now() });
                indexHash(typeHash, hash);
            }
            return hash;
        },
        get(hash) {
            return data.get(hash) ?? null;
        },
        has(hash) {
            return data.has(hash);
        },
        listByType(typeHash) {
            const set = byType.get(typeHash);
            return set ? [...set] : [];
        },
        [BOOTSTRAP_STORE]: putSelfReferencing,
    };
    return store;
}
//# sourceMappingURL=store.js.map