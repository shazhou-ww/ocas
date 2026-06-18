# @ocas/core

## 0.6.0 — 2026-06-18

- Beautify 6 remaining HTML output templates (refs, walk, var-history, gc, export, import) to use card layout with design system tokens. Add stats-grid CSS for gc/export/import, hash-list for refs/walk, and current marker for var-history. Add ocas-success and ocas-zero semantic CSS classes.
- Beautify 5 struct-type HTML output templates (get, var-set, var-get, var-delete, template-set) with card layout, design-guide tokens, hash pills, and tag badges
- Add HTML render format support: `ocas render <hash> --format html` produces a self-contained HTML5 document. Includes LiquidJS template discovery via `@ocas/template/html/<type-hash>`, YAML-in-`<pre><code>` fallback for unregistered types, builtin HTML document shell, and custom compose template override via `@ocas/template/html/_compose`.
- Add HTML output templates for all 24 @ocas/output/* schemas. Each schema now has both a text and HTML template registered during `registerOutputTemplates()`. HTML templates use semantic markup (dl, table, ul) with scoped `.ocas-` CSS classes injected via static templates. Also fills 4 missing text templates (list-meta, list-schema, export, import).
- Fix pipe render to use templates and respect --format for object-valued envelopes
  
  `ocas render -p` and the `-r` inline render flag now route object-valued
  envelopes through `renderDirectAsync`, which runs the full template lookup +
  map-reduce-compose pipeline. Previously these values were rendered via the
  synchronous `renderDirect` which ignored templates and the `--format` flag.
- Refactor render pipeline to map-reduce-compose architecture
  
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
- Beautify 6 simple-value HTML output templates (put, has, hash, verify, template-get, template-delete) with card layout, semantic badges, and design-guide-compliant CSS custom properties.
- putSchema now vets schemas under AJV strict mode at registration time, rejecting
  object-only keywords (properties/required/…) used in an independent applicator
  branch (oneOf/anyOf/allOf) or at the top level without a declared `type`. This
  eliminates the strictTypes warnings AJV otherwise logs on every validate, and
  turns a latent runtime footgun into an eager, actionable rejection.
  
  The gate uses `strict: true, strictSchema: false`, so it enforces only the
  strictTypes contract — JSON Schema 2020-12 keywords the ocas meta-schema already
  supports (e.g. prefixItems) and if/then/else children that inherit type from a
  parent are still accepted. Runtime validation of stored payloads is unchanged,
  so pre-existing data is unaffected.
- Replace HTML fallback `<pre><code>` YAML wrapping with structured, browsable HTML
  
  When no HTML instance template is registered for a type, `renderAsync()` now
  produces structured HTML instead of dumping YAML inside `<pre><code>` tags:
  
  - **Objects** → `<ul>` with `<li>` per key-value pair
  - **Arrays** → `<ul>` with `<li>` per item
  - **Primitives** → `<span>` / `<code>` inline elements
  - **CAS refs** → collapsible `<details><summary>` with recursive child rendering
  - **Epsilon threshold** → opaque `cas:XXXXX` text (not expandable)
  
  Nested structures render recursively. Text format fallback is unchanged (still YAML).
- Beautify 7 table-type HTML output templates (list, list-meta, list-schema, var-list, tag, untag, template-list) with card layout, styled tables, uppercase headers, count badges, em-dash for null values, and design-guide-compliant CSS
- Unify template variable namespaces — static and compose templates now have independent namespaces instead of being nested under `@ocas/template/`:
  
  - Static: `@ocas/template/{format}/{hash}/static` → `@ocas/template-static/{format}/{hash}`
  - Compose: `@ocas/template/{format}/_compose` → `@ocas/template-compose/{format}`
  - Instance templates unchanged: `@ocas/template/{format}/{hash}`
- Type statics Phase 2b: CSS/JS dedup + compose injection
  
  - Builtin HTML shell now injects type statics CSS as `<style>` in `<head>` and JS as `<script>` at end of `<body>`
  - `type_statics` passed to compose templates is now a LiquidJS-iterable array of `{ type_hash, css?, js?, ...slots }` objects (breaking change from Record format)
  - Deduplication at the type level: each type's statics appear exactly once regardless of instance count
  - Types without static templates are silently excluded (no errors, no empty entries)
  - Custom compose templates can iterate `type_statics` with `{% for ts in type_statics %}`
  - New exported type: `TypeStaticsEntry`

## 0.5.0 — 2026-06-10

- fix: `walk()` now enqueues each node's `type` hash so the schema chain is part of normal BFS traversal. This makes refs embedded inside a schema node's payload (via a custom meta-schema that declares an `ocas_ref` field) reachable via `walk`, `gc`, and `computeClosure` instead of being silently invisible. The visited-set dedup naturally terminates on the self-referencing bootstrap meta-schema. Fixes #130.
- Add `followType` option to `walk()` to control schema chain traversal.
  
  Core API: `WalkOptions.followType` (default `true` for backward compatibility) controls whether `node.type` edges are enqueued during BFS traversal. GC and closure callers are unaffected.
  
  CLI: `ocas walk` now defaults to `followType: false` (cleaner output for users). Pass `--follow-type` to include the full schema chain.
- Tighten `resolveHash`/`tryResolveHash` to classify inputs as `hash → @scope/name → malformed` and short-circuit malformed inputs without querying `store.var`. Unify the unresolved-input error wording across all CLI commands that take a `<hash-or-name>` argument (`get`, `verify`, `refs`, `walk`, `put`, `hash`, `render`, `tag`, `untag`, etc.) to `Error: Unknown hash or variable: <input>` (replacing the misleading `Name not found:` text). `ocas has` now correctly returns `{value: false}` for malformed inputs too — its no-die contract is preserved. `cmdPut`'s `Schema not found: <hash>` message is unchanged (it fires after a valid hash resolves but has no schema node). Exposes a new `isValidName(name)` predicate from `@ocas/core` alongside the existing `validateName(name)`.
  
  Fixes #136.
- fix(render): expose top-level object payload properties as Liquid context variables so templates like `{{name}}` resolve to `payload.name` without an explicit `payload.` prefix. Reserved engine keys (`hash`, `type`, `resolution`, `epsilon`, `payload`, `timestamp`) take precedence and are never shadowed by payload properties of the same name. Non-object payloads (primitives, arrays, null) continue to be accessed via `{{ payload }}`. Fixes #137.
- walk() and refs() now accept an optional onDangling callback so callers can detect dangling CAS refs without traversal aborting. Default behavior is unchanged: dangling refs are silently skipped. Fixes #112.
- Fix documentation: correct format name from cas_ref to ocas_ref, remove incorrect async signatures, add clarifying comments

## 0.4.1 — 2026-06-07

- Fix `gc` failing to preserve nodes referenced via `oneOf` — `collectRefs()` now traverses `oneOf` branches alongside existing `anyOf`/`allOf`/`if-then-else` handling.

## 0.4.0 — 2026-06-07

- New `computeClosure(store, roots)` — traverses references and schema chains to gather a complete CAS closure.
- New `exportBundle()` / `importBundle()` / `loadBundleStore()` — produce and consume self-contained POSIX-tar bundles (`cas/*.bin` CBOR payloads, `vars.jsonl`, `tags.jsonl`).
- New builtin output schemas: `@ocas/output/export`, `@ocas/output/import`.

## 0.3.0 — 2026-06-03

- No API changes. Coordinated version bump with `@ocas/fs` 0.3.0.

## 0.2.2 — 2026-06-03

- Lint and format fixes.

## 0.2.1 — 2026-06-03

- Migrate runtime from Bun to Node.js + pnpm.
- Migrate test framework from `bun:test` to Vitest.
- Extract `VariableStore` SQLite implementation to `@ocas/fs`.

## 0.2.0 — 2026-06-02

### Breaking Changes

- `Store` is now `{ cas: CasStore, var: VarStore, tag: TagStore }` — all sub-stores accessed via properties.
- `bootstrap(store)` and `putSchema(store, schema)` are now synchronous.
- `VariableStore` class removed — SQLite implementation moved to `@ocas/fs`.
- `createVariableStore()` removed.
- Zero `bun:sqlite` imports — pure TypeScript.

### New Features

- `CasStore`, `VarStore`, `TagStore` sub-store types.
- `validation.ts` — shared `validateName()` exported from core.

## 0.1.2 — 2026-06-02

- Fix TypeScript LSP errors: tsconfig `noEmit`, `exactOptionalPropertyTypes` conditional spread, `schemaHash` scope.

## 0.1.1 — 2026-06-02

- Internal improvements.

## 0.1.0 — 2026-06-01

Initial release. Content-addressable store engine with JSON Schema typed nodes, XXH64 hashing, variable store, render with resolution decay, and LiquidJS template support.
