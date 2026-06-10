---
"@ocas/core": minor
---

walk() and refs() now accept an optional onDangling callback so callers can detect dangling CAS refs without traversal aborting. Default behavior is unchanged: dangling refs are silently skipped. Fixes #112.
