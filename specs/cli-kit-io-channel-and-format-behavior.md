---
scenario: "Yield events and return value use separate output channels and format policies"
feature: cli-kit
tags: [cli-kit, io, output-format, ndjson]
---

## Given

- A command defines both `.yields(...)` and `.returns(...)`
- Standard flags include `--format`, `--compact`, and `--quiet`

## When

- The command action yields one or more intermediate objects and then returns a final object
- The command is executed with different format flags:
  - `--format yaml`
  - `--format json`
  - `--format text`
  - `--format html`

## Then

- Yield stream entries are written to `stderr` as NDJSON envelope records
- Yield entries are schema-validated before writing to `stderr`
- Return value is written to `stdout` only by framework output rendering
- Return formatting follows `--format` selection with default `yaml`
- `--compact` produces compact JSON output for `--format json`
- `--quiet` suppresses yield NDJSON on `stderr` while still emitting final return output on `stdout`
