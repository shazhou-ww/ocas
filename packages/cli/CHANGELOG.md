# @ocas/cli

## 0.1.2

### Patch Changes

- Fix render output missing trailing newline.
- Fix TypeScript LSP errors: tsconfig `noEmit`, `exactOptionalPropertyTypes` conditional spread, `schemaHash` scope.
- Add agent skill setup hint with version to help output. Remove postinstall script (blocked by bun security policy). Update `ocas prompt setup` to guide cleanup of old skill versions before installing new ones.

- Updated dependencies:
  - @ocas/core@0.1.2
  - @ocas/fs@0.1.2

## 0.1.1

### Patch Changes

- Add `ocas prompt usage` and `ocas prompt setup` commands for agent skill management. Prompt content is bundled with the CLI and versioned with it.
- Add `--version` flag to display CLI version.

- Updated dependencies:
  - @ocas/core@0.1.1
  - @ocas/fs@0.1.1

## 0.1.0

Initial release as `@ocas/cli`. CLI tool for OCAS with put, get, list, render, verify, gc, var, and template commands. Envelope output format with pipe composition support.
