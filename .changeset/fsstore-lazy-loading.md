---
"@ocas/fs": patch
---

`FsStore` now uses lazy loading: at startup it scans only filenames in the `nodes/` subdirectory (no CBOR decoding) and reads each node from disk on first `get()`. This makes startup O(filenames) instead of O(decoded-bytes), keeps memory usage bounded by what's actually accessed, and avoids paying the full-load cost for stores with many nodes. Behaviour is unchanged: `has()`, `listAll()`, `listByType()`, `listMeta()`, and `listSchemas()` return the same results as before. Index/meta migration paths still work — they perform a one-time scan + decode when `_index/` is missing.
