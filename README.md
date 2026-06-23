# OCAS

**Object Content Addressable Store** — self-describing CAS with JSON Schema typed nodes.

Every node has a typed payload: its `type` field is the hash of a JSON Schema that describes the payload shape. Hashes are 13-character Crockford Base32 strings derived from XXH64 over deterministic CBOR encoding. Payloads can reference other nodes via `format: "cas_ref"` fields, forming a traversable DAG.

## Install

```bash
pnpm add -g @ocas/cli
```

The store is auto-created and bootstrapped on first use — no `init` command needed.

> Requires Node.js >= 22.5.0 (uses built-in node:sqlite)

## Quick Start

```bash
# Register a schema (schemas are just nodes typed by the meta-schema)
echo '{
  "type": "object",
  "properties": { "title": { "type": "string" }, "done": { "type": "boolean" } },
  "required": ["title", "done"],
  "additionalProperties": false
}' | ocas put @ocas/schema -p
# → { "type": "...", "value": "1ABC2DEF34567" }

# Give it a friendly name
ocas var set @todo/schema 1ABC2DEF34567

# Store a todo item
echo '{ "title": "Buy milk", "done": false }' | ocas put @todo/schema -p
# → { "type": "...", "value": "9XYZ8WVU76543" }

# Retrieve it
ocas get 9XYZ8WVU76543

# Verify integrity + schema validation
ocas verify 9XYZ8WVU76543
```

## Envelope Format

Every command outputs a `{ type, value }` JSON envelope. `type` is the hash of the result schema, `value` is the payload. This makes output self-describing and composable:

```bash
# Pipe any command's output into render
ocas put @ocas/schema schema.json | ocas render -p

# Or use the shorthand -r flag
ocas get 9XYZ8WVU76543 -r

# Extract values with jq
ocas list --type @ocas/schema | jq -r '.value[].hash'
```

`render` is the only command that emits raw text instead of an envelope.

## Commands

### Store & Retrieve

```bash
ocas put <type> <file>          # store a node, returns its hash
ocas put <type> -p              # read payload from stdin
ocas get <hash>                 # retrieve a node
ocas has <hash>                 # check if a node exists
ocas hash <type> <file>         # compute hash without storing
ocas verify <hash>              # integrity check + schema validation
```

### Graph Traversal

```bash
ocas refs <hash>                # list direct cas_ref edges
ocas walk <hash>                # recursive DAG traversal
ocas walk <hash> --format tree  # tree-view output
```

### Listing & Querying

```bash
ocas list --type <hash|name>    # list nodes by type
ocas list-schema                # list all schemas
ocas list-meta                  # list meta-schema hashes
```

All list commands support sorting and pagination:

```bash
ocas list --type todo/schema --sort updated --desc --limit 20
ocas list --type todo/schema --offset 20 --limit 20   # page 2
ocas list-schema --sort created --limit 50
```

### Variables

Variables are mutable pointers to immutable data — like git branches pointing to commits.

Names must follow `@scope/name` format (e.g. `@myapp/config`). The `@ocas/*` scope is reserved.

```bash
ocas var set @myapp/config <hash>         # bind a name to a hash
ocas var get @myapp/config                # look up current binding
ocas var delete @myapp/config             # remove binding
ocas var list [prefix]                    # list variables (prefix filter)
ocas var list @myapp/ --tag env:prod      # filter by scope prefix and tag
ocas var history @myapp/config            # show last 10 values (LRU)
```

**Tags & labels** — attach metadata to variables:

```bash
ocas var set @myapp/config <hash> --tag env:prod --tag pinned
ocas var tag @myapp/config --schema <hash> status:active   # add tag
ocas var tag @myapp/config --schema <hash> :status          # remove tag
```

Any command that takes a hash also accepts a variable name:

```bash
ocas get @myapp/config         # resolves to the bound hash
ocas put @ocas/schema s.json   # @ocas/schema is a builtin variable
```

### Templates & Rendering

