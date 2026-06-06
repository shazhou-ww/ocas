---
"@ocas/fs": minor
---

Move CAS node files from the store root into a `nodes/` subdirectory. Pre-existing flat-layout stores are auto-migrated on first open: any `<HASH>.bin` files in the store root are renamed into `nodes/`. Metadata (`_index/`, `_store.db`, `_meta`) remain at the store root unchanged.
