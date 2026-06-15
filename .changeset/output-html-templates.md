---
"@ocas/core": minor
---

Add HTML output templates for all 24 @ocas/output/* schemas. Each schema now has both a text and HTML template registered during `registerOutputTemplates()`. HTML templates use semantic markup (dl, table, ul) with scoped `.ocas-` CSS classes injected via static templates. Also fills 4 missing text templates (list-meta, list-schema, export, import).
