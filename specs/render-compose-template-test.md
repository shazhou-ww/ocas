---
scenario: "New test validates compose template is invoked with correct context"
feature: render
tags: [render, map-reduce-compose, testing]
---

## Given

- A test store with:
  - Root node with type `T_root` and content referencing child nodes
  - Child nodes with types `T1`, `T2`
  - Compose template registered at `@ocas/template/text/@compose`:
    ```liquid
    COMPOSED:
    {{ content }}
    STATICS: {{ type_statics | json }}
    ```
  - Static template for `T1` at `@ocas/template/text/T1/static` outputs:
    ```yaml
    slot1: "value1"
    ```

## When

- `renderAsync(store, rootHash, { format: 'text' })` is called
- Map phase renders content: `"rendered content"`
- Reduce phase collects type statics for `T1`
- Compose phase finds and executes compose template

## Then

- Final output matches compose template structure:
  ```
  COMPOSED:
  rendered content
  STATICS: {"T1_HASH":{"slot1":"value1"}}
  ```
- Test verifies:
  - Compose template was invoked (not identity)
  - `content` variable contains DFS-rendered output
  - `type_statics` variable contains collected statics
  - Both variables are accessible in compose template
- This is a **new test** added alongside existing tests
