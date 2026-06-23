---
scenario: "Log tag system validates tags and writes structured JSONL logs with daily rotation"
feature: cli-kit
tags: [cli-kit, logging, log-tag, jsonl]
---

## Given

- CLI metadata has `name: 'ocas'`
- Framework logger is available as `ctx.log`
- Log tag validation is exposed by `assertValidLogTag()`

## When

- Logging methods are called with valid 8-character Crockford Base32 tags
- Messages are emitted through `ctx.log.debug/info/warn`

## Then

- Each log record is appended as JSONL at `~/.ocas/logs/YYYY-MM-DD.jsonl`
- Each record includes at least `ts`, `pid`, `tag`, and `msg`
- Tags pass runtime validation before records are written

## When

- A log method is called with an invalid tag format

## Then

- `assertValidLogTag()` rejects the tag at runtime
- The invalid-tag write does not produce a malformed JSONL record
