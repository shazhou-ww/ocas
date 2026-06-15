---
"@ocas/core": minor
---

Replace HTML fallback `<pre><code>` YAML wrapping with structured, browsable HTML

When no HTML instance template is registered for a type, `renderAsync()` now
produces structured HTML instead of dumping YAML inside `<pre><code>` tags:

- **Objects** → `<ul>` with `<li>` per key-value pair
- **Arrays** → `<ul>` with `<li>` per item
- **Primitives** → `<span>` / `<code>` inline elements
- **CAS refs** → collapsible `<details><summary>` with recursive child rendering
- **Epsilon threshold** → opaque `cas:XXXXX` text (not expandable)

Nested structures render recursively. Text format fallback is unchanged (still YAML).
