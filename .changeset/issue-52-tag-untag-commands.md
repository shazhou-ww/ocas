---
"@ocas/core": minor
"@ocas/cli": minor
---

Top-level tag/untag commands (#52)

- New `@ocas/output/tag` and `@ocas/output/untag` output schemas in core
- New top-level `ocas tag <target> <tag>...` and `ocas untag <target> <tag>...` commands
- Removed `ocas var tag` subcommand — tagging is now via top-level commands
