import type { Hash, Store } from "./types.js";
/**
 * Write the meta-schema seed node into the store.
 * The returned hash equals the node's own type field (self-referencing).
 * Idempotent: calling bootstrap multiple times returns the same hash.
 */
export declare function bootstrap(store: Store): Promise<Hash>;
//# sourceMappingURL=bootstrap.d.ts.map