---
"@ocas/fs": patch
---

fix: dedupe type index files and rewrite on delete to prevent unbounded growth across store reopens. `parseIndexFile` now dedupes on read, `appendToTypeIndex` skips entries already present in memory, and `delete()` rewrites the on-disk type-index file even when the underlying node cannot be decoded (missing or corrupted .bin). Fixes #116.
