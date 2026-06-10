---
scenario: "{{name}} in a template resolves to payload.name without an explicit payload. prefix"
feature: render
tags: [render, template, liquidjs, regression, issue-137]
---

## Background

Issue #137 reports that a user-written template like
`"Name: {{name}}, Age: {{age}}"` produces empty values when rendered against an
object payload `{ "name": "alice", "age": 30 }`. The user expects the natural
top-level variables `{{name}}` and `{{age}}` to substitute payload properties
directly. Today, only `{{payload.name}}` / `{{payload.age}}` work; bare
`{{name}}` silently renders empty (LiquidJS `strictVariables: false`).

The fix exposes each top-level payload property as a Liquid context variable
in addition to the existing `payload` namespace. The existing context keys
(`hash`, `type`, `resolution`, `epsilon`, `payload`, `timestamp`) must not be
overwritten by a payload property of the same name — the engine-supplied keys
win.

## Given

- A fresh CAS store (memory or fs) with `bootstrap()` applied.
- An object schema registered via `putSchema(store, { type: "object", properties: { name: { type: "string" }, age: { type: "number" } } })` whose hash is `<personSchema>`.
- A node `<personHash>` storing `{ "name": "alice", "age": 30 }` under `<personSchema>`.
- The string schema hash `<stringSchema>` from `putSchema(store, { type: "string" })`.
- A template node `<templateHash>` of type `<stringSchema>` whose payload is the exact string `Name: {{name}}, Age: {{age}}`.
- A variable binding `@ocas/template/text/<personSchema>` → `<templateHash>` set via `store.var.set(...)`.

## When

- The user runs `ocas render <personHash>` (which calls `renderAsync(store, personHash, { resolution: 1.0, decay: 0.5, epsilon: 0.01 })`).

## Then

- The command exits with code 0.
- Stdout contains exactly the string `Name: alice, Age: 30` (no trailing newline is added beyond what the template itself contains).
- The equivalent in-process call `await renderWithTemplate(store, personHash, { resolution: 1.0, decay: 0.5, epsilon: 0.01 })` returns the same string `"Name: alice, Age: 30"`.
- `{{payload.name}}` and `{{payload.age}}` continue to resolve to the same values (the existing `payload` namespace is preserved, not removed).

## And — engine-supplied context keys are reserved

Given the same store and `<personSchema>`, with a payload `{ "hash": "shadow", "name": "bob" }` and template `Hash: {{hash}}, Name: {{name}}`:

- The rendered output starts with `Hash: ` followed by the **node's** CAS hash (the engine-supplied `hash` context variable), not the literal string `shadow`.
- `{{name}}` still substitutes to `bob`.
- The reserved keys `hash`, `type`, `resolution`, `epsilon`, `payload`, and `timestamp` are never shadowed by payload properties of the same name.

## And — non-object payloads are unchanged

- For a node whose payload is a primitive (e.g. string `"Hello"` stored under `{ type: "string" }`), templates referencing `{{payload}}` continue to render the primitive (`"Value is: Hello"` for template `"Value is: {{ payload }}"`).
- For a node whose payload is an array, only `{{payload}}` / `{% for x in payload %}` style access is required; no top-level merging is attempted (only object payloads contribute top-level keys).

## And — existing regression coverage updates

- The legacy test `Suite 9 › 9.1 Direct Property Access - Should Render Empty` in `packages/core/src/liquid-render.test.ts` (currently asserting `output === "Name: , Age: "`) is updated to assert the new behavior `output === "Name: Alice, Age: 30"` and renamed to reflect that direct property access now works.
- All other Suite 9 tests (`9.2`–`9.12`) continue to pass unchanged, including the `payload.*` access tests and the missing/null property graceful-handling tests (`{{name}}` for an unset property still renders empty, matching LiquidJS `strictVariables: false`).
