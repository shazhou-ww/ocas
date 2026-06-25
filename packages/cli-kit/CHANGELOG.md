# Changelog

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

