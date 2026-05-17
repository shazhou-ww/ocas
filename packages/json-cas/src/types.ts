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
 * Content-addressable store interface.
 * put(null, payload) creates a self-referencing (bootstrap) node.
 */
export type Store = {
  put(typeHash: Hash | null, payload: unknown): Promise<Hash>;
  get(hash: Hash): CasNode | null;
  has(hash: Hash): boolean;
  list(): Hash[];
};
