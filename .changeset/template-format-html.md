---
"@ocas/cli": minor
---

Add `--format html` and `--static` flags to all template subcommands (set/get/list/delete). HTML templates are stored at `@ocas/template/html/<schema-hash>` and static templates at `@ocas/template/html/<schema-hash>/static`. Default format remains `text` for backward compatibility.
