---
scenario: "ocas has returns {value: false} (never dies) for any unresolvable input — invalid hash, malformed name, or syntactically valid but unregistered name"
feature: has
tags: [cli, has, predicate, error-handling, issue-136]
---

## Background

Issue #136 highlights that `ocas has` is a predicate: its semantics are
"does this thing exist?". For any input — a malformed hash, a malformed
variable name, a valid-format name that isn't registered, gibberish — `has`
must return `{value: false}` with exit code 0, never crash. The original
repro in the issue (`ocas has "not-a-hash" --json` → exit 1, stderr
"Schema not found: not-a-hash") was already partially addressed by PR #125
(`fix(cli): ocas has should not die on unresolvable input`), which switched
`cmdHas` to call `tryResolveHash` instead of `resolveHash`.

This spec snapshots the **complete** post-#136 behavior of `cmdHas`,
combined with the tightened `tryResolveHash` from
`specs/resolve-hash-rejects-malformed-input.md`. The output envelope type is
`@ocas/output/has`; the value is always a boolean.

## Given

- A freshly-initialised OCAS store (memory or FS) with `bootstrap()` applied.
- No user variables have been set beyond the builtins.
- The `@ocas/output/has` envelope schema hash is reachable via
  `bootstrap()` — the envelope's `type` field in the JSON output is the
  current hash of that schema (today: `FHXQQZMVHW924`, but the spec asserts
  presence/equality, not the literal value).

## When

- The user runs `ocas has <input>` for the inputs enumerated below.

## Then — every unresolvable input yields `{value: false}` with exit code 0

For each of the following inputs, `ocas has <input>` exits with code 0 and
stdout is a JSON envelope `{"type":"<has-schema-hash>","value":false}`:

| Input               | Reason it is unresolvable                                  |
| ------------------- | ---------------------------------------------------------- |
| `not-a-hash`        | malformed: not a hash, fails `@scope/name` format          |
| `foo bar`           | malformed: contains a space                                |
| `@/x`               | malformed: empty scope                                     |
| `@1bad/x`           | malformed: scope starts with a digit                       |
| `@app/`             | malformed: trailing slash, no segment                      |
| `@app//x`           | malformed: empty segment                                   |
| `@app/foo!bar`      | malformed: illegal character in segment                    |
| `aaaaaaaaaaaaa`     | malformed: lowercase fails uppercase Crockford regex       |
| `AAAAAAAAAAAAAA`    | malformed: 14 chars, wrong length                          |
| `@nonexistent/var`  | valid format but not registered in `store.var`             |
| `AAAAAAAAAAAAA`     | valid format 13-char hash but not present in `store.cas`   |

In every case:

- Exit code is 0.
- Stderr is empty.
- Stdout JSON envelope parses cleanly; `envelope.value === false`;
  `envelope.type` equals the bootstrap-registered hash of the
  `@ocas/output/has` schema (same as a successful `has` invocation —
  invariant verified by `packages/cli/tests/put-get-has.test.ts` "has
  envelope type is @ocas/output/has regardless of outcome").

## Then — resolvable inputs return `{value: true}` unchanged

- `ocas has @ocas/schema` → exit 0, stdout envelope with `value: true`
  (builtin variable resolves to a hash that exists in CAS).
- After `ocas put @ocas/schema schema.json` produces hash `<h>`:
  `ocas has <h>` → exit 0, envelope with `value: true`.

## Then — missing argument still dies (usage error, not a predicate failure)

- `ocas has` (no arg) exits with non-zero code and stderr
  `Usage: ocas has <hash-or-name>` — unchanged from current behavior.
  (Missing the argument is a CLI usage error, not a predicate query about an
  empty input.)

## Implementation reference

`cmdHas` in `packages/cli/src/index.ts` already calls `tryResolveHash`
rather than `resolveHash`, so the no-die behavior is intact. After the
issue-#136 fix to `tryResolveHash` (rejecting malformed input at the format
check before querying `store.var`), `tryResolveHash` returns `null` faster
for malformed inputs; `cmdHas`'s
`hash !== null && store.cas.has(hash)` expression short-circuits to
`false`, and the envelope is emitted with `value: false` — exactly as
already covered by `packages/cli/tests/put-get-has.test.ts` (`has returns
false for an invalid hash format`, `has returns false for unresolvable
@scope/name`, etc.). New cases from the table above should be added to that
test suite.
