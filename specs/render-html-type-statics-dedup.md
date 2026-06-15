---
scenario: "Same type appearing multiple times — CSS/JS injected only once"
feature: render
tags: [render, html, type-statics, dedup]
---

## Given

- A store with bootstrap
- A schema `personSchema` with properties `{ name: string }`
- An HTML instance template registered at `@ocas/template/html/<personSchema>`
- A static template registered at `@ocas/template-static/html/<personSchema>`
  - Content: `{"css": ".person { margin: 8px; }"}`
- A container schema with an array of `ocas_ref` to person nodes
- An HTML instance template registered for the container schema that renders each child
- 3 person nodes stored: Alice, Bob, Charlie
- A container node referencing all 3 person nodes

## When

- `renderAsync(store, containerHash, { format: 'html' })` is called
- DFS traversal encounters `personSchema` three times (once per person node)

## Then

- The output contains all 3 rendered person instances (Alice, Bob, Charlie)
- The CSS `.person { margin: 8px; }` appears exactly **once** in the output
- Only one `<style>` block is generated for the person type, not three
- Deduplication happens at the type level: the `Set<Hash>` of encountered types
  ensures each type hash is collected only once, regardless of how many instances exist
