import type { Hash, Store } from "./types.js";

/** @internal Store implementations attach this for bootstrap() only. */
export const BOOTSTRAP_STORE = Symbol.for("@ocas/core/bootstrap-store");

export type BootstrapCapableStore = Store & {
  [BOOTSTRAP_STORE](payload: unknown): Hash | Promise<Hash>;
};

export function isBootstrapCapableStore(
  store: Store,
): store is BootstrapCapableStore {
  return (
    typeof (store as BootstrapCapableStore)[BOOTSTRAP_STORE] === "function"
  );
}
