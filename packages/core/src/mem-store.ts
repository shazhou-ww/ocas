import { createMemoryStore } from "./store.js";
import type { CasStore, Store, TagStore, VarStore } from "./types.js";

/**
 * In-memory `Store` used by schema validation tests. It exposes the
 * `cas`, `var`, and `tag` sub-stores of an `Store` plus a few legacy
 * pass-through helpers (`get`, `put`, `has`, …) that some older tests still
 * use directly.
 */
export class MemStore implements Store {
  readonly cas: CasStore;
  readonly var: VarStore;
  readonly tag: TagStore;

  constructor() {
    const store = createMemoryStore();
    this.cas = store.cas;
    this.var = store.var;
    this.tag = store.tag;
  }

  // Legacy convenience pass-throughs ----------------------------------------
  get = (hash: Parameters<CasStore["get"]>[0]): ReturnType<CasStore["get"]> =>
    this.cas.get(hash);
  has = (hash: Parameters<CasStore["has"]>[0]): ReturnType<CasStore["has"]> =>
    this.cas.has(hash);
  put = (
    typeHash: Parameters<CasStore["put"]>[0],
    payload: unknown,
  ): ReturnType<CasStore["put"]> => this.cas.put(typeHash, payload);
  listByType: CasStore["listByType"] = (typeHash, options) =>
    this.cas.listByType(typeHash, options);
  listAll: CasStore["listAll"] = () => this.cas.listAll();
  listMeta: CasStore["listMeta"] = (options) => this.cas.listMeta(options);
  listSchemas: CasStore["listSchemas"] = (options) =>
    this.cas.listSchemas(options);
}
