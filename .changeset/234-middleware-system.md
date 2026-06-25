---
"@ocas/cli-kit": minor
"@ocas/cli": patch
---

Add middleware system (function decorator pattern). Replaces the hollow `CliPlugin`
capability declaration with composable middleware that supplies behavior directly.

- **@ocas/cli-kit**: new `CliMiddleware` / `Handler` types, `CreateCliOptions.middleware`
  (global, outermost), `CommandBuilder.use()` (per-command, innermost-first), and a
  `renderMiddleware(openStore, renderFn)` factory. The render flag is now enabled
  implicitly by the presence of middleware. `CliPlugin` and `ocasRenderPlugin` are
  kept as deprecated exports for backward compatibility.
- **@ocas/cli**: render behavior moves out of ~18 per-command `if (flags.render)`
  blocks into a global `renderMiddleware` (renders returned hashes) plus small
  per-command `.use()` middlewares (for `renderDirectAsync`-style commands). No
  user-facing behavior change.
