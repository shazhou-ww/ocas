---
"@ocas/cli": patch
---

Fix `-r/--render` flag: use node's own type hash for `renderDirectAsync`
instead of envelope type hash. Add test coverage for the render flag path.
