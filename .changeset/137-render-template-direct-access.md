---
"@ocas/core": patch
---

fix(render): expose top-level object payload properties as Liquid context variables so templates like `{{name}}` resolve to `payload.name` without an explicit `payload.` prefix. Reserved engine keys (`hash`, `type`, `resolution`, `epsilon`, `payload`, `timestamp`) take precedence and are never shadowed by payload properties of the same name. Non-object payloads (primitives, arrays, null) continue to be accessed via `{{ payload }}`. Fixes #137.
