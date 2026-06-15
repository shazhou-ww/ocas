---
id: output-envelope-pattern
title: "CLI Output Envelope Pattern via @ocas/output/* Schemas"
sources:
  - packages/core/src/wrap-envelope.ts
  - packages/core/src/bootstrap.ts
  - packages/core/src/output-templates.ts
tags: [cli, output]
created: 2026-06-15
updated: 2026-06-15
---

# Output Envelope Pattern

## Design

Every CLI command wraps its result through `wrapEnvelope()` into a typed `@ocas/output/*` envelope (e.g. `@ocas/output/put`, `@ocas/output/gc`).

This makes all CLI output:
1. **Typed** — each command has its own output schema
2. **Renderable** — the `--render` flag produces human-friendly output via the template system
3. **Stored** — output envelopes are themselves CAS nodes, enabling audit trails

## How It Works

1. Command produces a result object
2. `wrapEnvelope(store, schemaName, payload)` validates against the schema and stores as a CAS node
3. If `--render` is passed, the node is rendered through the template system
4. Otherwise, the hash is printed (machine output)

## Builtin Output Schemas

Registered during bootstrap: `@ocas/output/put`, `@ocas/output/get`, `@ocas/output/gc`, `@ocas/output/refs`, `@ocas/output/walk`, etc.
