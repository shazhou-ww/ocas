import type { BootstrapCapableStore } from "./bootstrap-capable.js";
import { BOOTSTRAP_STORE } from "./bootstrap-capable.js";
import { createMemoryStore } from "./store.js";
import type { CasNode, Hash, ListEntry, ListOptions } from "./types.js";

/** In-memory store wrapper used by schema validation tests. Wraps the
 * `cas` sub-store of an `OcasStore` and exposes the legacy
 * `BootstrapCapableStore` interface (async `put`, etc.). */
export class MemStore implements BootstrapCapableStore {
  readonly #inner: ReturnType<typeof createMemoryStore>["cas"];

  constructor() {
    this.#inner = createMemoryStore().cas;
  }

  async put(typeHash: Hash, payload: unknown): Promise<Hash> {
    return this.#inner.put(typeHash, payload);
  }

  get(hash: Hash): CasNode | null {
    return this.#inner.get(hash);
  }

  has(hash: Hash): boolean {
    return this.#inner.has(hash);
  }

  listByType(typeHash: Hash, options?: ListOptions): ListEntry[] {
    return this.#inner.listByType(typeHash, options);
  }

  listAll(): Hash[] {
    return this.#inner.listAll();
  }

  listMeta(options?: ListOptions): ListEntry[] {
    return this.#inner.listMeta(options);
  }

  listSchemas(options?: ListOptions): ListEntry[] {
    return this.#inner.listSchemas(options);
  }

  delete(hash: Hash): void {
    this.#inner.delete(hash);
  }

  async [BOOTSTRAP_STORE](payload: unknown): Promise<Hash> {
    return this.#inner[BOOTSTRAP_STORE](payload);
  }
}
