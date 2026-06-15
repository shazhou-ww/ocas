import { bootstrap } from "./bootstrap.js";
import type { Hash, Store } from "./types.js";

// ── Text templates ──────────────────────────────────────────────────

const TEXT_TEMPLATES: ReadonlyArray<
  readonly [alias: string, template: string]
> = [
  ["@ocas/output/put", "{{ payload }}"],
  [
    "@ocas/output/get",
    "type: {{ payload.type }}\ntimestamp: {{ payload.timestamp }}",
  ],
  ["@ocas/output/has", "{{ payload }}"],
  ["@ocas/output/hash", "{{ payload }}"],
  ["@ocas/output/verify", "{{ payload }}"],
  ["@ocas/output/refs", "{% for ref in payload %}{{ ref }}\n{% endfor %}"],
  ["@ocas/output/walk", "{% for item in payload %}{{ item }}\n{% endfor %}"],
  ["@ocas/output/list", "{% for item in payload %}{{ item }}\n{% endfor %}"],
  [
    "@ocas/output/list-meta",
    "{% for item in payload %}{{ item.hash }} {{ item.created }} {{ item.updated }}\n{% endfor %}",
  ],
  [
    "@ocas/output/list-schema",
    "{% for item in payload %}{{ item.hash }} {{ item.created }} {{ item.updated }}\n{% endfor %}",
  ],
  [
    "@ocas/output/var-set",
    "name: {{ payload.name }}\nschema: {{ payload.schema }}\nvalue: {{ payload.value }}",
  ],
  [
    "@ocas/output/var-get",
    "name: {{ payload.name }}\nschema: {{ payload.schema }}\nvalue: {{ payload.value }}",
  ],
  [
    "@ocas/output/var-delete",
    "name: {{ payload.name }}\nschema: {{ payload.schema }}\nvalue: {{ payload.value }}",
  ],
  [
    "@ocas/output/var-list",
    "{% for v in payload %}name: {{ v.name }}\nschema: {{ v.schema }}\nvalue: {{ v.value }}\n{% endfor %}",
  ],
  [
    "@ocas/output/tag",
    "{% for t in payload %}{{ t.key }}{% if t.value %}:{{ t.value }}{% endif %}\n{% endfor %}",
  ],
  [
    "@ocas/output/untag",
    "{% for t in payload %}{{ t.key }}{% if t.value %}:{{ t.value }}{% endif %}\n{% endfor %}",
  ],
  [
    "@ocas/output/var-history",
    "name: {{ payload.name }}\nschema: {{ payload.schema }}\n{% for v in payload.values %}{{ forloop.index0 }}: {{ v }}\n{% endfor %}",
  ],
  [
    "@ocas/output/template-set",
    "schemaHash: {{ payload.schemaHash }}\ncontentHash: {{ payload.contentHash }}",
  ],
  ["@ocas/output/template-get", "{{ payload }}"],
  [
    "@ocas/output/template-list",
    "{% for t in payload %}schemaHash: {{ t.schemaHash }}\ncontentHash: {{ t.contentHash }}\n{% endfor %}",
  ],
  ["@ocas/output/template-delete", "deleted: {{ payload.deleted }}"],
  [
    "@ocas/output/gc",
    "total: {{ payload.total }}\nreachable: {{ payload.reachable }}\ncollected: {{ payload.collected }}\nscanned: {{ payload.scanned }}",
  ],
  [
    "@ocas/output/export",
    "nodes: {{ payload.nodes }}\nvars: {{ payload.vars }}\ntags: {{ payload.tags }}",
  ],
  [
    "@ocas/output/import",
    "nodes.imported: {{ payload.nodes.imported }}\nnodes.skipped: {{ payload.nodes.skipped }}\nvars.created: {{ payload.vars.created }}\nvars.updated: {{ payload.vars.updated }}\ntags: {{ payload.tags }}",
  ],
];

// ── HTML templates ──────────────────────────────────────────────────

const HTML_TEMPLATES: ReadonlyArray<
  readonly [alias: string, template: string]
