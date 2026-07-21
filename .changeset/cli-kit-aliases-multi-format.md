---
"@ocas/cli-kit": minor
"@ocas/cli": patch
---

Add command aliases, fuzzy unknown-command suggestions, and multi-format template returns.

- **@ocas/cli-kit**: `.alias(...names)` on `CommandBuilder` registers alternate names
  resolved during dispatch. `TemplateSpec = string | FormatFunctors` allows per-format
  render functions in `.returns()`/`.yields()`. Levenshtein-based "Did you mean?" suggestions
  for unknown commands (edit distance ≤ 2). Help output shows aliases.
- **@ocas/cli**: update snapshots and test for plain text error output (post-#241 alignment).

Closes #243, #244
