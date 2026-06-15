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

  // Structured templates (key-value)
  [
    "@ocas/output/get",
    '<dl class="ocas-output ocas-get">' +
      '<dt>type</dt><dd><code class="ocas-hash">{{ payload.type }}</code></dd>' +
      "<dt>timestamp</dt><dd>{{ payload.timestamp }}</dd>" +
      "{% if payload.tags %}" +
      '<dt>tags</dt><dd><ul>{% for t in payload.tags %}<li>{{ t.key }}{% if t.value %}:{{ t.value }}{% endif %} → <code class="ocas-hash">{{ t.target }}</code></li>{% endfor %}</ul></dd>' +
      "{% endif %}" +
      "</dl>",
  ],
  [
    "@ocas/output/var-set",
    '<dl class="ocas-output ocas-var-set">' +
      "<dt>name</dt><dd>{{ payload.name }}</dd>" +
      '<dt>schema</dt><dd><code class="ocas-hash">{{ payload.schema }}</code></dd>' +
      '<dt>value</dt><dd><code class="ocas-hash">{{ payload.value }}</code></dd>' +
      "</dl>",
  ],
  [
    "@ocas/output/var-get",
    '<dl class="ocas-output ocas-var-get">' +
      "<dt>name</dt><dd>{{ payload.name }}</dd>" +
      '<dt>schema</dt><dd><code class="ocas-hash">{{ payload.schema }}</code></dd>' +
      '<dt>value</dt><dd><code class="ocas-hash">{{ payload.value }}</code></dd>' +
      "{% if payload.valueTags %}" +
      "<dt>tags</dt><dd><ul>{% for t in payload.valueTags %}<li>{{ t.key }}{% if t.value %}:{{ t.value }}{% endif %}</li>{% endfor %}</ul></dd>" +
      "{% endif %}" +
      "</dl>",
  ],
  [
    "@ocas/output/var-delete",
    '<dl class="ocas-output ocas-var-delete">' +
      "<dt>name</dt><dd>{{ payload.name }}</dd>" +
      '<dt>schema</dt><dd><code class="ocas-hash">{{ payload.schema }}</code></dd>' +
      '<dt>value</dt><dd><code class="ocas-hash">{{ payload.value }}</code></dd>' +
      "</dl>",
  ],
  [
    "@ocas/output/template-set",
    '<dl class="ocas-output ocas-template-set">' +
      '<dt>schema</dt><dd><code class="ocas-hash">{{ payload.schemaHash }}</code></dd>' +
      '<dt>content</dt><dd><code class="ocas-hash">{{ payload.contentHash }}</code></dd>' +
      "</dl>",
  ],

  // List/Array templates
  [
    "@ocas/output/refs",
    '<ul class="ocas-output ocas-refs">{% for ref in payload %}<li><code class="ocas-hash">{{ ref }}</code></li>{% endfor %}</ul>',
  ],
  [
    "@ocas/output/walk",
    '<ul class="ocas-output ocas-walk">{% for item in payload %}<li><code class="ocas-hash">{{ item }}</code></li>{% endfor %}</ul>',
  ],
  [
    "@ocas/output/list",
    '<table class="ocas-output ocas-list"><thead><tr><th>hash</th><th>created</th><th>updated</th></tr></thead><tbody>{% for item in payload %}<tr><td><code class="ocas-hash">{{ item.hash }}</code></td><td>{{ item.created }}</td><td>{{ item.updated }}</td></tr>{% endfor %}</tbody></table>',
  ],
  [
    "@ocas/output/list-meta",
    '<table class="ocas-output ocas-list-meta"><thead><tr><th>hash</th><th>created</th><th>updated</th></tr></thead><tbody>{% for item in payload %}<tr><td><code class="ocas-hash">{{ item.hash }}</code></td><td>{{ item.created }}</td><td>{{ item.updated }}</td></tr>{% endfor %}</tbody></table>',
  ],
  [
    "@ocas/output/list-schema",
    '<table class="ocas-output ocas-list-schema"><thead><tr><th>hash</th><th>created</th><th>updated</th></tr></thead><tbody>{% for item in payload %}<tr><td><code class="ocas-hash">{{ item.hash }}</code></td><td>{{ item.created }}</td><td>{{ item.updated }}</td></tr>{% endfor %}</tbody></table>',
  ],
  [
    "@ocas/output/var-list",
    '<table class="ocas-output ocas-var-list"><thead><tr><th>name</th><th>schema</th><th>value</th></tr></thead><tbody>{% for v in payload %}<tr><td>{{ v.name }}</td><td><code class="ocas-hash">{{ v.schema }}</code></td><td><code class="ocas-hash">{{ v.value }}</code></td></tr>{% endfor %}</tbody></table>',
  ],
  [
    "@ocas/output/var-history",
    '<div class="ocas-output ocas-var-history">' +
      '<dl><dt>name</dt><dd>{{ payload.name }}</dd><dt>schema</dt><dd><code class="ocas-hash">{{ payload.schema }}</code></dd></dl>' +
      '<ol class="ocas-history-values" start="0">{% for v in payload.values %}<li><code class="ocas-hash">{{ v }}</code></li>{% endfor %}</ol>' +
      "</div>",
  ],
  [
    "@ocas/output/template-list",
    '<table class="ocas-output ocas-template-list"><thead><tr><th>schema</th><th>content</th></tr></thead><tbody>{% for t in payload %}<tr><td><code class="ocas-hash">{{ t.schemaHash }}</code></td><td><code class="ocas-hash">{{ t.contentHash }}</code></td></tr>{% endfor %}</tbody></table>',
  ],
  [
    "@ocas/output/tag",
    '<table class="ocas-output ocas-tag"><thead><tr><th>key</th><th>value</th><th>target</th></tr></thead><tbody>{% for t in payload %}<tr><td>{{ t.key }}</td><td>{% if t.value %}{{ t.value }}{% endif %}</td><td><code class="ocas-hash">{{ t.target }}</code></td></tr>{% endfor %}</tbody></table>',
  ],
  [
    "@ocas/output/untag",
    '<table class="ocas-output ocas-untag"><thead><tr><th>key</th><th>value</th><th>target</th></tr></thead><tbody>{% for t in payload %}<tr><td>{{ t.key }}</td><td>{% if t.value %}{{ t.value }}{% endif %}</td><td><code class="ocas-hash">{{ t.target }}</code></td></tr>{% endfor %}</tbody></table>',
  ],

  // Statistics templates (card-style)
  [
    "@ocas/output/gc",
    '<div class="ocas-output ocas-gc ocas-stats">' +
      "<dl>" +
      '<dt>total</dt><dd class="ocas-metric">{{ payload.total }}</dd>' +
      '<dt>reachable</dt><dd class="ocas-metric">{{ payload.reachable }}</dd>' +
      '<dt>collected</dt><dd class="ocas-metric">{{ payload.collected }}</dd>' +
      '<dt>scanned</dt><dd class="ocas-metric">{{ payload.scanned }}</dd>' +
      "</dl>" +
      "</div>",
  ],
  [
    "@ocas/output/export",
    '<div class="ocas-output ocas-export ocas-stats">' +
      "<dl>" +
      '<dt>nodes</dt><dd class="ocas-metric">{{ payload.nodes }}</dd>' +
      '<dt>vars</dt><dd class="ocas-metric">{{ payload.vars }}</dd>' +
      '<dt>tags</dt><dd class="ocas-metric">{{ payload.tags }}</dd>' +
      "</dl>" +
      "</div>",
  ],
  [
    "@ocas/output/import",
    '<div class="ocas-output ocas-import ocas-stats">' +
      "<dl>" +
      '<dt>nodes imported</dt><dd class="ocas-metric">{{ payload.nodes.imported }}</dd>' +
      '<dt>nodes skipped</dt><dd class="ocas-metric">{{ payload.nodes.skipped }}</dd>' +
      '<dt>vars created</dt><dd class="ocas-metric">{{ payload.vars.created }}</dd>' +
      '<dt>vars updated</dt><dd class="ocas-metric">{{ payload.vars.updated }}</dd>' +
      '<dt>tags</dt><dd class="ocas-metric">{{ payload.tags }}</dd>' +
      "</dl>" +
      "</div>",
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
