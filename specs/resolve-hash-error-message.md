---
scenario: "Unresolved hash-or-name inputs report 'Unknown hash or variable: <input>' instead of the misleading 'Schema not found'/'Name not found' wording"
feature: get
tags: [cli, error-handling, resolve-hash, error-message, issue-136]
---

## Background

Issue #136 calls out that the error wording produced when `ocas` cannot
resolve a hash-or-name argument is misleading. Two messages exist today:

- `Error: Name not found: <input>` — emitted by `resolveHash` in
  `packages/cli/src/index.ts` for any non-hash that misses in `store.var`.
- `Schema not found: <typeHash>` — emitted by `cmdPut` after a resolved
  hash fails the `getSchema(store, typeHash) === null` check.

The first message conflates two failure modes (malformed input vs.
syntactically valid but unregistered name). The second message — surfaced in
the issue's repro `ocas has "not-a-hash" --json` from an earlier code state
— says "Schema" even when the user's intent has nothing to do with schemas.

The fix unifies the wording so any failure to resolve a `<hash-or-name>`
argument from a `resolveHash` call reads:

```
Error: Unknown hash or variable: <input>
```

This applies wherever `resolveHash` is the caller (`cmdGet`, `cmdVerify`,
`cmdRefs`, `cmdWalk`, `cmdPut` for the type-hash arg, `cmdHash`,
`cmdRender`, etc.). The `Schema not found: <typeHash>` message inside
`cmdPut` is left as-is — that message fires AFTER a hash was successfully
resolved (the user supplied a hash that is real but no schema lives at it),
so "Schema not found" remains accurate there.

## Given

- A freshly-initialised OCAS store with `bootstrap()` applied.
- No user variables have been set.

## When

- The user runs `ocas get not-a-hash`.

## Then

- The command exits with code 1.
- Stderr is exactly `Error: Unknown hash or variable: not-a-hash\n` (one
  trailing newline, nothing else).
- Stderr does NOT contain the substring `Name not found`.
- Stderr does NOT contain the substring `Schema not found`.

## And — same message across every command that calls `resolveHash`

The following invocations all fail with exit code 1 and stderr containing
exactly `Error: Unknown hash or variable: not-a-hash`:

- `ocas get not-a-hash`
- `ocas verify not-a-hash`
- `ocas refs not-a-hash`
- `ocas walk not-a-hash`
- `ocas put not-a-hash /tmp/x.json` (the type-hash arg fails to resolve
  before any payload is read)
- `ocas hash not-a-hash /tmp/x.json`
- `ocas render not-a-hash`

## And — `Schema not found` is still emitted when a resolved hash has no schema node

Given a 13-char hash `AAAAAAAAAAAAA` that does NOT exist in CAS:

- `ocas put AAAAAAAAAAAAA /tmp/x.json` exits with code 1.
- Stderr contains the substring `Schema not found: AAAAAAAAAAAAA` (the
  existing `cmdPut` message, fired by the `getSchema(...) === null` branch
  in `packages/cli/src/index.ts`).
- This message MUST be preserved verbatim — the existing snapshot test
  `packages/cli/tests/__snapshots__/schema-validation.test.ts.snap` (key
  `Phase 2: Schema Validation > 2.3 put against non-existent schema hash
  fails 1` → `"Schema not found: AAAAAAAAAAAAA"`) continues to pass
  unchanged.

## And — existing "Name not found" test assertions must be updated

The following test assertions currently match the old wording and must be
updated to the new `Unknown hash or variable` text:

- `packages/cli/tests/alias.test.ts:279` — `expect(stderr).toContain("Error: Name not found:")`
- `packages/cli/tests/tag-untag.test.ts:183` — `expect(stderr).toContain("Name not found: @user/missing")`
- `packages/cli/tests/schema-validation.test.ts:383` — `expect(stderr).toContain("Name not found")`
- `packages/cli/tests/put-get-has.test.ts:142–146` — the "get on unresolvable name dies with 'Name not found'" test must be renamed and updated to assert `Error: Unknown hash or variable:`.
