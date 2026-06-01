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
 * Default limit applied when callers omit `limit` from list options.
 */
export const DEFAULT_LIST_LIMIT = 100;

/**
 * Content-addressable store interface.
 * Self-referencing nodes are created only via bootstrap().
 */
export type Store = {
  put(typeHash: Hash, payload: unknown): Promise<Hash>;
  get(hash: Hash): CasNode | null;
  has(hash: Hash): boolean;
  listByType(typeHash: Hash, options?: ListOptions): ListEntry[];
  listAll(): Hash[];
  listMeta(options?: ListOptions): ListEntry[];
  listSchemas(options?: ListOptions): ListEntry[];
  delete(hash: Hash): void;
};
