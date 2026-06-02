import { bootstrap } from "./bootstrap.js";
import type { Hash, Store } from "./types.js";
import type { VariableStore } from "./variable-store.js";

const DEFAULT_TEMPLATES: ReadonlyArray<
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
    "@ocas/output/var-tag",
    "name: {{ payload.name }}\nschema: {{ payload.schema }}\nvalue: {{ payload.value }}",
  ],
  [
    "@ocas/output/var-list",
    "{% for v in payload %}name: {{ v.name }}\nschema: {{ v.schema }}\nvalue: {{ v.value }}\n{% endfor %}",
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
];

/**
 * Register default LiquidJS templates for all @ocas/output/* schemas.
 * Each template is stored as a @ocas/string CAS node and bound to
 * the variable `@ocas/template/text/<schema-hash>`.
 *
 * Idempotent: safe to call multiple times.
 */
export async function registerOutputTemplates(
  store: Store,
  varStore: VariableStore,
): Promise<Record<string, Hash>> {
  const aliases = await bootstrap(store);
  const stringHash = aliases["@ocas/string"];
  if (stringHash === undefined) {
    throw new Error("@ocas/string schema not found in bootstrap result");
  }

  const registered: Record<string, Hash> = {};

  for (const [alias, template] of DEFAULT_TEMPLATES) {
    const schemaHash = aliases[alias];
    if (schemaHash === undefined) {
      throw new Error(`Schema alias not found: ${alias}`);
    }

    const contentHash = await store.put(stringHash, template);
    const varName = `@ocas/template/text/${schemaHash}`;
    varStore.set(varName, contentHash);
    registered[alias] = contentHash;
  }

  return registered;
}
