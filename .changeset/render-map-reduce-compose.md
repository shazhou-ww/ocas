---
"@ocas/core": minor
---

Refactor render pipeline to map-reduce-compose architecture

This internal refactor adds infrastructure for future HTML rendering while maintaining backward compatibility for existing text format workflows.

**Changes:**

- Added `format` option to `RenderOptions` (defaults to `'text'`)
- Refactored `renderAsync()` into three phases:
  1. **Map phase**: DFS rendering with type collection via `__encountered_types` context
  2. **Reduce phase**: Collect `TypeStatics` from static templates (`@ocas/template/{format}/{typeHash}/static`)
  3. **Compose phase**: Apply compose template (`@ocas/template/{format}/_compose`) or identity transformation
- Added `TypeStatics` type: `Record<string, string>` for slot-based static content
- Template discovery now uses format-namespaced variables: `@ocas/template/{format}/...`
- When no compose template exists, content is returned as-is (identity compose)
- All existing tests pass unchanged (zero behavior change for text format)

**Testing:**

- All existing render and liquid-render tests pass unchanged
- Added 4 new tests for compose template invocation, identity compose, format defaulting, and multi-type collection
- Static templates output JSON-parsed slot structures accessible in compose templates
