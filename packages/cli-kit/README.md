# @ocas/cli-kit

`@ocas/cli-kit` is the schema-driven CLI framework extracted for OCAS CLI tooling.

Phase 1 provides:

- command builder primitives (`arg`, `flag`, `yields`, `returns`, `action`)
- dual-layer output flow (`stderr` NDJSON yields + `stdout` final return render)
- zod-based runtime validation for yield/return/error payloads
- structured error envelopes
- log-tag validation and JSONL daily log files
- render-plugin gated `-r/--render` support
