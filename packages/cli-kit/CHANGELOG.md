# Changelog

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

