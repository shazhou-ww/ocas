---
"@ocas/core": minor
---

fix: `walk()` now enqueues each node's `type` hash so the schema chain is part of normal BFS traversal. This makes refs embedded inside a schema node's payload (via a custom meta-schema that declares an `ocas_ref` field) reachable via `walk`, `gc`, and `computeClosure` instead of being silently invisible. The visited-set dedup naturally terminates on the self-referencing bootstrap meta-schema. Fixes #130.
