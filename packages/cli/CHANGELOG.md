# @ocas/cli

## 0.7.2 — 2026-07-21

- Add middleware system (function decorator pattern). Replaces the hollow `CliPlugin`
  capability declaration with composable middleware that supplies behavior directly.
  
  - **@ocas/cli-kit**: new `CliMiddleware` / `Handler` types, `CreateCliOptions.middleware`
    (global, outermost), `CommandBuilder.use()` (per-command, innermost-first), and a
    `renderMiddleware(openStore, renderFn)` factory. The render flag is now enabled
    implicitly by the presence of middleware. `CliPlugin` and `ocasRenderPlugin` are
    kept as deprecated exports for backward compatibility.
  - **@ocas/cli**: render behavior moves out of ~18 per-command `if (flags.render)`
    blocks into a global `renderMiddleware` (renders returned hashes) plus small
    per-command `.use()` middlewares (for `renderDirectAsync`-style commands). No
    user-facing behavior change.
- Add command aliases, fuzzy unknown-command suggestions, and multi-format template returns.
  
  - **@ocas/cli-kit**: `.alias(...names)` on `CommandBuilder` registers alternate names
    resolved during dispatch. `TemplateSpec = string | FormatFunctors` allows per-format
    render functions in `.returns()`/`.yields()`. Levenshtein-based "Did you mean?" suggestions
    for unknown commands (edit distance ≤ 2). Help output shows aliases.
  - **@ocas/cli**: update snapshots and test for plain text error output (post-#241 alignment).
  
  Closes #243, #244

## 0.7.0 — 2026-06-24

- ## Phase 3: eliminate invokeLegacy, migrate all commands to native cli-kit
  
  Complete migration of all 25+ CLI commands from the `invokeLegacy` bridge
  pattern to native cli-kit actions:
  
  - Read flags from `runtimeFlags` parameter (not global)
  - Return values directly (no `out()`/`wrapEnvelope()`)
  - Use `ctx.error()` instead of `die()` in action handlers
  - Handle `--render` flag inline
  
  Dead code purged: `invokeLegacy`, `commandOutput`, `wrapEnvelope`, `out()`,
  all `cmd*` standalone functions. Net -275 lines.
  
  Also fixes: list variable shadow, template list missing --render,
  var delete duplicate render blocks, snake_case naming.
- Fix `-r/--render` flag: use node's own type hash for `renderDirectAsync`
  instead of envelope type hash. Add test coverage for the render flag path.

## 0.6.0 — 2026-06-18

- Add HTML render format support: `ocas render <hash> --format html` produces a self-contained HTML5 document. Includes LiquidJS template discovery via `@ocas/template/html/<type-hash>`, YAML-in-`<pre><code>` fallback for unregistered types, builtin HTML document shell, and custom compose template override via `@ocas/template/html/_compose`.
- Fix pipe render to use templates and respect --format for object-valued envelopes
  
  `ocas render -p` and the `-r` inline render flag now route object-valued
  envelopes through `renderDirectAsync`, which runs the full template lookup +
  map-reduce-compose pipeline. Previously these values were rendered via the
  synchronous `renderDirect` which ignored templates and the `--format` flag.
- feat: add FsCasStore.reindex() for proactive index repair and `ocas reindex` CLI command
- Add `--format html` and `--static` flags to all template subcommands (set/get/list/delete). HTML templates are stored at `@ocas/template/html/<schema-hash>` and static templates at `@ocas/template/html/<schema-hash>/static`. Default format remains `text` for backward compatibility.
- Unify template variable namespaces — static and compose templates now have independent namespaces instead of being nested under `@ocas/template/`:
  
  - Static: `@ocas/template/{format}/{hash}/static` → `@ocas/template-static/{format}/{hash}`
  - Compose: `@ocas/template/{format}/_compose` → `@ocas/template-compose/{format}`
  - Instance templates unchanged: `@ocas/template/{format}/{hash}`

## 0.5.0 — 2026-06-10

- Fix `ocas has` to return `{ value: false }` for unresolvable inputs instead of dying. Variable names that don't exist in the store no longer crash the predicate; they are simply reported as not present. Also rename the shared resolver error from `Schema not found:` to `Name not found:` since the lookup is by variable name, not schema (affects `get`, `verify`, `refs`, `walk`, etc. when given an unknown name).
- Add `followType` option to `walk()` to control schema chain traversal.
  
  Core API: `WalkOptions.followType` (default `true` for backward compatibility) controls whether `node.type` edges are enqueued during BFS traversal. GC and closure callers are unaffected.
  
  CLI: `ocas walk` now defaults to `followType: false` (cleaner output for users). Pass `--follow-type` to include the full schema chain.
- Tighten `resolveHash`/`tryResolveHash` to classify inputs as `hash → @scope/name → malformed` and short-circuit malformed inputs without querying `store.var`. Unify the unresolved-input error wording across all CLI commands that take a `<hash-or-name>` argument (`get`, `verify`, `refs`, `walk`, `put`, `hash`, `render`, `tag`, `untag`, etc.) to `Error: Unknown hash or variable: <input>` (replacing the misleading `Name not found:` text). `ocas has` now correctly returns `{value: false}` for malformed inputs too — its no-die contract is preserved. `cmdPut`'s `Schema not found: <hash>` message is unchanged (it fires after a valid hash resolves but has no schema node). Exposes a new `isValidName(name)` predicate from `@ocas/core` alongside the existing `validateName(name)`.
  
  Fixes #136.
- Add workflow testing documentation to triage-issues.yaml. The workflow now includes a comment explaining how to test it with `uwf thread start triage-issues -p "Test run"` before production use or after making changes.

## 0.4.0 — 2026-06-07

- New `ocas export <root> [<root>...] -o <bundle.tar>` — export CAS closures as self-contained tar bundles.
- New `ocas import <bundle.tar> [--scope @new]` — import bundles into a store.
- New global `--store <bundle.tar>` flag — open a bundle as read-only store for inspection commands.
- Rename `ocas prompt setup` to `ocas prompt bootstrap` with programmatic generation.
- New `ocas prompt list` subcommand.

## 0.3.1 — 2026-06-04

- Fix prompt docs: `bun` → `pnpm` install instructions, remove stale `--var-db` flag.

## 0.3.0 — 2026-06-03

- No CLI-specific changes. Coordinated version bump with `@ocas/fs` 0.3.0.

## 0.2.2 — 2026-06-03

- Lint and format fixes.

## 0.2.1 — 2026-06-03

- Full CLI build support with `tsc` emit + Node compatibility.
- Migrate runtime from Bun to Node.js + pnpm.

## 0.2.0 — 2026-06-02

### Breaking Changes

- `ocas var tag` subcommand removed — use `ocas tag` / `ocas untag` instead.

### New Features

- Top-level `ocas tag <target> <tag>...` and `ocas untag <target> <tag>...` commands.
- `ocas get` and `ocas var get` now include tag info in output.
- `ocas list --tag` and `ocas var list --tag` filter support.

## 0.1.2 — 2026-06-02

- Fix render output missing trailing newline.
- Add agent skill setup hint with version to help output.
- Remove postinstall script.

## 0.1.1 — 2026-06-02

- Add `ocas prompt usage` and `ocas prompt setup` commands.
- Add `--version` flag.

## 0.1.0 — 2026-06-01

Initial release. CLI tool for OCAS with put, get, list, render, verify, gc, var, and template commands.
