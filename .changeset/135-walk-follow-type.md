---
"@ocas/core": minor
"@ocas/cli": minor
---

Add `followType` option to `walk()` to control schema chain traversal.

Core API: `WalkOptions.followType` (default `true` for backward compatibility) controls whether `node.type` edges are enqueued during BFS traversal. GC and closure callers are unaffected.

CLI: `ocas walk` now defaults to `followType: false` (cleaner output for users). Pass `--follow-type` to include the full schema chain.
