---
scenario: "resolveHash rejects strings that are neither valid hashes nor valid @scope/name variable names, without querying store.var"
feature: get
tags: [cli, resolve-hash, validation, error-handling, issue-136]
---

## Background

Issue #136 reports that `resolveHash` (in `packages/cli/src/index.ts`) is too
lenient: any string that is not a 13-char Crockford Base32 hash is treated as
a potential variable name and looked up in `store.var`. But variable names
have a strict format — `@scope/segments...` validated by
`validateName()` in `packages/core/src/validation.ts`. A string like
`not-a-hash` cannot possibly be a registered variable (it would fail
`validateName` if `var set` were called with it), so `resolveHash` should
reject it as malformed input **before** querying `store.var`, and report a
clear error.

The fix tightens `resolveHash` / `tryResolveHash` with an explicit
classification:

1. If the input matches the 13-char hash regex `/^[0-9A-HJKMNP-TV-Z]{13}$/`,
   treat it as a hash and return as-is.
2. Else, if it matches the `@scope/name` format accepted by `validateName`,
   query `store.var.list({ exactName: input })`. Return the first match's
   value, or `null` (for `tryResolveHash`) / die with "Unknown hash or
   variable" (for `resolveHash`) when no match exists.
3. Else (the input is neither a hash nor a syntactically valid variable
   name), reject as malformed input — `tryResolveHash` returns `null` without
   touching `store.var`; `resolveHash` dies with the same "Unknown hash or
   variable" message.

This keeps the public CLI surface unchanged for all valid inputs and only
removes a wasted `store.var` query (and confusing error path) for inputs
that cannot ever resolve.

## Given

- A freshly-initialised OCAS store (memory or FS) with `bootstrap()` applied
  so the standard `@ocas/schema`, `@ocas/string`, `@ocas/output/*` builtin
  variables are registered.
- No user variables have been set.

## When

- The user runs `ocas get not-a-hash` (no `@`, fails the `@scope/name`
  format and is not a 13-char hash).

## Then

- The command exits with non-zero exit code (1).
- Stderr contains the exact string `Error: Unknown hash or variable: not-a-hash`.
- Stderr does NOT contain the substring `Schema not found` (the old
  misleading message from `cmdPut` must not surface here).
- Stdout is empty (no JSON envelope is written).
- `store.var.list` is NOT invoked for the malformed input (verifiable by a
  spy in a unit test on `resolveHash` against a mock store; the function
  short-circuits on the format check before touching `store.var`).

## And — alternative malformed inputs all produce the same error

For each of the following inputs (none are valid hashes; none are valid
`@scope/name`), `ocas get <input>` exits with code 1 and stderr contains
`Error: Unknown hash or variable: <input>`:

- `not-a-hash`
- `foo bar` (contains space)
- `@/x` (empty scope)
- `@1bad/x` (scope starts with digit)
- `@app/` (trailing slash, no segment)
- `@app//x` (consecutive slashes / empty segment)
- `@app/foo!bar` (illegal character in segment)
- `aaaaaaaaaaaaa` (lowercase — fails the uppercase Crockford Base32 check)
- `AAAAAAAAAAAAAA` (14 chars — wrong length)

## And — valid hash and valid registered name still resolve

- `ocas get <13-char-hash-that-was-stored>` continues to return the node and
  exit 0 when the hash exists.
- `ocas get @ocas/schema` continues to resolve via `store.var` and return the
  meta-schema node, exit 0.

## And — valid `@scope/name` format but unregistered name still goes through `store.var`

- `ocas get @nonexistent/var` queries `store.var.list({ exactName:
  "@nonexistent/var" })`, gets no matches, and dies with stderr
  `Error: Unknown hash or variable: @nonexistent/var` and exit code 1.
- This case must still invoke `store.var.list` (the format check passed) —
  only malformed inputs skip the lookup.
