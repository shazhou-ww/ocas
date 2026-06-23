---
scenario: "Framework normalizes ctx.error and thrown failures into schema-validated error envelopes"
feature: cli-kit
tags: [cli-kit, error-handling, envelope, stderr]
---

## Given

- `ErrorSchema` includes:
  - `message: string`
  - `code?: string`
  - `command: string`
- A command is running through `cli.run()`

## When

- Action code calls `ctx.error('msg', 'E_CODE')`

## Then

- Framework emits one error envelope to `stderr` in NDJSON form
- Error payload is validated against the error schema
- Envelope type is `@<cli>/error`
- Process exits with non-zero status

## When

- Action code throws an uncaught exception or returns a rejected promise

## Then

- Framework catches the failure and wraps it as the same `@<cli>/error` envelope path
- Error is emitted to `stderr` and process exits with non-zero status
