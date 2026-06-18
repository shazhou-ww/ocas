---
"@ocas/core": minor
---

putSchema now vets schemas under AJV strict mode at registration time, rejecting
object-only keywords (properties/required/…) used in an independent applicator
branch (oneOf/anyOf/allOf) or at the top level without a declared `type`. This
eliminates the strictTypes warnings AJV otherwise logs on every validate, and
turns a latent runtime footgun into an eager, actionable rejection.

The gate uses `strict: true, strictSchema: false`, so it enforces only the
strictTypes contract — JSON Schema 2020-12 keywords the ocas meta-schema already
supports (e.g. prefixItems) and if/then/else children that inherit type from a
parent are still accepted. Runtime validation of stored payloads is unchanged,
so pre-existing data is unaffected.
