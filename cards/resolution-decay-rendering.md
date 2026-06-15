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

## Two Render Paths

- **`render()` (synchronous)** — pure YAML rendering with resolution decay. No template support.
- **`renderAsync()`** — LiquidJS template rendering with a map-reduce-compose pipeline. Falls back to YAML when no template exists for a type.

Both paths apply the same resolution-decay math. The difference is whether templates are involved.

## How Decay Flows Through Templates

The `{% render %}` tag in LiquidJS templates drives recursive CAS ref expansion with decay:

```liquid
{% render ref_field %}              {# uses global decay #}
{% render ref_field, decay: 0.7 %}  {# overrides decay for this edge #}
```

Decay priority: explicit tag decay > global decay from options > engine default (0.5). The tag computes `childResolution = currentResolution * effectiveDecay` and recurses into `renderNode()`.

The `resolution` and `epsilon` values are injected into the LiquidJS context as reserved keys, enabling templates to conditionally render based on remaining resolution budget.

## Template Discovery

Instance templates (the per-type content templates that participate in resolution-decay rendering) are discovered via `@ocas/template/{format}/{type-hash}` variables. No special template storage — the naming convention IS the lookup mechanism.

Static and compose templates live in separate namespaces (`@ocas/template-static/`, `@ocas/template-compose/`) and participate in the reduce and compose phases of `renderAsync()`, but are not subject to resolution decay. See [template-namespace-system](template-namespace-system.md) for the full three-namespace architecture.
