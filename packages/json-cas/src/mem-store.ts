import type { BootstrapCapableStore } from "./bootstrap-capable.js";
import { BOOTSTRAP_STORE } from "./bootstrap-capable.js";
import { createMemoryStore } from "./store.js";
import type { CasNode, Hash } from "./types.js";

/** In-memory store wrapper used by schema validation tests. */
export class MemStore implements BootstrapCapableStore {
  readonly #inner: BootstrapCapableStore;

  constructor() {
    this.#inner = createMemoryStore();
  }

  put(typeHash: Hash, payload: unknown): Promise<Hash> {
    return this.#inner.put(typeHash, payload);
  }

  get(hash: Hash): CasNode | null {
    return this.#inner.get(hash);
  }

  has(hash: Hash): boolean {
    return this.#inner.has(hash);
  }

  listByType(typeHash: Hash): Hash[] {
    return this.#inner.listByType(typeHash);
  }

  listAll(): Hash[] {
    return this.#inner.listAll();
  }

  delete(hash: Hash): void {
    this.#inner.delete(hash);
  }

  [BOOTSTRAP_STORE](payload: unknown): Promise<Hash> {
    return this.#inner[BOOTSTRAP_STORE](payload);
  }
}