> = [
  // Simple value templates (card layout)
  [
    "@ocas/output/put",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Stored</div>' +
      '<div class="ocas-card-body"><code class="ocas-hash">{{ payload }}</code></div>' +
      "</div>",
  ],
  [
    "@ocas/output/has",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Exists</div>' +
      '<div class="ocas-card-body">' +
      '{% if payload %}<span class="ocas-badge ocas-badge-ok">✓ yes</span>' +
      '{% else %}<span class="ocas-badge ocas-badge-error">✗ no</span>{% endif %}' +
      "</div></div>",
  ],
  [
    "@ocas/output/hash",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Hash</div>' +
      '<div class="ocas-card-body"><code class="ocas-hash">{{ payload }}</code></div>' +
      "</div>",
  ],
  [
    "@ocas/output/verify",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Verify</div>' +
      '<div class="ocas-card-body">' +
      '{% if payload == "ok" %}<span class="ocas-badge ocas-badge-ok">✓ ok</span>' +
      '{% elsif payload == "corrupted" %}<span class="ocas-badge ocas-badge-error">✗ corrupted</span>' +
      '{% else %}<span class="ocas-badge ocas-badge-warn">⚠ invalid</span>{% endif %}' +
      "</div></div>",
  ],
  [
    "@ocas/output/template-get",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Template</div>' +
      '<div class="ocas-card-body"><pre class="ocas-template-content">{{ payload }}</pre></div>' +
      "</div>",
  ],
  [
    "@ocas/output/template-delete",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Template Deleted</div>' +
      '<div class="ocas-card-body">' +
      '{% if payload.deleted %}<span class="ocas-badge ocas-badge-ok">✓ deleted</span>' +
      '{% else %}<span class="ocas-badge ocas-badge-error">✗ not found</span>{% endif %}' +
      "</div></div>",
  ],

  // Structured templates (card layout with key-value grid)
  [
    "@ocas/output/get",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Node Detail</div>' +
      '<dl class="ocas-dl">' +
      '<dt>Type</dt><dd><code class="ocas-hash">{{ payload.type }}</code></dd>' +
      "<dt>Timestamp</dt><dd>{{ payload.timestamp }}</dd>" +
      "{% if payload.tags %}" +
      "<dt>Tags</dt><dd>{% for t in payload.tags %}" +
      '<span class="ocas-tag">{{ t.key }}{% if t.value %}:{{ t.value }}{% endif %}</span>' +
      "{% endfor %}</dd>" +
      "{% endif %}" +
      "</dl>" +
      "</div>",
  ],
  [
    "@ocas/output/var-set",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Variable Set</div>' +
      '<dl class="ocas-dl">' +
      "<dt>Name</dt><dd>{{ payload.name }}</dd>" +
      '<dt>Schema</dt><dd><code class="ocas-hash">{{ payload.schema }}</code></dd>' +
      '<dt>Value</dt><dd><code class="ocas-hash">{{ payload.value }}</code></dd>' +
      "</dl>" +
      "</div>",
  ],
  [
    "@ocas/output/var-get",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Variable Detail</div>' +
      '<dl class="ocas-dl">' +
      "<dt>Name</dt><dd>{{ payload.name }}</dd>" +
      '<dt>Schema</dt><dd><code class="ocas-hash">{{ payload.schema }}</code></dd>' +
      '<dt>Value</dt><dd><code class="ocas-hash">{{ payload.value }}</code></dd>' +
      "{% if payload.valueTags %}" +
      "<dt>Tags</dt><dd>{% for t in payload.valueTags %}" +
      '<span class="ocas-tag">{{ t.key }}{% if t.value %}:{{ t.value }}{% endif %}</span>' +
      "{% endfor %}</dd>" +
      "{% endif %}" +
      "</dl>" +
      "</div>",
  ],
  [
    "@ocas/output/var-delete",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Variable Deleted</div>' +
      '<dl class="ocas-dl">' +
      "<dt>Name</dt><dd>{{ payload.name }}</dd>" +
      '<dt>Schema</dt><dd><code class="ocas-hash">{{ payload.schema }}</code></dd>' +
      '<dt>Value</dt><dd><code class="ocas-hash">{{ payload.value }}</code></dd>' +
      "</dl>" +
      "</div>",
  ],
  [
    "@ocas/output/template-set",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Template Set</div>' +
      '<dl class="ocas-dl">' +
      '<dt>Schema</dt><dd><code class="ocas-hash">{{ payload.schemaHash }}</code></dd>' +
      '<dt>Content</dt><dd><code class="ocas-hash">{{ payload.contentHash }}</code></dd>' +
      "</dl>" +
      "</div>",
  ],

  // List/Array templates
  [
    "@ocas/output/refs",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">References · {{ payload.size }} entries</div>' +
      '<div class="ocas-card-body"><ul class="ocas-hash-list">' +
      '{% for ref in payload %}<li><code class="ocas-hash">{{ ref }}</code></li>{% endfor %}' +
      "</ul></div></div>",
  ],
  [
    "@ocas/output/walk",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Walk · {{ payload.size }} entries</div>' +
      '<div class="ocas-card-body"><ul class="ocas-hash-list">' +
      '{% for item in payload %}<li><code class="ocas-hash">{{ item }}</code></li>{% endfor %}' +
      "</ul></div></div>",
  ],
  [
    "@ocas/output/list",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Nodes · {{ payload.size }} entries</div>' +
      '<table class="ocas-table"><thead><tr><th>HASH</th><th>CREATED</th><th>UPDATED</th></tr></thead>' +
      "<tbody>{% for item in payload %}<tr>" +
      '<td><code class="ocas-hash">{{ item.hash }}</code></td>' +
      '<td class="ocas-col-time">{{ item.created }}</td>' +
      '<td class="ocas-col-time">{{ item.updated }}</td>' +
      "</tr>{% endfor %}</tbody></table></div>",
  ],
  [
    "@ocas/output/list-meta",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Meta-Schemas · {{ payload.size }} entries</div>' +
      '<table class="ocas-table"><thead><tr><th>HASH</th><th>CREATED</th><th>UPDATED</th></tr></thead>' +
      "<tbody>{% for item in payload %}<tr>" +
      '<td><code class="ocas-hash">{{ item.hash }}</code></td>' +
      '<td class="ocas-col-time">{{ item.created }}</td>' +
      '<td class="ocas-col-time">{{ item.updated }}</td>' +
      "</tr>{% endfor %}</tbody></table></div>",
  ],
  [
    "@ocas/output/list-schema",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Schemas · {{ payload.size }} entries</div>' +
      '<table class="ocas-table"><thead><tr><th>HASH</th><th>CREATED</th><th>UPDATED</th></tr></thead>' +
      "<tbody>{% for item in payload %}<tr>" +
      '<td><code class="ocas-hash">{{ item.hash }}</code></td>' +
      '<td class="ocas-col-time">{{ item.created }}</td>' +
      '<td class="ocas-col-time">{{ item.updated }}</td>' +
      "</tr>{% endfor %}</tbody></table></div>",
  ],
  [
    "@ocas/output/var-list",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Variables · {{ payload.size }} entries</div>' +
      '<table class="ocas-table"><thead><tr><th>NAME</th><th>SCHEMA</th><th>VALUE</th></tr></thead>' +
      "<tbody>{% for v in payload %}<tr>" +
      '<td class="ocas-col-name">{{ v.name }}</td>' +
      '<td><code class="ocas-hash">{{ v.schema }}</code></td>' +
      '<td><code class="ocas-hash">{{ v.value }}</code></td>' +
      "</tr>{% endfor %}</tbody></table></div>",
  ],
  [
    "@ocas/output/var-history",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Variable History</div>' +
      '<dl class="ocas-dl">' +
      "<dt>Name</dt><dd>{{ payload.name }}</dd>" +
      '<dt>Schema</dt><dd><code class="ocas-hash">{{ payload.schema }}</code></dd>' +
      "</dl>" +
      '<ol class="ocas-history-values" start="0">' +
      "{% for v in payload.values %}<li>" +
      '<code class="ocas-hash">{{ v }}</code>' +
      '{% if forloop.first %} <span class="ocas-current-marker">← current</span>{% endif %}' +
      "</li>{% endfor %}</ol>" +
      "</div>",
  ],
  [
    "@ocas/output/template-list",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Templates · {{ payload.size }} entries</div>' +
      '<table class="ocas-table"><thead><tr><th>SCHEMA</th><th>CONTENT</th></tr></thead>' +
      "<tbody>{% for t in payload %}<tr>" +
      '<td><code class="ocas-hash">{{ t.schemaHash }}</code></td>' +
      '<td><code class="ocas-hash">{{ t.contentHash }}</code></td>' +
      "</tr>{% endfor %}</tbody></table></div>",
  ],
  [
    "@ocas/output/tag",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Tags · {{ payload.size }} entries</div>' +
      '<table class="ocas-table"><thead><tr><th>KEY</th><th>VALUE</th><th>TARGET</th></tr></thead>' +
      "<tbody>{% for t in payload %}<tr>" +
      "<td>{{ t.key }}</td>" +
      '<td>{% if t.value %}{{ t.value }}{% else %}<span style="color: var(--ocas-text-muted)">—</span>{% endif %}</td>' +
      '<td><code class="ocas-hash">{{ t.target }}</code></td>' +
      "</tr>{% endfor %}</tbody></table></div>",
  ],
  [
    "@ocas/output/untag",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Untagged · {{ payload.size }} entries</div>' +
      '<table class="ocas-table"><thead><tr><th>KEY</th><th>VALUE</th><th>TARGET</th></tr></thead>' +
      "<tbody>{% for t in payload %}<tr>" +
      "<td>{{ t.key }}</td>" +
      '<td>{% if t.value %}{{ t.value }}{% else %}<span style="color: var(--ocas-text-muted)">—</span>{% endif %}</td>' +
      '<td><code class="ocas-hash">{{ t.target }}</code></td>' +
      "</tr>{% endfor %}</tbody></table></div>",
  ],

  // Statistics templates (card + stats-grid)
  [
    "@ocas/output/gc",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Garbage Collection</div>' +
      '<div class="ocas-card-body"><div class="ocas-stats-grid">' +
      '<div class="ocas-stat"><span class="ocas-stat-value">{{ payload.total }}</span>' +
      '<span class="ocas-stat-label">total nodes</span></div>' +
      '<div class="ocas-stat"><span class="ocas-stat-value">{{ payload.reachable }}</span>' +
      '<span class="ocas-stat-label">reachable</span></div>' +
      '<div class="ocas-stat">' +
      '{% if payload.collected == 0 %}<span class="ocas-stat-value ocas-success">{{ payload.collected }}</span>' +
      '{% else %}<span class="ocas-stat-value">{{ payload.collected }}</span>{% endif %}' +
      '<span class="ocas-stat-label">collected</span></div>' +
      '<div class="ocas-stat"><span class="ocas-stat-value">{{ payload.scanned }}</span>' +
      '<span class="ocas-stat-label">scanned</span></div>' +
      "</div></div></div>",
  ],
  [
    "@ocas/output/export",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Export Summary</div>' +
      '<div class="ocas-card-body"><div class="ocas-stats-grid">' +
      '<div class="ocas-stat"><span class="ocas-stat-value">{{ payload.nodes }}</span>' +
      '<span class="ocas-stat-label">nodes</span></div>' +
      '<div class="ocas-stat"><span class="ocas-stat-value">{{ payload.vars }}</span>' +
      '<span class="ocas-stat-label">variables</span></div>' +
      '<div class="ocas-stat"><span class="ocas-stat-value">{{ payload.tags }}</span>' +
      '<span class="ocas-stat-label">tags</span></div>' +
      "</div></div></div>",
  ],
  [
    "@ocas/output/import",
    '<div class="ocas-card">' +
      '<div class="ocas-card-header">Import Summary</div>' +
      '<div class="ocas-card-body"><div class="ocas-stats-grid">' +
      '<div class="ocas-stat"><span class="ocas-stat-value">{{ payload.nodes.imported }}</span>' +
      '<span class="ocas-stat-label">nodes imported</span></div>' +
      '<div class="ocas-stat"><span class="ocas-stat-value">{{ payload.nodes.skipped }}</span>' +
      '<span class="ocas-stat-label">nodes skipped</span></div>' +
      '<div class="ocas-stat"><span class="ocas-stat-value">{{ payload.vars.created }}</span>' +
      '<span class="ocas-stat-label">variables created</span></div>' +
      '<div class="ocas-stat"><span class="ocas-stat-value">{{ payload.vars.updated }}</span>' +
      '<span class="ocas-stat-label">variables updated</span></div>' +
      '<div class="ocas-stat"><span class="ocas-stat-value">{{ payload.tags }}</span>' +
      '<span class="ocas-stat-label">tags</span></div>' +
      "</div></div></div>",
  ],
];

