---
title: Render System
aliases: [Envelope, Template, 渲染系统]
tags: [concept, api]
related: [Schema, CLI]
---

# Render System

The render system turns typed data into human-readable output. It has three layers: the envelope format for machine consumption, templates for human formatting, and resolution decay for hierarchical rendering.

## Envelope

Every [[CLI]] command outputs a `{ type, value }` JSON envelope:

```json
{ "type": "B4K9...", "value": "A0QKG4ERMXSFG" }
```

- `type` is the hash of an `@ocas/output/*` [[Schema]] describing the value's shape
- `value` is the command's result — a hash, a node, a boolean, an array, etc.

This uniform shape means any command's output can be piped into another:

```bash
ocas put @ocas/object data.json | ocas render -p
ocas gc | ocas render -p
ocas list --type @ocas/schema | ocas render -p
```

`wrapEnvelope(store, name, value)` creates an envelope by resolving the variable name to its schema hash.

## Templates

Templates control how a schema's data renders as text. They use LiquidJS syntax with the node's payload available under `payload`:

```liquid
Name: {{ payload.name }}, Age: {{ payload.age }}
```

Templates are managed as [[Variable]] bindings in the `@ocas/template/text/<schema-hash>` namespace, with the template content stored as a CAS node typed `@ocas/string`.

```bash
ocas template set <schema-hash> template.liquid
ocas template get <schema-hash>
ocas template list
ocas template delete <schema-hash>
```

[[Bootstrap]] registers default templates for all `@ocas/output/*` schemas, so CLI output is always renderable out of the box.

## Resolution Decay

When rendering nodes that reference other nodes (via [[Schema|ocas_ref]]), the render system uses **resolution decay** to control recursion depth:

- `--resolution <n>` — initial detail level (default: 1.0)
- `--decay <n>` — multiplier per level (default: 0.5)
- `--epsilon <n>` — cutoff threshold (default: 0.01)

At each level, `resolution *= decay`. When resolution drops below epsilon, referenced nodes render as raw `ocas:<hash>` strings instead of being expanded. This prevents infinite expansion while giving progressively less detail at deeper levels.

## Render Modes

- **`ocas render <hash>`** — render a stored node by hash, expanding ocas_ref references
- **`ocas render -p`** — read a `{ type, value }` envelope from stdin and render it
- **`ocas <any-command> -r`** — inline render shortcut; any command with `-r` / `--render` automatically pipes its envelope output through the renderer, equivalent to `| ocas render -p`
- **`renderDirect(type, value, store, options)`** — in-memory render without requiring the data to be stored (used internally for CLI output)
