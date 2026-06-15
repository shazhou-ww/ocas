---
"@ocas/core": minor
"@ocas/cli": minor
---

Unify template variable namespaces — static and compose templates now have independent namespaces instead of being nested under `@ocas/template/`:

- Static: `@ocas/template/{format}/{hash}/static` → `@ocas/template-static/{format}/{hash}`
- Compose: `@ocas/template/{format}/_compose` → `@ocas/template-compose/{format}`
- Instance templates unchanged: `@ocas/template/{format}/{hash}`
