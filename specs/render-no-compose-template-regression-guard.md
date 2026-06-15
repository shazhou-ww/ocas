---
scenario: "Regression guard test for identity compose behavior"
feature: render
tags: [render, map-reduce-compose, testing, regression]
---

## Given

- A test store with multiple nodes and types
- **No compose template registered** for text format
- Root node renders to known output via existing DFS logic

## When

- `renderAsync(store, rootHash, { format: 'text' })` is called
- Map+reduce phases run (types collected but no compose template exists)
- Compose phase applies identity transformation

## Then

- Output is byte-for-byte identical to pre-refactor renderAsync output
- Test compares against expected DFS-rendered content (no compose wrapper)
- This test explicitly validates the "no compose template" path
- Serves as regression guard for identity compose behavior
- Complements existing tests by explicitly asserting identity behavior
- This is a **new test** ensuring identity compose works correctly
