---
scenario: "ocas commands default to YAML envelope output after cli-kit migration"
feature: cli-kit
tags: [cli, cli-kit, output, yaml, phase-2]
---

## Given

- The migrated ocas CLI is built on `@ocas/cli-kit`
- A command with a successful return value is available (for example `ocas has <hash>`)

## When

- The command is executed without `--format`
- The same command is executed with `--format json`, `--format text`, and `--format html`

## Then

- Default `stdout` output is YAML (not JSON)
- The default YAML payload follows the envelope shape with `type` and `value`
- `--format json` still returns JSON envelope output
- `--format text` and `--format html` still render through command templates
- Switching default format does not change the command's semantic result (`value` content)
