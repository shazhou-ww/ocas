---
scenario: "Type collection via LiquidJS context side-channel"
feature: render
tags: [render, map-reduce-compose, implementation, liquidjs]
---

## Given

- `renderWithTemplate` already passes `__visited` Set through LiquidJS context for cycle detection
- We need to collect encountered types during the same DFS traversal

## When

- `renderWithTemplate` initializes context with `__encountered_types` Set (similar to `__visited`)
- Each call to `renderNode` adds `node.type` to the set:
  ```typescript
  const encounteredTypes = context.__encountered_types as Set<Hash>;
  encounteredTypes.add(node.type);
  ```

## Then

- Type collection happens as a side-effect during normal DFS rendering
- No change to renderNode signature (context is passed through)
- After DFS completes, `__encountered_types` contains all unique types
- This set is consumed by the reduce phase
- Pattern mirrors existing `__visited` Set usage (proven and understood)
- Zero overhead when compose template doesn't exist (set is collected but not used)
