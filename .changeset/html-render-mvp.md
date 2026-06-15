---
"@ocas/core": minor
"@ocas/cli": minor
---

Add HTML render format support: `ocas render <hash> --format html` produces a self-contained HTML5 document. Includes LiquidJS template discovery via `@ocas/template/html/<type-hash>`, YAML-in-`<pre><code>` fallback for unregistered types, builtin HTML document shell, and custom compose template override via `@ocas/template/html/_compose`.
