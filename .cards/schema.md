---
title: Schema
aliases: [JSON Schema, Type System, 类型系统]
tags: [concept, api]
related: [Content Addressing, Bootstrap, Store]
---

# Schema

Every node in OCAS has a type. Schemas define what shapes of data are valid, and they are themselves stored as nodes in the CAS — making the type system self-describing.

## JSON Schema Subset

OCAS schemas use a subset of JSON Schema. Supported keywords:

| Category | Keywords |
|----------|----------|
| Core | `type`, `properties`, `required`, `additionalProperties`, `items` |
| Combinators | `anyOf`, `oneOf`, `allOf`, `not` |
| Conditionals | `if`, `then`, `else` |
| String | `minLength`, `maxLength`, `pattern`, `format`, `enum`, `const` |
| Number | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` |
| Array | `minItems`, `maxItems`, `uniqueItems`, `prefixItems`, `contains` |
| Object | `patternProperties`, `propertyNames`, `minProperties`, `maxProperties` |
| Metadata | `title`, `description`, `default`, `examples`, `deprecated`, `readOnly`, `writeOnly`, `$comment` |

Schemas are validated recursively by `isValidSchema()` before being stored, and payloads are validated against their schema by ajv on every `put()`.

## References — `ocas_ref`

Nodes can reference other nodes. A property with `format: "ocas_ref"` declares that its string value is a [[Content Addressing|Hash]] pointing to another node:

```json
{
  "type": "object",
  "properties": {
    "author": { "type": "string", "format": "ocas_ref" }
  }
}
```

When the store sees `ocas_ref`, it knows this field is a graph edge — not just a string. This enables:

- **`refs(node)`** — extract direct references from a node
- **`walk(hash, callback)`** — recursively traverse the DAG
- **[[Garbage Collection]]** — mark reachable nodes from roots

### collectRefs

`collectRefs(schema, value)` recursively walks the schema to find all `ocas_ref` values in a payload. It handles all schema structures: `properties`, `items`, `additionalProperties`, `anyOf`/`oneOf`/`allOf`, `if`/`then`/`else`, `prefixItems`, `patternProperties`, `contains`, and `not`.

## Namespace

Variable names starting with `@ocas/` are reserved for the system. Built-in names:

- `@ocas/schema` — the meta-schema (self-referencing)
- `@ocas/string`, `@ocas/number`, `@ocas/object`, `@ocas/array`, `@ocas/bool` — primitive types
- `@ocas/output/*` — [[Render System|envelope]] schemas for CLI output

These names are written to the [[Variable]] store during [[Bootstrap]] and resolve to their hashes via the same lookup that handles user-defined variables. Users define their own schemas freely — the only restriction is the `@ocas/` prefix.
