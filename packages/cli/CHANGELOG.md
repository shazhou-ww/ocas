# @uncaged/cli-json-cas

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

### Patch Changes

- Updated dependencies []:
  - @uncaged/json-cas@0.6.0
  - @uncaged/json-cas-fs@0.6.0

## 0.5.3

### Patch Changes

- Updated dependencies []:
  - @uncaged/json-cas@0.5.3
  - @uncaged/json-cas-fs@0.5.3

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @uncaged/json-cas@0.3.0
  - @uncaged/json-cas-fs@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @uncaged/json-cas@0.2.0
  - @uncaged/json-cas-fs@0.2.0

## 0.1.3

### Patch Changes

- fix: replace workspace:^ with actual version numbers in published dependencies

- Updated dependencies []:
  - @uncaged/json-cas@0.1.3
  - @uncaged/json-cas-fs@0.1.3
