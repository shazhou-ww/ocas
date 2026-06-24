---
"@ocas/cli": minor
---

## Phase 3: eliminate invokeLegacy, migrate all commands to native cli-kit

Complete migration of all 25+ CLI commands from the `invokeLegacy` bridge
pattern to native cli-kit actions:

- Read flags from `runtimeFlags` parameter (not global)
- Return values directly (no `out()`/`wrapEnvelope()`)
- Use `ctx.error()` instead of `die()` in action handlers
- Handle `--render` flag inline

Dead code purged: `invokeLegacy`, `commandOutput`, `wrapEnvelope`, `out()`,
all `cmd*` standalone functions. Net -275 lines.

Also fixes: list variable shadow, template list missing --render,
var delete duplicate render blocks, snake_case naming.
