import type { Hash, Store } from "./types.js";
/** @internal Store implementations attach this for bootstrap() only. */
export declare const BOOTSTRAP_STORE: unique symbol;
export type BootstrapCapableStore = Store & {
    [BOOTSTRAP_STORE](payload: unknown): Promise<Hash>;
};
export declare function isBootstrapCapableStore(store: Store): store is BootstrapCapableStore;
//# sourceMappingURL=bootstrap-capable.d.ts.map