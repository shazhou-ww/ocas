# @ocas/cli-kit

Schema-driven CLI framework with structured output, dual-channel I/O, and Zod-validated data flow.

Extracted from the [OCAS](https://github.com/shazhou-ww/ocas) CLI tooling, `@ocas/cli-kit` lets you build CLIs where every command declares what it **yields** (progress/streaming) and what it **returns** (final result), with runtime schema validation and multi-format output out of the box.

## Install

```bash
pnpm add @ocas/cli-kit zod
```

> **Node.js ≥ 24** required. ESM only (`"type": "module"` in your `package.json`).

## Quick Start

```ts
#!/usr/bin/env node
import { createCLI } from "@ocas/cli-kit";
import { z } from "zod";

const cli = createCLI({ name: "mycli", version: "1.0.0" });

cli
  .command("greet")
  .arg("name")
  .flag("loud", { type: "boolean", default: false })
  .returns(
    z.object({ greeting: z.string() }),
    "{{greeting}}",
  )
  .action(async (args, flags) => {
    const msg = flags.loud
      ? `HELLO ${args.name.toUpperCase()}!`
      : `Hello ${args.name}`;
    return { greeting: msg };
  });

cli.run().then((code) => process.exit(code));
```

```console
$ mycli greet World
type: "@mycli/greet"
value:
  greeting: "Hello World"

$ mycli greet World --loud --format json
{"type":"@mycli/greet","value":{"greeting":"HELLO WORLD!"}}
```

## Core Concepts

### Dual-Channel Output

Every command has **two output channels**:

| Channel | Stream | Purpose |
|---------|--------|---------|
| **Yields** | `stderr` | Streaming progress items (NDJSON envelopes) |
| **Return** | `stdout` | Final result (envelope or rendered text) |

This separation means you can pipe `stdout` to another tool while still seeing progress on `stderr`:

```console
$ mycli search "query" | jq .    # stderr progress visible, stdout is JSON
```

### Yield + Return Pattern

Use an **async generator** to yield intermediate values and return a final result:

```ts
cli
  .command("search")
  .arg("query")
  .yields(
    z.object({ card: z.string(), score: z.number() }),
    "{{card}}: {{score}}",
  )
  .returns(
    z.object({ query: z.string(), count: z.number() }),
    "Found {{count}} results for {{query}}",
  )
  .action(async function* (args) {
    const results = await fetchResults(args.query);
    for (const r of results) {
      yield { card: r.card, score: r.score }; // → stderr
    }
    return { query: args.query, count: results.length }; // → stdout
  });
```

Each `yield` value is validated against the yields schema and emitted to `stderr` as an NDJSON envelope:

```json
{"type":"@mycli/search/yield","value":{"card":"alpha","score":0.9}}
```

The `return` value is validated against the returns schema and written to `stdout`.

> **Tip:** If your action returns `undefined`, cli-kit skips the final envelope — use this when your action handles its own output (e.g. writing rendered content directly to stdout).

### Schema Validation

Both `.yields()` and `.returns()` accept a [Zod](https://zod.dev) schema. Every value flows through `schema.parse()` before output, ensuring your CLI only emits well-formed data:

```ts
.returns(
  z.object({
    hash: z.string().length(13),
    size: z.number().int().nonnegative(),
  }),
  "{{hash}} ({{size}} bytes)",
)
```

If validation fails, the error is caught and emitted as a structured error envelope (see [Error Handling](#error-handling)).

### Output Envelopes

All JSON/YAML output uses a `{ type, value }` envelope:

```json
{
  "type": "@mycli/search",
  "value": { "query": "needle", "count": 3 }
}
```

- **`type`** — a schema identifier string (see [Schema Naming](#schema-naming))
- **`value`** — the Zod-validated payload

### Schema Naming

Schema type names are auto-generated from your CLI name and command path:

| CLI name | Command path | Auto-generated type |
|----------|-------------|-------------------|
| `mycli` | `search` | `@mycli/search` |
| `mycli` | `var set` | `@mycli/var/set` |
| `mycli` | `search` (yield) | `@mycli/search/yield` |

Override with the `name` option:

```ts
.returns(schema, template, { name: "@custom/result" })
.yields(schema, template, { name: "@custom/progress" })
```

### Output Formats

Four formats are available via `--format`:

| Flag | Behavior |
|------|----------|
| `--format yaml` | YAML envelope (default) |
| `--format json` | Pretty-printed JSON envelope |
| `--format text` | Rendered via template string |
| `--format html` | Rendered via template string |

The `--compact` flag produces minified JSON (no whitespace).  
The `--json` flag is shorthand for `--format json --compact`.  
The `--quiet` flag suppresses all yield output on `stderr`.

## Command Builder API

### `createCLI(options)`

Create a new CLI instance.

```ts
import { createCLI } from "@ocas/cli-kit";

const cli = createCLI({
  name: "mycli",       // CLI name, used in schema naming and log paths
  version: "1.0.0",    // CLI version
  homeDir: "~/.mycli", // Optional: base dir for log files (default: os.homedir())
  plugins: [],         // Optional: CliPlugin[] (see Plugins)
});
```

Returns a `CommandBuilder` augmented with `run()` and `help()`.

### `CommandBuilder`

Fluent interface for defining commands. All methods return `this` for chaining.

#### `.command(name)` — Register a subcommand

```ts
cli.command("var").command("set")  // defines `mycli var set`
```

Commands can be nested arbitrarily deep. A command with children is a **group** and cannot be executed directly.

#### `.arg(name)` — Declare a positional argument

```ts
cli.command("get").arg("hash")     // mycli get <hash>
cli.command("mv").arg("src").arg("dst")  // mycli mv <src> <dst>
```

Arguments are positional and required. Extra positional args are accessible via `flags._positionals`.

#### `.flag(name, definition)` — Declare a flag

```ts
cli.command("search")
  .flag("limit", { type: "number", default: 10 })
  .flag("verbose", { type: "boolean", default: false })
  .flag("output", { type: "string" })
```

**Flag types:** `"string"` | `"number"` | `"boolean"`

**Built-in flags** (always available):

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | string | `"yaml"` | Output format: `yaml`, `json`, `text`, `html` |
| `--compact` | boolean | `false` | Minified JSON output |
| `--json` | boolean | `false` | Shorthand for `--format json --compact` |
| `--quiet` | boolean | `false` | Suppress yield output on stderr |

#### `.yields(schema, template, options?)` — Declare yield schema

```ts
.yields(
  z.object({ step: z.string() }),
  "step: {{step}}",
  { name: "@mycli/custom/yield" },  // optional override
)
```

Required when your action uses `yield`. If the action yields but no `.yields()` was declared, the command fails at runtime.

#### `.returns(schema, template, options?)` — Declare return schema

```ts
.returns(
  z.object({ ok: z.boolean() }),
  "ok: {{ok}}",
  { name: "@mycli/custom/result" },  // optional override
)
```

**Required** for every executable (leaf) command. Without `.returns()`, the command fails with `"Executable command requires .returns(...)"`.

#### `.action(fn)` — Define command logic

```ts
.action(async (args, flags, ctx) => {
  // args: Record<string, string>  — positional arguments
  // flags: ParsedFlags            — parsed flags + _positionals
  // ctx:   CliContext             — error(), log, command name
  return { ok: true };
})
```

The action can be:
- **`async function`** — returns a value (written to stdout)
- **`async function*`** — yields values (stderr) and returns a value (stdout)

### `cli.run(options?)`

Execute the CLI. Returns a `Promise<number>` (exit code, `0` = success, `1` = error).

```ts
// Use process.argv (default)
const code = await cli.run();

// Custom argv and I/O (useful for testing)
const code = await cli.run({
  argv: ["search", "needle", "--format", "json"],
  stdout: { write: (s) => captured += s },
  stderr: { write: (s) => captured += s },
});
```

### `cli.help()`

Returns a usage string listing standard flags and render flag availability.

## CliContext

Every action receives a `CliContext` as its third parameter:

```ts
interface CliContext {
  command: string;                              // e.g. "var set"
  error: (message: string, code?: string) => never;  // throw a structured error
  log: {
    debug: (tag: string, msg: string) => void;
    info:  (tag: string, msg: string) => void;
    warn:  (tag: string, msg: string) => void;
  };
}
```

### `ctx.error(message, code?)`

Throws a structured error that becomes an `@<cli>/error` envelope on stderr:

```ts
.action(async (_args, _flags, ctx) => {
  const node = await fetchNode();
  if (!node) return ctx.error("Node not found", "E_NOT_FOUND");
  return node;
})
```

Produces on stderr:

```json
{"type":"@mycli/error","value":{"message":"Node not found","code":"E_NOT_FOUND","command":"get"}}
```

The process exits with code `1`.

### `ctx.log`

Structured JSONL logging to `~/.<cliName>/logs/<YYYY-MM-DD>.jsonl`:

```ts
.action(async (_args, _flags, ctx) => {
  ctx.log.info("ABCDEFGH", "starting operation");
  // ...
  return result;
})
```

**Log tags** must be exactly 8 uppercase Crockford Base32 characters (`[0-9A-HJKMNP-TV-Z]`). Use `assertValidLogTag(tag)` to validate at import time.

Each log record:

```json
{"ts":"2026-06-25T10:30:00.000Z","pid":12345,"level":"info","tag":"ABCDEFGH","msg":"starting operation"}
```

## Templates

The `template` string in `.yields()` and `.returns()` uses simple mustache-style interpolation:

```
"{{property}}"         → top-level property
"{{nested.deep.path}}" → dot-path lookup
```

Used when `--format text` or `--format html` is selected:

```console
$ mycli greet World --format text
Hello World
```

For `--format yaml` and `--format json`, the template is ignored and the full `{ type, value }` envelope is emitted.

## Plugins

Plugins extend cli-kit with optional features.

### `ocasRenderPlugin(openStore)`

Enables the `-r / --render` flag for inline content rendering:

```ts
import { createCLI, ocasRenderPlugin } from "@ocas/cli-kit";

const cli = createCLI({
  name: "ocas",
  version: "1.0.0",
  plugins: [ocasRenderPlugin(() => myStore)],
});
```

When the plugin is registered:
- `-r` / `--render` becomes a valid flag
- Your action can check `flags.render === true` to decide whether to produce rendered output
- Without the plugin, passing `--render` produces an `"Unknown option"` error

### Custom Plugins

```ts
interface CliPlugin {
  name: string;
  enableRenderFlag?: boolean;  // adds -r/--render to the parser
  openStore?: () => unknown;   // your store accessor
}
```

## Error Handling

cli-kit wraps all errors into structured envelopes:

| Scenario | Error envelope `value` |
|----------|----------------------|
| `ctx.error(msg, code)` | `{ message, code, command }` |
| `throw new Error(msg)` | `{ message, command }` |
| Unknown command | `{ message: "Unknown command: ...", code: "E_USAGE", command }` |
| Missing `.returns()` | `{ message: "Executable command requires .returns(...)", ... }` |

All errors:
- Write to **stderr** as NDJSON: `{"type":"@<cli>/error","value":{...}}`
- Return exit code **1**
- Never crash the process with an unhandled exception

## Testing

cli-kit is designed for easy testing with mock I/O:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createCLI } from "@ocas/cli-kit";

function createBuffers() {
  let stdout = "";
  let stderr = "";
  return {
    out: {
      stdout: { write: (text: string) => (stdout += text) },
      stderr: { write: (text: string) => (stderr += text) },
    },
    read: () => ({ stdout, stderr }),
  };
}

test("greet command returns correct output", async () => {
  const cli = createCLI({ name: "mycli", version: "1.0.0" });
  cli
    .command("greet")
    .arg("name")
    .returns(z.object({ greeting: z.string() }), "{{greeting}}")
    .action(async (args) => ({ greeting: `Hello ${args.name}` }));

  const io = createBuffers();
  const code = await cli.run({ argv: ["greet", "World", "--format", "json"], ...io.out });

  expect(code).toBe(0);
  expect(JSON.parse(io.read().stdout)).toEqual({
    type: "@mycli/greet",
    value: { greeting: "Hello World" },
  });
});
```

## Subcommands

Build command hierarchies by chaining `.command()`:

```ts
cli
  .command("var")
  .command("set")
  .arg("name")
  .arg("value")
  .returns(z.object({ ok: z.boolean() }), "ok")
  .action(async (args) => {
    // args.name, args.value
    return { ok: true };
  });

cli
  .command("var")
  .command("get")
  .arg("name")
  .returns(z.object({ value: z.string() }), "{{value}}")
  .action(async (args) => {
    return { value: await lookup(args.name) };
  });
```

Running `mycli var` (without a subcommand) returns an error: `"Command is not executable"`.

## Advanced Patterns

### Self-Handled Output

Return `undefined` from your action to skip cli-kit's envelope wrapping:

```ts
.action(async (_args, flags, ctx) => {
  const rendered = await myRenderer();
  process.stdout.write(`${rendered}\n`);
  return undefined; // cli-kit won't wrap anything
})
```

### Multi-Value Flags (Tags)

The built-in `tag` flag supports repeat values — passing `--tag a --tag b` produces `flags.tag = ["a", "b"]`:

```ts
cli.command("list")
  .flag("tag", { type: "string" })
  .returns(z.unknown(), "{{value}}")
  .action(async (_args, flags) => {
    const tags = Array.isArray(flags.tag) ? flags.tag : flags.tag ? [flags.tag] : [];
    // ...
  });
```

### Extra Positional Arguments

Access all positional args (including those beyond declared `.arg()` count) via `flags._positionals`:

```ts
cli.command("tag")
  .arg("target")
  .returns(z.unknown(), "{{value}}")
  .action(async (args, flags) => {
    const target = args.target;
    const extraTags = (flags._positionals as string[]).slice(1);
    // ...
  });
```

## API Reference

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `createCLI` | function | Create a new CLI instance |
| `assertValidLogTag` | function | Validate a log tag (8-char Crockford Base32) |
| `ocasRenderPlugin` | function | Create a render plugin |
| `CliContext` | type | Context passed to action functions |
| `CliPlugin` | type | Plugin interface |
| `CommandAction` | type | Action function signature |
| `CommandBuilder` | type | Fluent builder interface |
| `CreateCliOptions` | type | Options for `createCLI` |
| `ParsedFlags` | type | Parsed flags object |
| `RunOptions` | type | Options for `cli.run()` |

### FlagDefinition

```ts
interface FlagDefinition {
  type: "string" | "number" | "boolean";
  default?: string | number | boolean;
}
```

### ParsedFlags

```ts
interface ParsedFlags extends Record<string, unknown> {
  format: "yaml" | "json" | "text" | "html";
  compact: boolean;
  quiet: boolean;
  json: boolean;
  render?: boolean;   // only when render plugin is registered
  _positionals: string[];  // all positional arguments
}
```

## License

MIT
