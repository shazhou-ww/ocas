---
scenario: "Identity compose when no compose template exists (backward compatibility)"
feature: render
tags: [render, map-reduce-compose, backward-compatibility]
---

## Given

- No compose template registered for the current format
- Existing tests and CLI usage expect text format output unchanged

## When

- `renderAsync(store, rootHash, { format: 'text' })` is called
- Map phase produces rendered content: `content`
- Reduce phase produces type statics: `typeStatics`
- `findComposeTemplate(store, rootType, format)` returns `null`

## Then

- Compose phase applies identity transformation: `return content`
- Type statics are collected but not used
- Final output is identical to pre-refactor behavior
- **All existing render tests pass with zero changes**
- Text format never needs a compose template (identity is the default)
- This ensures zero behavior regression for existing workflows
