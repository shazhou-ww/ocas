---
scenario: "Phase 2 migrates ocas CLI dispatch from switch-case to cli-kit command builder"
feature: cli-kit
tags: [cli, cli-kit, migration, phase-2]
---

## Given

- `packages/cli-kit/` from Phase 1 (`#215`) is available in the workspace
- `packages/cli/src/index.ts` currently contains a large switch-based command dispatcher

## When

- Phase 2 implementation for issue `#214` is applied
- The CLI entrypoint is reviewed in `packages/cli/src/index.ts`

## Then

- The entrypoint constructs the CLI via `createCLI(...)` from `@ocas/cli-kit`
- Each executable ocas command is declared using `.command(...).returns(...).action(...)`
- Commands that stream progress declare `.yields(...)` and emit yield envelopes to `stderr`
- The monolithic switch-based dispatch logic is removed from the runtime command path
- Existing command surface (top-level commands and subcommands) remains available after migration
