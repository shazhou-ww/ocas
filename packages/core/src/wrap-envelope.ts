import { bootstrap } from "./bootstrap.js";
import type { Hash, Store } from "./types.js";

/**
 * Resolve a schema alias (e.g. "@output/put") to its hash via bootstrap,
 * then return a typed envelope ready for store.put() or direct rendering.
 */
export async function wrapEnvelope(
  store: Store,
  schemaAlias: string,
  value: unknown,
): Promise<{ type: Hash; value: unknown }> {
  const aliases = await bootstrap(store);
  const typeHash = aliases[schemaAlias];
  if (typeHash === undefined) {
    throw new Error(`Unknown schema alias: ${schemaAlias}`);
  }
  return { type: typeHash, value };
}
