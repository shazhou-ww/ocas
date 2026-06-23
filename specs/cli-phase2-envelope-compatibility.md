---
scenario: "cli-kit envelope mechanism preserves ocas output schema contracts"
feature: cli-kit
tags: [cli, cli-kit, envelope, compatibility, phase-2]
---

## Given

- Legacy ocas commands previously wrapped outputs through `wrapEnvelope(...)`
- Existing integrations consume `@ocas/output/*` typed envelopes

## When

- Commands are migrated to cli-kit return schemas in issue `#214`

## Then

- Successful command outputs remain typed under the `@ocas/output/*` namespace
- Envelope payload structure for each command stays backward-compatible
- Command failures are emitted as structured error envelopes on `stderr`
- Migration standardizes formatting behavior while preserving command semantics
