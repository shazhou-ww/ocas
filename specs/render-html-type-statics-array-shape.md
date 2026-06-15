---
scenario: "type_statics passed to compose as iterable array with type_hash and slot values"
feature: render
tags: [render, html, type-statics, data-shape, compose-template]
---

## Given

- A store with bootstrap
- Two types: `personSchema` and `documentSchema`
- `personSchema` static template produces: `{"css": ".person { color: blue; }", "js": "initPerson();"}`
- `documentSchema` static template produces: `{"css": ".doc { padding: 16px; }"}`
  (no `js` slot for documentSchema)
- DFS traversal encounters both types

## When

- `collectTypeStatics(store, encounteredTypes, 'html')` is called
- The result is transformed for the compose template context

## Then

- `type_statics` passed to the compose template is an **array** of objects (not a record)
- Each element has:
  - `type_hash` — the type's hash string
  - Plus all slot key/value pairs from that type's static template
- Example:
  ```json
  [
    { "type_hash": "<personSchemaHash>", "css": ".person { color: blue; }", "js": "initPerson();" },
    { "type_hash": "<documentSchemaHash>", "css": ".doc { padding: 16px; }" }
  ]
  ```
- This array format is iterable by LiquidJS `{% for ts in type_statics %}`
- Types that had no static template are excluded from the array
- Slot names are not hardcoded — any key in the JSON output becomes a property on the array element
- The `type_hash` field allows the compose template to identify which type each statics entry belongs to
