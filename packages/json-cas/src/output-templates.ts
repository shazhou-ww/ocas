import { bootstrap } from "./bootstrap.js";
import type { Hash, Store } from "./types.js";
import type { VariableStore } from "./variable-store.js";

const DEFAULT_TEMPLATES: ReadonlyArray<
  readonly [alias: string, template: string]
> = [
  ["@output/put", "{{ payload }}"],
  [
    "@output/get",
    "type: {{ payload.type }}\ntimestamp: {{ payload.timestamp }}",
  ],
  ["@output/has", "{{ payload }}"],
  ["@output/hash", "{{ payload }}"],
  ["@output/verify", "{{ payload }}"],
  ["@output/refs", "{% for ref in payload %}{{ ref }}\n{% endfor %}"],
  ["@output/walk", "{% for item in payload %}{{ item }}\n{% endfor %}"],
  ["@output/list", "{% for item in payload %}{{ item }}\n{% endfor %}"],
  [
    "@output/var-set",
    "name: {{ payload.name }}\nschema: {{ payload.schema }}\nvalue: {{ payload.value }}",
  ],
  [
    "@output/var-get",
    "name: {{ payload.name }}\nschema: {{ payload.schema }}\nvalue: {{ payload.value }}",
  ],
  [
    "@output/var-delete",
    "name: {{ payload.name }}\nschema: {{ payload.schema }}\nvalue: {{ payload.value }}",
  ],
  [
    "@output/var-tag",
    "name: {{ payload.name }}\nschema: {{ payload.schema }}\nvalue: {{ payload.value }}",
  ],
  [
    "@output/var-list",
    "{% for v in payload %}name: {{ v.name }}\nschema: {{ v.schema }}\nvalue: {{ v.value }}\n{% endfor %}",
  ],
  [
    "@output/template-set",
    "schemaHash: {{ payload.schemaHash }}\ncontentHash: {{ payload.contentHash }}",
  ],
  ["@output/template-get", "{{ payload }}"],
  [
    "@output/template-list",
    "{% for t in payload %}schemaHash: {{ t.schemaHash }}\ncontentHash: {{ t.contentHash }}\n{% endfor %}",
  ],
  ["@output/template-delete", "deleted: {{ payload.deleted }}"],
  [
    "@output/gc",
    "total: {{ payload.total }}\nreachable: {{ payload.reachable }}\ncollected: {{ payload.collected }}\nscanned: {{ payload.scanned }}",
  ],
];

/**
 * Register default LiquidJS templates for all @output/* schemas.
 * Each template is stored as a @string CAS node and bound to
 * the variable `@ucas/template/text/<schema-hash>`.
 *
 * Idempotent: safe to call multiple times.
 */
export async function registerOutputTemplates(
  store: Store,
  varStore: VariableStore,
): Promise<Record<string, Hash>> {
  const aliases = await bootstrap(store);
  const stringHash = aliases["@string"];
  if (stringHash === undefined) {
    throw new Error("@string schema not found in bootstrap result");
  }

  const registered: Record<string, Hash> = {};

  for (const [alias, template] of DEFAULT_TEMPLATES) {
    const schemaHash = aliases[alias];
    if (schemaHash === undefined) {
      throw new Error(`Schema alias not found: ${alias}`);
    }

    const contentHash = await store.put(stringHash, template);
    const varName = `@ucas/template/text/${schemaHash}`;
    varStore.set(varName, contentHash);
    registered[alias] = contentHash;
  }

  return registered;
}
