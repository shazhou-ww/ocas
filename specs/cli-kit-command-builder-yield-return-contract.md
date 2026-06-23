---
scenario: "CommandBuilder supports arg/flag/yields/returns/action chain with AsyncGenerator contract"
feature: cli-kit
tags: [cli-kit, command-builder, async-generator, schema]
---

## Given

- A CLI is created by `createCLI({ name: 'gangmu', version: '1.0.0' })`
- A command is defined with:
  - `.arg('query')`
  - `.flag('limit', { type: 'number', default: 5 })`
  - `.yields(z.object({ card: z.string(), score: z.number() }), template)`
  - `.returns(z.object({ query: z.string(), count: z.number() }), template)`

## When

- The command action is implemented as `async function* (args, flags, ctx) { ... }`
- The action yields process items and returns a final result
- The CLI is executed with `cli.run()`

## Then

- `args` carries ordered positional arguments defined by `.arg(...)`
- `flags` carries parsed named flags with type conversion and default values
- Each yielded item is validated against the `.yields(...)` schema
- The returned final value is validated against the `.returns(...)` schema
- `.returns(...)` is required for executable leaf commands
- Group commands can define `.command(...)` children and are not directly executable
