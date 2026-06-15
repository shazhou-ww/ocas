# OCAS — Object Content Addressable Store

## Overview

OCAS is a self-describing content-addressable store for typed JSON data. Every node has a `type` field (hash of a JSON Schema) and a `payload`. Hashes are 13-character Crockford Base32 strings (XXH64 over deterministic CBOR).

All commands output `{ type, value }` JSON envelopes, making them composable via pipes.

**Install:** `pnpm add -g @ocas/cli`

**Packages:** `@ocas/core` (engine) · `@ocas/fs` (filesystem store) · `@ocas/cli` (CLI)

## When to Use

- Storing structured, schema-validated JSON data with content addressing
- Building knowledge graphs or DAGs with typed nodes and `ocas_ref` edges
- Agent memory, config versioning, or any use case needing immutable data + mutable pointers
- Don't use for: binary blobs, large files, or high-throughput streaming

## Quick Start

```bash
# Register a schema (from stdin)
echo '{
  "type": "object",
  "properties": { "title": { "type": "string" }, "done": { "type": "boolean" } },
  "required": ["title", "done"],
  "additionalProperties": false
}' | ocas put @ocas/schema -p
# → { "type": "...", "value": "<schema-hash>" }

# Name it
ocas var set @todo/schema <schema-hash>

# Store data
echo '{ "title": "Buy milk", "done": false }' | ocas put @todo/schema -p

# Retrieve + verify
ocas get <hash>
ocas verify <hash>
```

## Core Concepts

### Hashes
13-char uppercase Crockford Base32 (e.g. `9S7JEYS3FKSDH`). Deterministic: same content → same hash.

### Envelope Format
Every command outputs `{ type, value }`. `type` is the hash of the result schema. Pipe any envelope into `render -p` to render it human-readable.

### Variables
Mutable pointers to immutable data (like git branches → commits). All names must follow `@scope/name` format:
- `@myapp/config` ✅
- `@ocas/schema` ✅ (builtin, read-only)
- `config` ❌ (no scope)

### Templates
LiquidJS templates bound to a schema. `render` uses the template for the node's type, falling back to YAML.

## CLI Reference

### Store & Retrieve

```bash
ocas put <type> <file>          # store node → hash
ocas put <type> -p              # read payload from stdin
ocas get <hash>                 # retrieve node
ocas has <hash>                 # check existence
ocas hash <type> <file>         # compute hash without storing
ocas verify <hash>              # integrity + schema validation
```

### Graph Traversal

```bash
ocas refs <hash>                # direct ocas_ref edges
ocas walk <hash>                # recursive DAG traversal
ocas walk <hash> --format tree  # tree view
```

### Listing & Querying

```bash
ocas list --type <hash|name>    # list nodes by type
ocas list-schema                # all schemas
ocas list-meta                  # meta-schema hashes
```

Sorting and pagination:

```bash
ocas list --type @todo/schema --sort updated --desc --limit 20
ocas list --type @todo/schema --offset 20 --limit 20   # page 2
```

### Variables

```bash
ocas var set @myapp/config <hash>              # bind name → hash
ocas var set @myapp/config <hash> --tag env:prod --tag pinned
ocas var get @myapp/config                     # look up
ocas var delete @myapp/config                  # remove
ocas var list [prefix]                         # list (prefix filter)
ocas var list @myapp/ --tag env:prod           # filter by scope + tag
ocas var history @myapp/config                 # last 10 values (LRU)
ocas tag @myapp/config status:active           # add tag/label to a target
ocas untag @myapp/config status                # remove tag/label by key
```

**Naming rules:**
- Format: `@scope/name` — `@[a-zA-Z][a-zA-Z0-9]*/segments`
- `@ocas/*` reserved for builtins
- Any command accepting a hash also accepts a variable name

### Templates & Rendering

#### CLI Commands

