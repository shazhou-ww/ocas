---
scenario: "Compose phase renders final output with content and type_statics"
feature: render
tags: [render, map-reduce-compose, compose-phase]
---

## Given

- Map phase produced DFS-rendered content string: `"<rendered content>"`
- Reduce phase produced type statics: `Record<Hash, TypeStatics>`
- A compose template exists: `"Final: {{ content }}\nStatics: {{ type_statics }}"`

## When

- Compose phase runs with the compose template
- LiquidJS context is populated:
  - `content` = the DFS-rendered content string
  - `type_statics` = the collected type statics map

## Then

- Engine renders: `engine.parseAndRender(composeTemplate, { content, type_statics })`
- The compose template has access to both variables
- `{{ content }}` inserts the rendered content
- `{{ type_statics }}` provides the full map for slot-based assembly
- Example output: `"Final: <rendered content>\nStatics: [object Object]"`
- The compose template is responsible for assembling the final output structure
