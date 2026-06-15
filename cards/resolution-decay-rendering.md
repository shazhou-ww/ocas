---
id: resolution-decay-rendering
title: "Resolution-Decay Model for Progressive Node Rendering"
sources:
  - packages/core/src/render.ts
  - packages/core/src/liquid-render.ts
tags: [core, rendering]
created: 2026-06-15
updated: 2026-06-15
---

# Resolution-Decay Rendering

## The Problem

CAS nodes reference other CAS nodes. Naively expanding all references produces infinite (or very deep) output.

## Resolution-Decay Model

Each render call has a `resolution` parameter (0.0–1.0) and a `decay` factor:
- At each level of nesting, resolution is multiplied by decay
- Below an `epsilon` threshold, nodes collapse to opaque `cas:<hash>` references

This gives users control over detail depth:
- `resolution=1.0, decay=0.5` — full detail at top, half at level 1, quarter at level 2...
- `resolution=0.1` — almost everything collapsed

## Template System

Templates are stored as regular CAS string nodes bound to variables named `@ocas/template/text/<schema-hash>`. No special template storage — the naming convention IS the lookup mechanism.

Rendering uses LiquidJS with a custom `{% render %}` tag for recursive expansion of nested CAS references.