Bind a [LiquidJS](https://liquidjs.com/) template to a schema, then render nodes of that type:

```bash
# Set a template — object payload properties are exposed as top-level
# variables, so {{ title }} is equivalent to {{ payload.title }}.
ocas template set <schema-hash> --inline "Todo: {{ title }} [{{ done }}]"

# Render a node (uses the template for its type, falls back to YAML)
ocas render <hash>

# Render from a pipe (any envelope)
ocas gc | ocas render -p

# Inline render shorthand
ocas get <hash> -r
```

Render options for recursive reference expansion:

```bash
ocas render <hash> --resolution 3    # max recursion depth
ocas render <hash> --decay 0.5       # depth decay factor
ocas render <hash> --epsilon 0.01    # cutoff threshold
```

#### HTML Format

Render nodes as self-contained HTML5 documents:

```bash
# Render as HTML (produces a complete <!DOCTYPE html> document)
ocas render <hash> --format html

# HTML templates use a separate namespace from text templates
ocas var set @ocas/template/html/<type-hash> <template-node-hash>
```

HTML template discovery uses the `@ocas/template/html/<type-hash>` namespace.
When no HTML template is registered for a type, the node's payload is rendered
as structured, browsable HTML — objects and arrays become `<ul>` lists, CAS refs
become collapsible `<details>/<summary>` elements, and primitives are inline
`<span>`/`<code>` elements. A builtin HTML document shell wraps the
output in a minimal `<!DOCTYPE html>` page. To customize the document shell,
register a compose template at `@ocas/template-compose/html`.

### Garbage Collection

```bash
ocas gc                # collect unreachable nodes
ocas gc | ocas render -p   # human-readable stats
```

Nodes reachable from any variable binding are kept; everything else is swept.

### Bundles (Export / Import)

Pack the transitive CAS closure of one or more roots into a self-contained tar
archive that can be moved between stores:

```bash
# Export a closure (nodes + schemas + variables + tags reachable from roots)
ocas export @myapp/config -o myapp.tar
ocas export @myapp/config @myapp/users -o myapp.tar     # multiple roots
ocas export 1ABC2DEF34567 -o snapshot.tar               # roots can be hashes

# Import a bundle into the current store (idempotent — content-addressed dedup)
ocas import myapp.tar
ocas import myapp.tar --scope @prod      # remap @myapp/* → @prod/* on import

# Open a bundle as a read-only store without unpacking it
ocas get @myapp/config --store myapp.tar
ocas walk @myapp/config --store myapp.tar
ocas var list --store myapp.tar
```

`--store <bundle.tar>` works with all read-only commands (`get`, `has`, `walk`,
`refs`, `list`, `var list`, `var get`, …). Write commands (`put`, `tag`, `gc`,
`import`, `var set`, …) are rejected with a clear error.

## Global Flags

| Flag | Description |
|------|-------------|
| `--home <path>` | Store directory (default: `$OCAS_HOME` or `~/.ocas`) |
| `--var-db <path>` | Variable database path |
| `--store <bundle.tar>` | Open a bundle file as a read-only store (write commands rejected) |
| `--json` | Compact single-line JSON output |
| `--pipe`, `-p` | Read from stdin |
| `--render`, `-r` | Render output inline |
| `--sort created\|updated` | Sort key for list commands (default: `created`) |
| `--limit <n>` | Max results (default: 100) |
| `--offset <n>` | Skip first N results (default: 0) |
| `--desc` | Sort descending |

## Architecture

```
  ┌───────────┐
  │ @ocas/cli │    CLI interface
  └─────┬─────┘
        │
  ┌───────────┐
  │ @ocas/fs  │    Filesystem store (CBOR + SQLite)
  └─────┬─────┘
        │
  ┌────────────┐
  │ @ocas/core │   Hashing, schemas, validation, bootstrap
  └────────────┘
        │
  ┌───────────────┐
  │ @ocas/cli-kit │ Schema-driven CLI framework core
  └───────────────┘
```

## Using as a Library

```bash
pnpm add @ocas/core              # in-memory store
pnpm add @ocas/core @ocas/fs     # + filesystem persistence
```

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
const node = store.get(hash);
```

For filesystem persistence, use `@ocas/fs`:

```typescript
import { openStore } from "@ocas/fs";

const store = await openStore("/path/to/store");
```

See individual package READMEs for full API docs:
[`@ocas/core`](packages/core/README.md) ·
[`@ocas/fs`](packages/fs/README.md) ·
[`@ocas/cli`](packages/cli/README.md) ·
[`@ocas/cli-kit`](packages/cli-kit/README.md)

## Development

```bash
git clone <repo-url> && cd ocas
pnpm install
pnpm run build     # tsc --build
pnpm test          # run all tests
pnpm run check     # biome lint
pnpm run format    # biome format
```

## License

[MIT](LICENSE)