// ── Shared CSS ──────────────────────────────────────────────────────

/**
 * Shared CSS for output HTML templates.
 * Uses `.ocas-` scoped class names and CSS custom properties per the design guide.
 */
const OUTPUT_CSS = [
  // Design tokens
  ":root {" +
    " --ocas-font: system-ui, -apple-system, 'Segoe UI', sans-serif;" +
    " --ocas-mono: ui-monospace, 'SF Mono', 'Cascadia Code', monospace;" +
    " --ocas-bg: #fafafa;" +
    " --ocas-card-bg: #fff;" +
    " --ocas-card-border: #e5e7eb;" +
    " --ocas-card-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);" +
    " --ocas-card-radius: 8px;" +
    " --ocas-text: #1f2937;" +
    " --ocas-text-muted: #6b7280;" +
    " --ocas-green: #16a34a;" +
    " --ocas-red: #dc2626;" +
    " --ocas-yellow: #d97706;" +
    " --ocas-hash-bg: #f3f4f6;" +
    " --ocas-hash-text: #374151;" +
    " --ocas-metric-size: 1.75rem;" +
    " }",

  // Card container
  ".ocas-card { background: var(--ocas-card-bg); border: 1px solid var(--ocas-card-border);" +
    " box-shadow: var(--ocas-card-shadow); border-radius: var(--ocas-card-radius);" +
    " font-family: var(--ocas-font); color: var(--ocas-text); line-height: 1.5; max-width: 48rem; }",
  ".ocas-card-header { font-weight: 600; padding: 0.75rem 1rem;" +
    " border-bottom: 1px solid var(--ocas-card-border); }",
  ".ocas-card-body { padding: 1rem; }",

  // Hash pill
  ".ocas-hash { font-family: var(--ocas-mono); font-size: 0.9em;" +
    " background: var(--ocas-hash-bg); color: var(--ocas-hash-text);" +
    " padding: 0.15em 0.4em; border-radius: 4px; word-break: break-all; }",

  // Key-value grid
  ".ocas-dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; margin: 0; padding: 1rem; }",
  ".ocas-dl dt { font-weight: 600; color: var(--ocas-text-muted); }",
  ".ocas-dl dd { margin: 0; }",

  // Tag pills
  ".ocas-tag { display: inline-block; background: #eff6ff; color: #2563eb;" +
    " font-size: 0.85em; padding: 0.1em 0.5em; border-radius: 9999px; margin-right: 0.25rem; }",

  // Status badges
  ".ocas-badge { display: inline-block; padding: 0.25em 0.75em; border-radius: 9999px;" +
    " font-weight: 500; font-size: 0.9em; }",
  ".ocas-badge-ok { background: #dcfce7; color: var(--ocas-green); }",
  ".ocas-badge-error { background: #fee2e2; color: var(--ocas-red); }",
  ".ocas-badge-warn { background: #fef3c7; color: var(--ocas-yellow); }",

  // Template content code block
  ".ocas-template-content { white-space: pre-wrap; background: var(--ocas-hash-bg);" +
    " font-family: var(--ocas-mono); padding: 0.75rem; border-radius: 4px;" +
    " overflow-x: auto; margin: 0; }",

  // Stats grid (gc, export, import)
  ".ocas-stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }",
  ".ocas-stat { display: flex; flex-direction: column; }",
  ".ocas-stat-value { font-size: var(--ocas-metric-size); font-weight: 600;" +
    " font-variant-numeric: tabular-nums; }",
  ".ocas-stat-label { color: var(--ocas-text-muted); font-size: 0.85em; }",

  // Semantic highlights
  ".ocas-success { color: var(--ocas-green); }",
  ".ocas-zero { color: var(--ocas-text-muted); }",

  // Hash list (refs, walk)
  ".ocas-hash-list { list-style: none; padding: 0; margin: 0; }",
  ".ocas-hash-list li { padding: 0.25rem 0; }",

  // History (var-history)
  ".ocas-history-values { padding-left: 1.5rem; margin: 0; }",
  ".ocas-history-values li { padding: 0.25rem 0; }",
  ".ocas-current-marker { color: var(--ocas-green); font-size: 0.85em; font-weight: 500; }",

  // Legacy .ocas-output support (structured/list/stats templates)
  ".ocas-output { font-family: var(--ocas-font); line-height: 1.5; max-width: 48rem; }",
  ".ocas-output dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; margin: 0; }",
  ".ocas-output dt { font-weight: 600; color: var(--ocas-text-muted); }",
  ".ocas-output dd { margin: 0; }",
  ".ocas-output table { border-collapse: collapse; width: 100%; }",
  ".ocas-output th, .ocas-output td { text-align: left; padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--ocas-card-border); }",
  ".ocas-output th { font-weight: 600; color: var(--ocas-text-muted); background: #f9fafb; }",
  ".ocas-output ul { list-style: none; padding: 0; margin: 0; }",
  ".ocas-output li { padding: 0.2rem 0; }",
  ".ocas-stats .ocas-metric { font-size: 1.25em; font-weight: 600; }",
  ".ocas-verify-ok .ocas-status { color: var(--ocas-green); }",
  ".ocas-verify-corrupted .ocas-status { color: var(--ocas-red); }",
  ".ocas-verify-invalid .ocas-status { color: var(--ocas-yellow); }",

  // Table styles (design-guide-compliant)
  ".ocas-table { border-collapse: collapse; width: 100%; }",
  ".ocas-table th { text-align: left; padding: 0.4rem 0.75rem;" +
    " text-transform: uppercase; font-size: 0.75em; font-weight: 600;" +
    " color: var(--ocas-text-muted); letter-spacing: 0.05em;" +
    " border-bottom: 1px solid var(--ocas-card-border); }",
  ".ocas-table td { text-align: left; padding: 0.4rem 0.75rem;" +
    " border-bottom: 1px solid var(--ocas-card-border); }",
  ".ocas-table tr:last-child td { border-bottom: none; }",
  ".ocas-col-name { font-weight: 500; }",
  ".ocas-col-time { color: var(--ocas-text-muted); font-variant-numeric: tabular-nums; }",
].join(" ");

