---
scenario: "Reduce phase collects TypeStatics from encountered types"
feature: render
tags: [render, map-reduce-compose, type-statics]
---

## Given

- A store with types `T1`, `T2`, `T3`
- Type `T1` has a static template at `@ocas/template-static/{format}/T1` containing LiquidJS template
- Type `T2` has no static template registered
- Type `T3` has a static template at `@ocas/template-static/{format}/T3`

## When

- Map phase produces encountered types: `Set { T1, T2, T3 }`
- Reduce phase runs: `collectTypeStatics(store, types, format)`

## Then

- For each type in the set, query variable `@ocas/template-static/{format}/{typeHash}`
- If found, render the static template and collect its output
- Static template receives empty context (no node payload)
- Result is `Record<Hash, TypeStatics>` where:
  - `T1 → TypeStatics` (parsed from T1's static template output)
  - `T2 → undefined` (no static template)
  - `T3 → TypeStatics` (parsed from T3's static template output)
- TypeStatics structure: `Record<string, string>` (slot name → raw content)
- Example: `{ "css": ".foo { color: red; }", "js": "console.log('loaded');" }`
