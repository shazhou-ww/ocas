---
scenario: "Map phase collects encountered types during DFS traversal"
feature: render
tags: [render, map-reduce-compose, type-collection]
---

## Given

- A store with multiple nodes forming a tree structure
- Each node has a different type hash
- Some types appear multiple times (e.g., string type used in multiple nodes)

## When

- `renderAsync(store, rootHash, { format: 'text' })` is called
- DFS traversal visits nodes with types: `[T1, T2, T1, T3, T2]`

## Then

- The map phase collects all encountered type hashes in a Set
- Duplicate types are deduplicated: `Set { T1, T2, T3 }`
- The set is passed to the reduce phase for type statics collection
- This collection happens as a side-channel during normal DFS rendering
- Text format rendering output remains identical to pre-refactor behavior