/**
 * Register default LiquidJS templates for all @ocas/output/* schemas.
 * Each template is stored as a @ocas/string CAS node and bound to
 * the variable `@ocas/template/{format}/<schema-hash>`.
 *
 * Registers both text and HTML templates. HTML templates also get a
 * shared CSS static template (`@ocas/template-static/html/<schema-hash>`).
 *
 * Idempotent: safe to call multiple times.
 */
export async function registerOutputTemplates(
  store: Store,
): Promise<Record<string, Hash>> {
  const aliases = bootstrap(store);
  const stringHash = aliases["@ocas/string"];
  if (stringHash === undefined) {
    throw new Error("@ocas/string schema not found in bootstrap result");
  }

  const registered: Record<string, Hash> = {};

  // Register text templates
  for (const [alias, template] of TEXT_TEMPLATES) {
    const schemaHash = aliases[alias];
    if (schemaHash === undefined) {
      throw new Error(`Schema alias not found: ${alias}`);
    }

    const contentHash = store.cas.put(stringHash, template);
    const varName = `@ocas/template/text/${schemaHash}`;
    store.var.set(varName, contentHash);
    registered[alias] = contentHash;
  }

  // Register HTML templates
  for (const [alias, template] of HTML_TEMPLATES) {
    const schemaHash = aliases[alias];
    if (schemaHash === undefined) {
      throw new Error(`Schema alias not found: ${alias}`);
    }

    const contentHash = store.cas.put(stringHash, template);
    const varName = `@ocas/template/html/${schemaHash}`;
    store.var.set(varName, contentHash);

    // Register shared CSS static template for this schema
    const staticJson = JSON.stringify({ css: OUTPUT_CSS });
    const staticHash = store.cas.put(stringHash, staticJson);
    const staticVarName = `@ocas/template-static/html/${schemaHash}`;
    store.var.set(staticVarName, staticHash);
  }

  return registered;
}
