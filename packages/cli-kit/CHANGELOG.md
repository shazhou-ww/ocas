# Changelog

## 0.5.0 — 2026-07-21

- Add middleware system (function decorator pattern). Replaces the hollow `CliPlugin`
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
- Add command aliases, fuzzy unknown-command suggestions, and multi-format template returns.
  
  - **@ocas/cli-kit**: `.alias(...names)` on `CommandBuilder` registers alternate names
    resolved during dispatch. `TemplateSpec = string | FormatFunctors` allows per-format
    render functions in `.returns()`/`.yields()`. Levenshtein-based "Did you mean?" suggestions
    for unknown commands (edit distance ≤ 2). Help output shows aliases.
  - **@ocas/cli**: update snapshots and test for plain text error output (post-#241 alignment).
  
  Closes #243, #244
- Add schema functor (second leg) to middleware system. Middleware can now declare `mapYield`/`mapReturn` schema morphisms alongside the value leg (`run`). The framework folds these morphisms and uses the effective schema for validation, ensuring the envelope type tag stays honest when middleware transforms the payload.
  
  Bare function middleware (no schema legs) remains fully backward compatible — schema legs default to identity.
  
  Closes #238

## 0.3.0 — 2026-06-25

- Close 5 capability gaps surfaced by the sumeru CLI migration (#230):
  
  - **`--help` / `-h`** — built-in help for top-level, group, and leaf commands; intercepted before flag parsing so it never trips "Unknown option". New optional `.describe()` adds a command description line.
  - **Short flag aliases** — `.flag("scene", { type: "string", alias: "s" })` makes `-s` an alias for `--scene`; help renders them as `-s, --scene`.
  - **`--no-<flag>` boolean negation** — `--no-network` sets a boolean flag to `false`; unknown or non-boolean targets still raise `Unknown option`.
  - **Per-command default output format** — `.returns(schema, template, { defaultFormat: "text" })` lets a command opt out of the YAML default. Precedence: `--json` > explicit `--format` > `defaultFormat` > `yaml`. `flags.format` in an action stays the user's raw value (or `undefined`), never the resolved wire format, so commands can use `--format` as a domain argument.
  - **Direct console channels** — `ctx.stdout` / `ctx.stderr` write straight to the process streams for immediate diagnostics, independent of the file-based `ctx.log`.
  
  All additive and backward compatible: commands that don't opt in behave exactly as before.

## 0.2.0 — 2026-06-24

- Add the new `@ocas/cli-kit` package skeleton for Phase 1 of the CLI framework extraction.
  
  This introduces:
  
  - command builder primitives with async-generator yield/return flow
  - zod-based schema validation for yields, returns, and errors
  - split output channels (`stderr` NDJSON yields, `stdout` final render)
  - schema naming defaults with override support
  - structured `@<cli>/error` envelopes and non-zero exit handling
  - log-tag validation and JSONL daily log writing
  - render plugin gating for `-r/--render`

## 0.2.0 — 2026-06-24

- Add the new `@ocas/cli-kit` package skeleton for Phase 1 of the CLI framework extraction.
  
  This introduces:
  
  - command builder primitives with async-generator yield/return flow
  - zod-based schema validation for yields, returns, and errors
  - split output channels (`stderr` NDJSON yields, `stdout` final render)
  - schema naming defaults with override support
  - structured `@<cli>/error` envelopes and non-zero exit handling
  - log-tag validation and JSONL daily log writing
  - render plugin gating for `-r/--render`

