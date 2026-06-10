# Specs

Behavior specifications for ocas CLI commands, in Given/When/Then format.

## Convention

Each spec is a **snapshot of current implementation behavior**. When the implementation changes, the corresponding spec must be updated to match.

Specs are not aspirational — they describe what the code **does**, not what it should do.

## Frontmatter Schema

Every spec file has YAML frontmatter with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `scenario` | string | One-line description of the behavior |
| `feature` | string | Which ocas command (`put`, `get`, `has`, `verify`, `walk`, `render`, `list`, `var`, `tag`, `template`, `gc`, `export`, `import`, `hash`, `refs`) |
| `tags` | string[] | Categorization tags (e.g. `schema`, `template`, `error-handling`) |

## File Naming

`<feature>-<behavior>.md` — e.g. `render-template-substitution.md`, `has-invalid-input.md`
