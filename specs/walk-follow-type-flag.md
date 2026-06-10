---
scenario: "ocas walk --follow-type includes the full schema chain in traversal output"
feature: walk
tags: [walk, follow-type, cli, issue-135]
---

## Background

Issue #135: When the user passes `--follow-type`, the CLI should traverse
`node.type` edges (the schema chain) in addition to payload refs. This
replicates the pre-change behavior and is what GC/export need internally.

## Given

- A fresh CAS store with `bootstrap()` applied.
- An object schema `<leafSchema>` registered via `putSchema(store, { type: "object", properties: { val: { type: "number" } } })`.
- A ref schema `<refSchema>` registered via `putSchema(store, { type: "object", properties: { next: { format: "ocas_ref" }, val: { type: "number" } } })`.
- A leaf node `<leafHash>` storing `{ "val": 99 }` under `<leafSchema>`.
- A root node `<rootHash>` storing `{ "next": "<leafHash>", "val": 1 }` under `<refSchema>`.
- The meta-schema hash `<metaHash>` (the `@ocas/schema` builtin).

## When

- The user runs `ocas walk <rootHash> --follow-type`.

## Then

- The command exits with code 0.
- The output envelope contains `<rootHash>`, `<leafHash>`, `<refSchema>`, `<leafSchema>`, and `<metaHash>` (all reachable nodes including the schema chain).
- This matches the current (pre-change) behavior of `ocas walk`.

## And -- tree format with --follow-type

Given the same store:

- The user runs `ocas walk <rootHash> --format tree --follow-type`.
- The tree output includes both data nodes and schema nodes.
