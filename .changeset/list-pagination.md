---
"@ocas/core": minor
"@ocas/fs": minor
"@ocas/cli": minor
---

**Breaking:** `listByType()`, `listMeta()`, `listSchemas()` now return `ListEntry[]` (with `hash`, `created`, `updated`) instead of `Hash[]`. All list commands support `--sort`, `--limit`, `--offset`, `--desc` flags. `var list` supports the same pagination options via SQL.
