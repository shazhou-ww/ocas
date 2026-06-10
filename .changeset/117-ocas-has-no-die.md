---
"@ocas/cli": patch
---

Fix `ocas has` to return `{ value: false }` for unresolvable inputs instead of dying. Variable names that don't exist in the store no longer crash the predicate; they are simply reported as not present. Also rename the shared resolver error from `Schema not found:` to `Name not found:` since the lookup is by variable name, not schema (affects `get`, `verify`, `refs`, `walk`, etc. when given an unknown name).
