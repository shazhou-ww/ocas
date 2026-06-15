---
id: schema-ref-traversal
title: "Schema-Driven Reference Extraction and Graph Walk"
sources:
  - packages/core/src/schema.ts
tags: [core, schema, graph]
created: 2026-06-15
updated: 2026-06-15
---

# Schema-Driven Reference Extraction and Graph Walk

## ocas_ref Format Marker

The `format: "ocas_ref"` marker in JSON Schema properties is the sole mechanism for discovering CAS references in payloads. When a schema property has this format, its string value is treated as a hash pointing to another CAS node.

This avoids hardcoding knowledge of individual schemas — any schema can declare references, and the system discovers them automatically.

## collectRefs / refs

`collectRefs(schema)` performs recursive descent through all JSON Schema combinators (`anyOf`, `allOf`, `oneOf`, `if/then/else`, `patternProperties`, `additionalProperties`, etc.) to find all `ocas_ref` properties. Returns an array of JSON paths to ref fields.

`refs(node, schema)` extracts actual hash values from a node's payload using the paths from `collectRefs`.

## BFS Walk with Dual-Edge Traversal

`walk()` follows TWO kinds of edges:
1. **Payload refs** — `ocas_ref` format fields in the node's data
2. **Type chain** — each node's `type` hash (its schema node)

This means walking from any node automatically traverses the entire schema chain. The visited-set naturally terminates cycles (including the meta-schema's self-reference).
