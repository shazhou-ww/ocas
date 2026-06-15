---
scenario: "All existing render and liquid-render tests pass unchanged"
feature: render
tags: [render, map-reduce-compose, backward-compatibility, regression]
---

## Given

- Existing test suite in `packages/core/src/render.test.ts`
- Existing test suite in `packages/core/src/liquid-render.test.ts`
- No compose templates registered for text format
- All tests use default text format

## When

- Refactor implements map-reduce-compose pipeline
- Run `pnpm run test` after implementation

## Then

- **Zero test modifications required**
- All existing assertions pass without changes
- Behavior is identical to pre-refactor implementation
- Identity compose (no compose template) preserves exact output
- This validates that the refactor is pure infrastructure (no behavior change)
- Text format users (CLI, existing integrations) see no difference
