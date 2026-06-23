---
scenario: "Schema names are auto-generated from CLI and command path with optional overrides"
feature: cli-kit
tags: [cli-kit, schema, naming]
---

## Given

- CLI metadata has `name: 'ocas'`
- A leaf command path is `var set`

## When

- The command defines `.returns(returnSchema, template)` without explicit name override
- The command defines `.yields(yieldSchema, template)` without explicit name override

## Then

- Return schema name defaults to `@ocas/var/set`
- Yield schema name defaults to `@ocas/var/set/yield`
- Yield and return envelopes use their respective schema names consistently

## When

- The command defines `.returns(returnSchema, template, { name: '@custom/result' })`

## Then

- The return envelope schema name is `@custom/result` instead of the default name
