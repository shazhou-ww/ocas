import { describe, expect, test } from "bun:test";
import { bootstrap } from "./bootstrap.js";
import { registerOutputTemplates } from "./output-templates.js";
import { createMemoryStore } from "./store.js";

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
  test("registers a template for every @ocas/output/* schema", async () => {
    const store = createMemoryStore();
    await bootstrap(store);

    const registered = await registerOutputTemplates(store);

    expect(Object.keys(registered)).toHaveLength(19);

    for (const alias of OUTPUT_ALIASES) {
      expect(registered).toHaveProperty(alias);
    }
  });

  test("each template is retrievable via @ocas/template/text/<hash>", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);

    await registerOutputTemplates(store);

    const stringHash = aliases["@ocas/string"];
    if (!stringHash) throw new Error("@ocas/string not found");

    for (const alias of OUTPUT_ALIASES) {
      const schemaHash = aliases[alias];
      if (!schemaHash) throw new Error(`${alias} not found`);

      const varName = `@ocas/template/text/${schemaHash}`;
      const variable = store.var.get(varName, stringHash);
      if (variable === null) throw new Error(`Variable ${varName} not found`);

      const templateNode = store.cas.get(variable.value);
      if (templateNode === null)
        throw new Error(`Template node ${variable.value} not found`);
      expect(typeof templateNode.payload).toBe("string");
    }
  });

  test("is idempotent — safe to call multiple times", async () => {
    const store = createMemoryStore();
    await bootstrap(store);

    const first = await registerOutputTemplates(store);
    const second = await registerOutputTemplates(store);

    expect(first).toEqual(second);
  });

  test("@ocas/output/put template contains payload reference", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);

    await registerOutputTemplates(store);

    const putHash = aliases["@ocas/output/put"];
    if (!putHash) throw new Error("@ocas/output/put not found");
    const stringHash = aliases["@ocas/string"];
    if (!stringHash) throw new Error("@ocas/string not found");

    const variable = store.var.get(
      `@ocas/template/text/${putHash}`,
      stringHash,
    );
    if (variable === null)
      throw new Error("@ocas/output/put template variable not found");

    const templateNode = store.cas.get(variable.value);
    if (templateNode === null) throw new Error("Template node not found");
    expect(templateNode.payload).toBe("{{ payload }}");
  });
});
