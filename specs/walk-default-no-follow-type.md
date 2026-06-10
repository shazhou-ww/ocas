---
scenario: "ocas walk without --follow-type excludes the schema chain from traversal output"
feature: walk
tags: [walk, follow-type, cli, issue-135]
---

## Background

Issue #135: `walk()` always enqueues `node.type` (the schema chain), which is
necessary for GC and export but is noise for end-user exploration. The CLI
should default to `followType: false` so only payload refs are traversed.

## Given

- A fresh CAS store with `bootstrap()` applied.
- An object schema `<leafSchema>` registered via `putSchema(store, { type: "object", properties: { val: { type: "number" } } })`.
- A ref schema `<refSchema>` registered via `putSchema(store, { type: "object", properties: { next: { format: "ocas_ref" }, val: { type: "number" } } })`.
- A leaf node `<leafHash>` storing `{ "val": 99 }` under `<leafSchema>`.
- A root node `<rootHash>` storing `{ "next": "<leafHash>", "val": 1 }` under `<refSchema>`.

## When

- The user runs `ocas walk <rootHash>` (no `--follow-type` flag).

## Then

- The command exits with code 0.
- The output envelope contains exactly `[<rootHash>, <leafHash>]` (only payload-ref reachable nodes).
- The schema hashes (`<refSchema>`, `<leafSchema>`, and the meta-schema `@ocas/schema`) are NOT present in the output.

## And -- tree format also omits schemas

Given the same store:

- The user runs `ocas walk <rootHash> --format tree`.
- The tree output lists `<rootHash>` and `<leafHash>` only.
- No schema node appears in the tree.
