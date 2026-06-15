---
id: template-namespace-system
title: "Three-Namespace Template System and Map-Reduce-Compose Pipeline"
sources:
  - packages/core/src/render.ts
  - packages/core/src/liquid-render.ts
  - packages/cli/src/index.ts
tags: [core, rendering, templates]
created: 2026-06-15
updated: 2026-06-15
---

# Template Namespace System

## Three Independent Flat Namespaces

Templates are organized into three parallel namespaces, each stored as ordinary CAS string nodes bound to `@ocas/` variables. The namespaces are independent — no nesting or hierarchy between them.

| Namespace | Variable pattern | Purpose |
|-----------|-----------------|---------|
| Instance | `@ocas/template/{format}/{type-hash}` | Per-type LiquidJS template that renders a content fragment for one node |
| Static | `@ocas/template-static/{format}/{type-hash}` | Per-type assets (CSS/JS) stored as JSON `{"css": "...", "js": "..."}` |
| Compose | `@ocas/template-compose/{format}` | Document shell that wraps all rendered content and collected statics |

Key design choices:

- **Flat, not nested** — static and compose templates live in their own `@ocas/template-static/` and `@ocas/template-compose/` prefixes, not under `@ocas/template/`. This makes `var.list()` prefix queries clean (no false matches between namespaces).
- **Format-parameterized** — the `{format}` segment (e.g. `text`, `html`) partitions each namespace so the same type can have different templates per output format.
- **No special storage** — templates are just CAS string nodes. The naming convention IS the lookup mechanism.

## Map-Reduce-Compose Pipeline

`renderAsync()` in `render.ts` implements a three-phase pipeline:

### Phase 1: Map (DFS rendering + type collection)

Renders the root node via its instance template (or YAML fallback). The LiquidJS `{% render ref_field %}` tag recursively expands nested CAS references with resolution decay. Each rendered node's type hash is collected into an `encounteredTypes` set.

Template discovery uses `@ocas/template/{format}/{type-hash}` — queried via `store.var.get()` against the `@ocas/string` schema.

### Phase 2: Reduce (collect type statics, deduplicate)

For each unique type hash in `encounteredTypes`, the engine looks up `@ocas/template-static/{format}/{type-hash}`. If found, the static template is rendered through LiquidJS (typically a no-op since statics are plain JSON), parsed as JSON, and added to a `Record<Hash, TypeStatics>` map.

Deduplication is automatic: 10 person nodes with the same schema produce only 1 CSS/JS block because the reduce iterates over unique type hashes.

### Phase 3: Compose (document shell)

The engine looks up `@ocas/template-compose/{format}`. If a custom compose template exists, it is rendered with `{{ content }}` (the map output) and `{{ type_statics }}` (array of `{ type_hash, css, js, ... }` entries).

Fallback behavior when no compose template is registered:

| Format | Behavior |
|--------|----------|
| `html` | Builtin HTML5 shell — injects CSS as `<style>` in `<head>`, JS as `<script>` at end of `<body>` |
| `text` | Identity — returns content as-is |

## Instance Template Context

Inside instance templates, LiquidJS provides:

- **Auto-spread payload** — object payload properties are top-level: `{{ title }}` = `{{ payload.title }}`
- **Reserved keys** (always override payload): `hash`, `type`, `resolution`, `epsilon`, `payload`, `timestamp`
- **Custom `{% render %}` tag** — `{% render ref_field %}` or `{% render ref_field, decay: 0.7 %}` for recursive CAS ref expansion

## CLI Interface

```bash
ocas template set <type> <file> [--format html]           # set instance template
ocas template set <type> <file> --format html --static    # set static template
ocas template get <type> [--format html]                  # read instance template
ocas template list [--format html]                        # list instance + static templates
ocas template delete <type> [--format html]               # delete instance template
ocas render <hash> [--format html]                        # render with templates
```

The `template list` command queries both `@ocas/template/{format}/` and `@ocas/template-static/{format}/` prefixes, displaying static entries with a `/static` suffix on the schema hash. Compose templates are set via `var set` directly.

## Static Template Format

Static templates must produce valid JSON with string values:

```json
{"css": ".person { color: blue; }", "js": "console.log('init')"}
```

Any keys are allowed. `css` and `js` are the convention consumed by the builtin HTML shell's `applyBuiltinHtmlShell()`.
