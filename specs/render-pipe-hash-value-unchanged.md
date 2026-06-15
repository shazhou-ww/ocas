---
scenario: "Pipe render with hash-valued envelope still uses renderAsync (backward compat)"
feature: render
tags: [render, pipe, backward-compat]
---

## Given

- A store with bootstrap completed
- An envelope with a hash string value (e.g. from `ocas put`): `{ type: "<put-type-hash>", value: "ABCDEFGH12345" }`
- The value is a valid 13-char Crockford Base32 hash

## When

- `ocas put <type> <file> | ocas render -p --format html`
- The envelope value is a hash string

## Then

- The hash value is resolved through `renderAsync(store, hash, options)` as before
- Templates, format flags, resolution/decay/epsilon are all applied correctly
- Behavior is identical to pre-fix — no regression
