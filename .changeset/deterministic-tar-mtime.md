---
"@ocas/core": patch
---

Fix non-deterministic tar mtime in `packTar` — replace `Date.now()` with
per-node `node.timestamp`. This restores bit-for-bit reproducibility: the
same content now produces identical tar bytes across exports.

Merkle DAG invariant guarantees `parent.timestamp >= child.timestamp`,
so the root node's timestamp is naturally the max — no extra computation
needed. Derived files (`vars.jsonl`, `tags.jsonl`) use mtime=0.