```bash
ocas template set <type> --inline "{{ title }} [{{ done }}]"       # text template from string
ocas template set <type> tpl.liquid                                # text template from file
ocas template set <type> tpl.html --format html                    # HTML instance template
ocas template set <type> static.json --format html --static        # HTML static template (CSS/JS)
ocas template get <type> [--format html]                           # read template
ocas template list [--format html]                                 # list templates
ocas template delete <type> [--format html]                        # delete template
ocas render <hash>                     # render with template (or YAML fallback)
ocas render <hash> --format html       # render as self-contained HTML5 document
ocas render --pipe/-p                  # render from piped envelope
ocas get <hash> -r                     # inline render shorthand
```

Render options: `--resolution N` (max depth), `--decay N` (depth decay), `--epsilon N` (cutoff), `--format <text|html>` (output format, default: text).

#### Three Template Namespaces

Templates live in three parallel namespaces, each stored as a variable:

| Namespace | Variable pattern | Purpose |
|-----------|-----------------|---------|
| Instance | `@ocas/template/{format}/{type-hash}` | Per-type LiquidJS template → content fragment |
| Static | `@ocas/template-static/{format}/{type-hash}` | Per-type assets as JSON (`{"css": "...", "js": "..."}`) |
| Compose | `@ocas/template-compose/{format}` | Document shell wrapping content + collected statics |

`{format}` is `text` (default) or `html`. `{type-hash}` is the schema hash of the node type.

#### How Rendering Works (Map-Reduce-Compose)

`ocas render <hash> --format html` runs a 3-phase pipeline:

1. **Map** — DFS-render each node using its instance template; collect all encountered type hashes.
2. **Reduce** — For each encountered type, look up its static template → parse JSON → deduplicate by type (10 person nodes = 1 CSS block).
3. **Compose** — Wrap rendered `content` + collected `type_statics[]` in the compose template. If no compose template is registered, a builtin HTML5 shell is used.

For `text` format, compose is identity (no wrapping) unless a user compose template exists.

#### Writing Instance Templates (LiquidJS)

Instance templates are LiquidJS. Inside them, these variables are available:

| Variable | Description |
|----------|-------------|
| `{{ title }}`, `{{ done }}`, ... | Payload properties auto-spread as top-level vars |
| `{{ payload }}` | The raw payload object |
| `{{ payload.title }}` | Equivalent to `{{ title }}` (explicit access) |
| `{{ hash }}` | The node's CAS hash |
| `{{ type }}` | The node's type hash |
| `{{ timestamp }}` | The node's creation timestamp |
| `{{ resolution }}` | Current resolution level (for conditional detail) |
| `{{ epsilon }}` | Resolution cutoff threshold |

**Reserved keys** (`hash`, `type`, `resolution`, `epsilon`, `payload`, `timestamp`) always win over payload properties of the same name.

**Recursive rendering** — use the custom `{% render %}` tag to expand `cas_ref` fields:

```liquid
<h2>{{ name }}</h2>
<p>Author: {% render author %}</p>
<p>Related: {% render related, decay: 0.3 %}</p>
```

`{% render field_name %}` resolves the field's hash and recursively renders it with the same format. Optional `decay:` overrides the resolution decay for that branch.

#### Writing Static Templates (CSS/JS)

Static templates produce a JSON object with string values. The keys `css` and `js` are convention consumed by the builtin HTML shell:

```json
{"css": ".person { font-family: sans-serif; padding: 1rem; }", "js": ""}
```

Set via: `ocas template set <type-hash> static.json --format html --static`

These are **deduplicated by type** — if 10 nodes of the same type appear, the CSS/JS is injected only once.

#### Writing Compose Templates

Compose templates wrap the entire rendered output. Variables available:

| Variable | Description |
|----------|-------------|
| `{{ content }}` | All rendered node content from the map phase |
| `type_statics` | Array of `{ type_hash, css, js, ... }` from the reduce phase |

Example custom compose template:

```liquid
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  {% for ts in type_statics %}{% if ts.css %}<style>{{ ts.css }}</style>{% endif %}{% endfor %}
</head>
<body>
  {{ content }}
  {% for ts in type_statics %}{% if ts.js %}<script>{{ ts.js }}</script>{% endif %}{% endfor %}
</body>
</html>
```

