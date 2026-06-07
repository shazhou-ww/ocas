---
"@ocas/core": patch
---

Fix `gc` false-orphan deletion of `oneOf`-linked CAS chains and template content nodes.

`collectRefs` now traverses `oneOf` sub-schemas (previously skipped even though
the meta-schema accepted the keyword), so `walk`/`refs` correctly follow
`ocas_ref` fields nested inside `oneOf` combinators (e.g. nullable `prev` /
`detail` / `workflow` refs in uwf step chains).

`gc` no longer treats `@ocas/template/text/*` variables as roots; instead it
walks template content only when its referenced schema is itself reachable
from non-template roots, mirroring `computeClosure` Phase 3. This prevents
orphan template nodes from surviving GC when their schema is unreachable.

Fixes #93
