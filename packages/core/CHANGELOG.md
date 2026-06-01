# @uncaged/json-cas

## 0.6.0

### Minor Changes

- Unified `{ type, value }` envelope output for all CLI commands (RFC [#67](https://github.com/uncaged/json-cas/issues/67)).

  ### Breaking Changes

  - Removed `init`, `bootstrap`, `cat`, `schema put/get/list/validate` commands
  - All CLI command outputs now wrapped in `{ type, value }` envelope (except `render`)
  - `openStore()` is now async and auto-bootstraps

  ### New Features

  - 18 `@output/*` schemas registered at bootstrap
  - `list --type <hash-or-alias>` command (replaces `schema list`)
  - `verify` now checks both hash integrity and schema validation
  - `wrapEnvelope()` helper exported from `@uncaged/json-cas`
  - `openStore()` in `@uncaged/json-cas-fs` — async, auto mkdir + bootstrap
  - Default LiquidJS templates for all output schemas
  - Pipe composition: any command output can be piped to `render -p`

## 0.5.3

### Patch Changes

- feat: add oneOf support to meta-schema validation

  Added `oneOf` to `ALLOWED_SCHEMA_KEYS` and corresponding validation logic
  in `isValidSchema`. This enables workflow frontmatter schemas that use
  `oneOf` discriminated unions for multi-exit role definitions.

## 0.3.0

### Minor Changes

- Disallow self-referencing nodes in put(). typeHash is now required (no null). Self-ref only via bootstrap().

## 0.2.0

### Minor Changes

- Add listByType(typeHash) to Store interface for O(1) type-based queries, with append-only fs index

## 0.1.3
