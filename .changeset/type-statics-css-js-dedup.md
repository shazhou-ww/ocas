---
"@ocas/core": minor
---

Type statics Phase 2b: CSS/JS dedup + compose injection

- Builtin HTML shell now injects type statics CSS as `<style>` in `<head>` and JS as `<script>` at end of `<body>`
- `type_statics` passed to compose templates is now a LiquidJS-iterable array of `{ type_hash, css?, js?, ...slots }` objects (breaking change from Record format)
- Deduplication at the type level: each type's statics appear exactly once regardless of instance count
- Types without static templates are silently excluded (no errors, no empty entries)
- Custom compose templates can iterate `type_statics` with `{% for ts in type_statics %}`
- New exported type: `TypeStaticsEntry`
