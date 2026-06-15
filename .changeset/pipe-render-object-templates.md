---
"@ocas/core": patch
"@ocas/cli": patch
---

Fix pipe render to use templates and respect --format for object-valued envelopes

`ocas render -p` and the `-r` inline render flag now route object-valued
envelopes through `renderDirectAsync`, which runs the full template lookup +
map-reduce-compose pipeline. Previously these values were rendered via the
synchronous `renderDirect` which ignored templates and the `--format` flag.
