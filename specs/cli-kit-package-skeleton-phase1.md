---
scenario: "Phase 1 creates @ocas/cli-kit package skeleton without migrating ocas CLI"
feature: cli-kit
tags: [cli-kit, package, phase-1]
---

## Given

- The repository is at issue `#215` scope (Phase 1 only)
- `packages/cli-kit/` does not exist on `origin/main` before this change

## When

- A developer runs the Phase 1 implementation for issue `#215`
- The workspace build is executed with `pnpm run build`

## Then

- A new package directory `packages/cli-kit/` exists
- `packages/cli-kit/package.json` declares package name `@ocas/cli-kit`
- `packages/cli-kit/tsconfig.json` exists
- `packages/cli-kit/src/` includes:
  - `index.ts`
  - `types.ts`
  - `cli.ts`
  - `args.ts`
  - `output.ts`
  - `schema.ts`
  - `log.ts`
  - `render.ts`
- The implementation adds framework core only and does not migrate command implementations from `packages/cli`
- `pnpm run build` succeeds with the new package included
