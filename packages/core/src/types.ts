import type { Variable } from "./variable.js";

/**
 * 13-character uppercase Crockford Base32 string produced by XXH64.
 */
export type Hash = string;

/**
 * A content-addressed node with a typed payload.
 * - type: Hash of the type descriptor node (or self for bootstrap)
 * - payload: arbitrary data
 * - timestamp: Unix epoch ms when the node was first stored
 */
export type CasNode<T = unknown> = {
  type: Hash;
  payload: T;
  timestamp: number;
};

/**
 * Sort key for list operations.
 * - "created": ordering by node creation timestamp (default).
 * - "updated": ordering by mutation timestamp; for immutable CAS nodes this
 *   is identical to "created".
 */
export type ListSort = "created" | "updated";

/**
 * Common options shared by list operations on the CAS store.
 */
export type ListOptions = {
  sort?: ListSort;
  desc?: boolean;
  limit?: number;
  offset?: number;
};

/**
 * One entry in the result of a list operation: a hash plus its
 * creation/mutation timestamps. For immutable CAS nodes
 * `created === updated === node.timestamp`.
 */
export type ListEntry = {
  hash: Hash;
  created: number;
  updated: number;
};

/**
 * Content-addressable store interface.
 * Self-referencing nodes are created only via bootstrap().
 */
export type Store = {
  put(typeHash: Hash, payload: unknown): Hash | Promise<Hash>;
  get(hash: Hash): CasNode | null;
  has(hash: Hash): boolean;
  listByType(typeHash: Hash, options?: ListOptions): ListEntry[];
  listAll(): Hash[];
  listMeta(options?: ListOptions): ListEntry[];
  listSchemas(options?: ListOptions): ListEntry[];
  delete(hash: Hash): void;
};

/**
 * Synchronous content-addressable store interface (new unified design).
 * Unlike legacy `Store`, `put` returns the hash synchronously.
 */
export type CasStore = {
  get(hash: Hash): CasNode | null;
  put(typeHash: Hash, payload: unknown): Hash;
  has(hash: Hash): boolean;
  delete(hash: Hash): boolean;
  listByType(typeHash: Hash, options?: ListOptions): ListEntry[];
  listMeta(options?: ListOptions): ListEntry[];
  listSchemas(options?: ListOptions): ListEntry[];
  listAll(): Hash[];
};

/**
 * Options for setting/updating a variable.
 */
export type VarSetOptions = {
  tags?: Record<string, string>;
  labels?: string[];
};

/**
 * Options for listing variables.
 */
export type VarListOptions = ListOptions & {
  namePrefix?: string;
  exactName?: string;
  schema?: Hash;
  tags?: Record<string, string>;
  labels?: string[];
};

/**
 * One entry in a variable's history (most-recent-first per `position`).
 */
export type HistoryEntry = {
  value: Hash;
  position: number;
  setAt: number;
};

/**
 * Variable store interface — mutable bindings (name, schema) → hash.
 */
export type VarStore = {
  set(name: string, hash: Hash, options?: VarSetOptions): Variable;
  get(name: string, schema?: Hash): Variable | null;
  remove(name: string, schema?: Hash): Variable[];
  update(name: string, hash: Hash, options?: VarSetOptions): Variable;
  list(options?: VarListOptions): Variable[];
  history(name: string, schema?: Hash): HistoryEntry[];
  close(): void;
};

/**
 * A tag attached to a CAS target. `value === null` indicates a label
 * (bare identifier); otherwise a key-value tag.
 */
export type Tag = {
  key: string;
  value: string | null;
  target: Hash;
  created: number;
};

/**
 * A tag mutation operation: set (with value) or delete (key only).
 */
export type TagOp = {
  op: "set" | "delete";
  key: string;
  value?: string;
};

/**
 * Tag store interface — manages key-value tags and labels on CAS targets.
 */
export type TagStore = {
  tag(target: Hash, operations: TagOp[]): Tag[];
  untag(target: Hash, keys: string[]): void;
  tags(target: Hash): Tag[];
  listByTag(tag: string, options?: ListOptions): Hash[];
};

/**
 * Aggregate OCAS store: bundles CAS, variable, and tag stores.
 * Named `OcasStore` to avoid colliding with the legacy `Store` export.
 */
export type OcasStore = {
  cas: CasStore;
  var: VarStore;
  tag: TagStore;
};
