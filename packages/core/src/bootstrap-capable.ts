import type { CasStore, Hash } from "./types.js";

/** @internal Store implementations attach this for bootstrap() only. */
export const BOOTSTRAP_STORE = Symbol.for("@ocas/core/bootstrap-store");

export type BootstrapCapableStore = CasStore & {
  [BOOTSTRAP_STORE](payload: unknown): Hash;
};

export function isBootstrapCapableStore(
  store: CasStore,
): store is BootstrapCapableStore {
  return (
    typeof (store as BootstrapCapableStore)[BOOTSTRAP_STORE] === "function"
  );
}
