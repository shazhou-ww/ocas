import { walk } from "./schema.js";
import type { Hash, Store, Tag } from "./types.js";
import type { Variable } from "./variable.js";

/**
 * Result of a closure computation: the set of CAS hashes reachable from a
 * set of roots, along with the variables and tags that point into the
 * closure.
 */
export type ClosureResult = {
  /** All CAS node hashes reachable from the roots. */
  nodes: Set<Hash>;
  /** Variables whose value is in the closure (excluding orphaned vars). */
  vars: Variable[];
  /** Tags grouped by their target hash (only targets in the closure). */
  tags: Map<Hash, Tag[]>;
};

/**
 * Compute the transitive closure starting from a set of root CAS hashes.
 *
 * The closure is a self-contained subset of a Store: every node it points
 * at via `ocas_ref` fields, every schema it depends on (the meta-schema
 * chain), and every template variable referencing a schema in the closure
 * is included.
 *
 * Variables that point at hashes in the closure (after node and template
 * walks) are returned. Tags whose target is in the closure are returned.
 *
 * Roots that do not exist in the store are silently skipped — callers
 * (e.g. `exportBundle`) should validate roots beforehand if strictness is
 * required.
 */
export function computeClosure(store: Store, roots: Hash[]): ClosureResult {
  const nodes = new Set<Hash>();

  // Phase 1: walk refs from each root.
  // walk() traverses both ocas_ref payload edges AND node.type,
  // so the entire schema chain is reached automatically.
  for (const root of roots) {
    if (!store.cas.has(root)) continue;
    walk(store, root, (hash) => {
      nodes.add(hash);
    });
  }

  // Phase 2: collect template variables for each schema in the closure.
  // Templates are stored as `@ocas/template/text/<schema-hash>` variables.
  // If a template exists for a schema in the closure, walk its content too.
  const templateVars: Variable[] = [];
  // Snapshot existing schema list — we may add nodes during template walks
  const initialNodes = [...nodes];
  for (const hash of initialNodes) {
    const templateName = `@ocas/template/text/${hash}`;
    const variants = store.var.list({ exactName: templateName });
    for (const variant of variants) {
      templateVars.push(variant);
      walk(store, variant.value, (h) => {
        nodes.add(h);
      });
    }
  }

  // Phase 3: collect variables whose value is in the closure. Template
  // variables are already collected; deduplicate.
  const varKey = (v: Variable): string => `${v.name}\u0000${v.schema}`;
  const seenVars = new Set<string>(templateVars.map(varKey));
  const vars: Variable[] = [...templateVars];
  const allVars = store.var.list();
  for (const v of allVars) {
    if (!nodes.has(v.value)) continue;
    const key = varKey(v);
    if (seenVars.has(key)) continue;
    seenVars.add(key);
    vars.push(v);
  }

  // Phase 4: collect tags for each node in the closure.
  const tags = new Map<Hash, Tag[]>();
  for (const hash of nodes) {
    const tagList = store.tag.tags(hash);
    if (tagList.length > 0) {
      tags.set(hash, tagList);
    }
  }

  return { nodes, vars, tags };
}
