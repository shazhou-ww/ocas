---
scenario: "Core walk() accepts followType option to control schema chain traversal"
feature: walk
tags: [walk, follow-type, core, api, issue-135]
---

## Background

Issue #135: The core `walk(store, hash, visitor, options)` function adds a
`followType` boolean to `WalkOptions`. When `true` (the default for backward
compatibility), `node.type` is enqueued during BFS. When `false`, only payload
`ocas_ref` edges are followed.

## Given

- A fresh CAS store with `bootstrap()` applied.
- An object schema `<schema>` registered via `putSchema(store, { type: "object", properties: { ref: { format: "ocas_ref" }, val: { type: "number" } } })`.
- A leaf node `<leaf>` storing `{ "val": 7 }` under a simple schema `<simpleSchema>` (`{ type: "object", properties: { val: { type: "number" } } }`).
- A root node `<root>` storing `{ "ref": "<leaf>", "val": 1 }` under `<schema>`.

## When — followType: false

- `walk(store, root, visitor, { followType: false })` is called.

## Then

- The visitor is called for `<root>` and `<leaf>` only.
- The visitor is NOT called for `<schema>`, `<simpleSchema>`, or the meta-schema.
- Payload refs (`ocas_ref` edges) are still fully traversed.

## When — followType: true (explicit)

- `walk(store, root, visitor, { followType: true })` is called.

## Then

- The visitor is called for `<root>`, `<leaf>`, `<schema>`, `<simpleSchema>`, and the meta-schema.
- This is identical to the current (pre-change) behavior.

## When — followType omitted (default = true)

- `walk(store, root, visitor)` is called (no options).
- OR `walk(store, root, visitor, {})` is called (empty options).

## Then

- Behavior is identical to `followType: true`.
- This ensures backward compatibility: GC, closure, and any other callers that rely on schema-chain traversal continue to work without modification.

## And — GC and closure callers

- `gc(store)` internally calls `walk()` with `followType: true` (or relies on the default).
- `computeClosure(store, roots)` internally calls `walk()` with `followType: true` (or relies on the default).
- Both produce identical results to the pre-change implementation.
