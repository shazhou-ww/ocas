---
id: meta-schema-validation
title: "Meta-Schema Validation: Allowlist vs AJV"
sources:
  - packages/core/src/schema.ts
  - packages/core/src/validation.ts
tags: [core, schema, validation]
created: 2026-06-15
updated: 2026-06-15
---

# Meta-Schema Validation

## Two Validation Paths

- **Regular nodes** — validated with AJV against their schema (standard JSON Schema validation)
- **Schema nodes** — validated with a custom recursive `isValidSchema()` using a structural allowlist

## Why Not AJV for Schemas?

AJV cannot express the recursive constraints needed for nested JSON Schema objects. A JSON Schema that validates JSON Schemas would need to express "any value under `properties` must itself be a valid JSON Schema" — which is infinitely recursive.

## The Allowlist Approach

`ALLOWED_SCHEMA_KEYS` defines what keys are permitted at each level. `isValidSchema()` recursively walks the schema structure, checking:
- Only allowed keys are present
- Values are the correct type
- Nested schema objects (in `properties`, `items`, `anyOf`, etc.) are themselves valid

This is simpler and more maintainable than trying to write a meta-meta-schema.
