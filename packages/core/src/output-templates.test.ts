import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "./bootstrap.js";
import { registerOutputTemplates } from "./output-templates.js";
import { createMemoryStore } from "./store.js";
import type { Store } from "./types.js";
import type { VariableStore } from "./variable-store.js";
import { createVariableStore } from "./variable-store.js";

const OUTPUT_ALIASES = [
  "@ocas/output/put",
  "@ocas/output/get",
  "@ocas/output/has",
  "@ocas/output/hash",
  "@ocas/output/verify",
  "@ocas/output/refs",
  "@ocas/output/walk",
  "@ocas/output/list",
  "@ocas/output/var-set",
  "@ocas/output/var-get",
  "@ocas/output/var-delete",
  "@ocas/output/var-tag",
  "@ocas/output/var-list",
  "@ocas/output/var-history",
  "@ocas/output/template-set",
  "@ocas/output/template-get",
  "@ocas/output/template-list",
  "@ocas/output/template-delete",
  "@ocas/output/gc",
] as const;

describe("registerOutputTemplates", () => {
  let store: Store;
  let varStore: VariableStore;
  let tempDir: string;

  afterEach(async () => {
    varStore.close();
    await rm(tempDir, { recursive: true });
  });

  test("registers a template for every @ocas/output/* schema", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ocas-tmpl-"));
    store = createMemoryStore();
    await bootstrap(store);
    varStore = createVariableStore(join(tempDir, "vars.db"), store);

    const registered = await registerOutputTemplates(store, varStore);

    expect(Object.keys(registered)).toHaveLength(19);

    for (const alias of OUTPUT_ALIASES) {
      expect(registered).toHaveProperty(alias);
    }
  });

  test("each template is retrievable via @ocas/template/text/<hash>", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ocas-tmpl-"));
    store = createMemoryStore();
    const aliases = await bootstrap(store);
    varStore = createVariableStore(join(tempDir, "vars.db"), store);

    await registerOutputTemplates(store, varStore);

    const stringHash = aliases["@ocas/string"];
    if (!stringHash) throw new Error("@ocas/string not found");

    for (const alias of OUTPUT_ALIASES) {
      const schemaHash = aliases[alias];
      if (!schemaHash) throw new Error(`${alias} not found`);

      const varName = `@ocas/template/text/${schemaHash}`;
      const variable = varStore.get(varName, stringHash);
      if (variable === null) throw new Error(`Variable ${varName} not found`);

      const templateNode = store.get(variable.value);
      if (templateNode === null)
        throw new Error(`Template node ${variable.value} not found`);
      expect(typeof templateNode.payload).toBe("string");
    }
  });

  test("is idempotent — safe to call multiple times", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ocas-tmpl-"));
    store = createMemoryStore();
    await bootstrap(store);
    varStore = createVariableStore(join(tempDir, "vars.db"), store);

    const first = await registerOutputTemplates(store, varStore);
    const second = await registerOutputTemplates(store, varStore);

    expect(first).toEqual(second);
  });

  test("@ocas/output/put template contains payload reference", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ocas-tmpl-"));
    store = createMemoryStore();
    const aliases = await bootstrap(store);
    varStore = createVariableStore(join(tempDir, "vars.db"), store);

    await registerOutputTemplates(store, varStore);

    const putHash = aliases["@ocas/output/put"];
    if (!putHash) throw new Error("@ocas/output/put not found");
    const stringHash = aliases["@ocas/string"];
    if (!stringHash) throw new Error("@ocas/string not found");

    const variable = varStore.get(`@ocas/template/text/${putHash}`, stringHash);
    if (variable === null)
      throw new Error("@ocas/output/put template variable not found");

    const templateNode = store.get(variable.value);
    if (templateNode === null) throw new Error("Template node not found");
    expect(templateNode.payload).toBe("{{ payload }}");
  });
});
