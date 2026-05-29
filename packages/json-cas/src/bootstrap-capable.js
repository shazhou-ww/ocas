/** @internal Store implementations attach this for bootstrap() only. */
export const BOOTSTRAP_STORE = Symbol.for("@uncaged/json-cas/bootstrap-store");
export function isBootstrapCapableStore(store) {
    return (typeof store[BOOTSTRAP_STORE] === "function");
}
//# sourceMappingURL=bootstrap-capable.js.map