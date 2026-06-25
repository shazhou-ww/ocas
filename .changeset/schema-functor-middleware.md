---
"@ocas/cli-kit": minor
---

Add schema functor (second leg) to middleware system. Middleware can now declare `mapYield`/`mapReturn` schema morphisms alongside the value leg (`run`). The framework folds these morphisms and uses the effective schema for validation, ensuring the envelope type tag stays honest when middleware transforms the payload.

Bare function middleware (no schema legs) remains fully backward compatible — schema legs default to identity.

Closes #238