Set via: `ocas var set @ocas/template-compose/html <hash>` (store the template string as a `@ocas/string` node first).

If no compose template is registered:
- **HTML format** → builtin HTML5 document shell (CSS in `<head>`, JS before `</body>`)
- **Text format** → identity (content returned as-is)

#### Fallback Behavior

| Condition | Result |
|-----------|--------|
| No instance template for type | YAML text rendering |
| HTML format + no instance template | YAML wrapped in `<pre><code>` |
| No compose template (HTML) | Builtin HTML5 document shell |
| No compose template (text) | Identity (no wrapping) |

### Garbage Collection

```bash
ocas gc                    # collect unreachable nodes
ocas gc | ocas render -p   # human-readable stats
```

### Bundles (Export / Import)

```bash
ocas export <root>... -o <bundle.tar>           # write closure of roots to tar
ocas export @myapp/config -o myapp.tar
ocas export @myapp/config @myapp/users -o m.tar # multiple roots
ocas import <bundle.tar>                        # import bundle (idempotent)
ocas import <bundle.tar> --scope @prod          # remap @<scope>/* → @prod/*
ocas get <hash> --store <bundle.tar>            # read-only access into bundle
```

`export` walks refs **and** schema chains; the resulting tar contains every reachable
CAS node (`cas/<hash>.bin`, CBOR), every variable whose value is in-closure, and every
tag attached to an in-closure target. `import` is content-addressed (deduplicates
existing nodes). `--scope @new` rewrites the leading `@scope` of imported variable
names except `@ocas/*` builtins. `--store <bundle.tar>` opens a bundle as a read-only
store for any inspection command; write commands (`put`, `tag`, `gc`, `import`,
`var set`, …) refuse with `--store is read-only`.

### Global Flags

| Flag | Description |
|------|-------------|
| `--home <path>` | Store directory (default: `$OCAS_HOME` or `~/.ocas`) |
| `--store <bundle.tar>` | Open a bundle as a read-only store (write commands rejected) |
| `--json` | Compact JSON output |
| `-p`, `--pipe` | Read from stdin |
| `-r`, `--render` | Render output inline |
| `--sort created\|updated` | Sort key (default: `created`) |
| `--limit <n>` | Max results (default: 100) |
| `--offset <n>` | Skip first N (default: 0) |
| `--desc` | Sort descending |
| `-o <path>` | Output path (used by `export`) |
| `--scope @new` | Variable scope remap (used by `import`) |

## Pipe Composition Patterns

```bash
# Store + render in one go
echo '{"title":"test","done":false}' | ocas put @todo/schema -p | ocas render -p

# Or use -r shorthand
ocas get <hash> -r

# List schemas, extract hashes with jq
ocas list --type @ocas/schema | jq -r '.value[].hash'

# Render GC stats
ocas gc | ocas render -p
```

## Library Usage

```typescript
import { bootstrap, createMemoryStore, putSchema } from "@ocas/core";

const store = createMemoryStore();
await bootstrap(store);

const typeHash = await putSchema(store, {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
  additionalProperties: false,
});

const hash = await store.put(typeHash, { message: "hello" });
```

For filesystem persistence:

```typescript
import { openStore } from "@ocas/fs";
const store = await openStore("/path/to/store");
// store.cas / store.var / store.tag
```

## Common Pitfalls

1. **Variable names without `@scope/`** — all names must be `@scope/name` format. `config` alone will be rejected.
2. **Writing to `@ocas/*` namespace** — reserved for builtins, CLI will reject.
3. **Forgetting `-p` for stdin** — `ocas put <type>` expects a file path; use `-p` to read from stdin.
4. **Expecting `list` to return hashes** — `list` commands return `ListEntry[]` with `{ hash, created, updated }`, not bare hashes.
5. **`workspace:*` in published packages** — only on `main` branch; release branches must have fixed versions.
