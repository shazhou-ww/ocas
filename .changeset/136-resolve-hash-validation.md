---
"@ocas/cli": patch
"@ocas/core": patch
---

Tighten `resolveHash`/`tryResolveHash` to classify inputs as `hash → @scope/name → malformed` and short-circuit malformed inputs without querying `store.var`. Unify the unresolved-input error wording across all CLI commands that take a `<hash-or-name>` argument (`get`, `verify`, `refs`, `walk`, `put`, `hash`, `render`, `tag`, `untag`, etc.) to `Error: Unknown hash or variable: <input>` (replacing the misleading `Name not found:` text). `ocas has` now correctly returns `{value: false}` for malformed inputs too — its no-die contract is preserved. `cmdPut`'s `Schema not found: <hash>` message is unchanged (it fires after a valid hash resolves but has no schema node). Exposes a new `isValidName(name)` predicate from `@ocas/core` alongside the existing `validateName(name)`.

Fixes #136.
