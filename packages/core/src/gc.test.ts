import { describe, expect, test } from "vitest";
import { bootstrap } from "./bootstrap.js";
import { gc } from "./gc.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";

describe("GC - Variable Model Refactoring", () => {
  test("GC preserves variable-referenced nodes", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const schemaHash = putSchema(store, schema);

    const hashRef = store.cas.put(schemaHash, { name: "referenced" });
    const hashOrphan = store.cas.put(schemaHash, { name: "orphan" });

    store.var.set("@test/config", hashRef);

    const stats = gc(store);

    expect(store.cas.has(hashRef)).toBe(true);
    expect(store.cas.has(hashOrphan)).toBe(false);
    expect(stats.scanned).toBeGreaterThanOrEqual(1);
    expect(stats.collected).toBeGreaterThanOrEqual(1);
  });

  test("GC preserves nodes from variables with same name, different schemas", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schemaA = { type: "object", properties: { x: { type: "number" } } };
    const schemaB = { type: "object", properties: { y: { type: "string" } } };
    const schemaAHash = putSchema(store, schemaA);
    const schemaBHash = putSchema(store, schemaB);

    const hashA = store.cas.put(schemaAHash, { x: 42 });
    const hashB = store.cas.put(schemaBHash, { y: "hello" });
    const hashOrphan = store.cas.put(schemaAHash, { x: 99 });

    store.var.set("@test/config", hashA);
    store.var.set("@test/config", hashB);

    gc(store);

    expect(store.cas.has(hashA)).toBe(true);
    expect(store.cas.has(hashB)).toBe(true);
    expect(store.cas.has(hashOrphan)).toBe(false);
  });

  test("GC removes nodes after variable deletion", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const schemaHash = putSchema(store, schema);

    const hashRef = store.cas.put(schemaHash, { name: "referenced" });

    store.var.set("@test/config", hashRef);
    store.var.remove("@test/config", schemaHash);

    gc(store);

    expect(store.cas.has(hashRef)).toBe(false);
  });

  test("GC is global across all variables", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schemaA = { type: "object", properties: { x: { type: "number" } } };
    const schemaB = { type: "object", properties: { y: { type: "string" } } };
    const schemaAHash = putSchema(store, schemaA);
    const schemaBHash = putSchema(store, schemaB);

    const hash1 = store.cas.put(schemaAHash, { x: 1 });
    const hash2 = store.cas.put(schemaAHash, { x: 2 });
    const hash3 = store.cas.put(schemaBHash, { y: "a" });
    const hashOrphan = store.cas.put(schemaAHash, { x: 999 });

    store.var.set("@test/uwf.thread", hash1);
    store.var.set("@test/uwf.workflow", hash2);
    store.var.set("@test/app.config", hash3);

    gc(store);

    expect(store.cas.has(hash1)).toBe(true);
    expect(store.cas.has(hash2)).toBe(true);
    expect(store.cas.has(hash3)).toBe(true);
    expect(store.cas.has(hashOrphan)).toBe(false);
  });

  test("GC integration with refactored variable store", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const schemaA = { type: "object", properties: { x: { type: "number" } } };
    const schemaB = { type: "object", properties: { y: { type: "string" } } };
    const schemaAHash = putSchema(store, schemaA);
    const schemaBHash = putSchema(store, schemaB);

    const hashA1 = store.cas.put(schemaAHash, { x: 1 });
    const hashA2 = store.cas.put(schemaAHash, { x: 2 });
    const hashB = store.cas.put(schemaBHash, { y: "hello" });
    store.cas.put(schemaAHash, { x: 999 });
    store.cas.put(schemaBHash, { y: "orphan" });

    store.var.set("@test/var1", hashA1);
    store.var.set("@test/var2", hashA2);
    store.var.set("@test/var3", hashB);

    gc(store);
    expect(store.cas.has(hashA1)).toBe(true);
    expect(store.cas.has(hashA2)).toBe(true);
    expect(store.cas.has(hashB)).toBe(true);

    store.var.remove("@test/var2", schemaAHash);

    gc(store);
    expect(store.cas.has(hashA1)).toBe(true);
    expect(store.cas.has(hashA2)).toBe(false);
    expect(store.cas.has(hashB)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Suite B: gc end-to-end with oneOf step chains (issue #93)
// ──────────────────────────────────────────────────────────────────────────────
describe("GC - oneOf step chain preservation (#93)", () => {
  test("B.1 preserves a 3-step chain joined by oneOf nullable prev", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const stepSchema = putSchema(store, {
      type: "object",
      properties: {
        payload: { type: "string" },
        prev: {
          oneOf: [{ type: "null" }, { type: "string", format: "ocas_ref" }],
        },
      },
    });

    const step1 = store.cas.put(stepSchema, { payload: "a", prev: null });
    const step2 = store.cas.put(stepSchema, { payload: "b", prev: step1 });
    const step3 = store.cas.put(stepSchema, { payload: "c", prev: step2 });
    const orphanStep = store.cas.put(stepSchema, {
      payload: "orphan",
      prev: null,
    });

    store.var.set("@test/thread/head", step3);

    gc(store);

    expect(store.cas.has(step1)).toBe(true);
    expect(store.cas.has(step2)).toBe(true);
    expect(store.cas.has(step3)).toBe(true);
    expect(store.cas.has(stepSchema)).toBe(true);
    expect(store.cas.has(orphanStep)).toBe(false);
  });

  test("B.2 preserves a chain that mixes oneOf detail refs", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const detailSchema = putSchema(store, {
      type: "object",
      properties: { info: { type: "string" } },
    });
    const stepSchema = putSchema(store, {
      type: "object",
      properties: {
        prev: {
          oneOf: [{ type: "null" }, { type: "string", format: "ocas_ref" }],
        },
        detail: {
          oneOf: [{ type: "null" }, { type: "string", format: "ocas_ref" }],
        },
      },
    });

    const detail1 = store.cas.put(detailSchema, { info: "d1" });
    const detail2 = store.cas.put(detailSchema, { info: "d2" });
    const step1 = store.cas.put(stepSchema, {
      prev: null,
      detail: detail1,
    });
    const step2 = store.cas.put(stepSchema, {
      prev: step1,
      detail: detail2,
    });

    store.var.set("@test/thread/head", step2);

    gc(store);

    expect(store.cas.has(step1)).toBe(true);
    expect(store.cas.has(step2)).toBe(true);
    expect(store.cas.has(detail1)).toBe(true);
    expect(store.cas.has(detail2)).toBe(true);
  });

  test("B.3 preserves a workflow node referenced via oneOf from a step", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const workflowSchema = putSchema(store, {
      type: "object",
      properties: { name: { type: "string" } },
    });
    const stepSchema = putSchema(store, {
      type: "object",
      properties: {
        workflow: {
          oneOf: [{ type: "null" }, { type: "string", format: "ocas_ref" }],
        },
      },
    });

    const workflowNode = store.cas.put(workflowSchema, {
      name: "solve-issue",
    });
    const step = store.cas.put(stepSchema, { workflow: workflowNode });

    store.var.set("@test/thread/head", step);
    store.var.set("@uwf/registry/solve-issue", workflowNode);

    gc(store);

    expect(store.cas.has(step)).toBe(true);
    expect(store.cas.has(workflowNode)).toBe(true);
  });

  test("B.4 regression: existing anyOf traversal still works", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const childSchema = putSchema(store, { type: "string" });
    const parentSchema = putSchema(store, {
      type: "object",
      properties: {
        child: {
          anyOf: [{ type: "null" }, { type: "string", format: "ocas_ref" }],
        },
      },
    });

    const child = store.cas.put(childSchema, "child-value");
    const parent = store.cas.put(parentSchema, { child });

    store.var.set("@test/parent", parent);

    gc(store);

    expect(store.cas.has(parent)).toBe(true);
    expect(store.cas.has(child)).toBe(true);
  });

  test("B.5 reports correct stats with oneOf chains", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const stepSchema = putSchema(store, {
      type: "object",
      properties: {
        payload: { type: "string" },
        prev: {
          oneOf: [{ type: "null" }, { type: "string", format: "ocas_ref" }],
        },
      },
    });

    const step1 = store.cas.put(stepSchema, { payload: "a", prev: null });
    const step2 = store.cas.put(stepSchema, { payload: "b", prev: step1 });
    const step3 = store.cas.put(stepSchema, { payload: "c", prev: step2 });
    store.cas.put(stepSchema, { payload: "orphan", prev: null });

    store.var.set("@test/thread/head", step3);

    const stats = gc(store);

    expect(stats.collected).toBe(1);
    expect(stats.reachable).toBeGreaterThanOrEqual(4);
    expect(stats.scanned).toBeGreaterThanOrEqual(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Suite C: gc preserves template content for reachable schemas (issue #93)
// ──────────────────────────────────────────────────────────────────────────────
describe("GC - template content preservation (#93)", () => {
  test("C.1 preserves @ocas/template/text/<schema> content when schema is reachable", async () => {
    const store = createMemoryStore();
    const aliases = bootstrap(store);
    const stringHash = aliases["@ocas/string"] as string;

    const schemaA = putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const nodeA = store.cas.put(schemaA, { x: 42 });
    store.var.set("@test/a", nodeA);

    const tplA = store.cas.put(stringHash, "rendered: {{x}}");
    store.var.set(`@ocas/template/text/${schemaA}`, tplA);

    gc(store);

    expect(store.cas.has(tplA)).toBe(true);

    const tplVar = store.var.get(`@ocas/template/text/${schemaA}`);
    expect(tplVar).not.toBeNull();
    expect(tplVar?.value).toBe(tplA);
  });

  test("C.2 removes orphan template content for an unreachable schema", async () => {
    const store = createMemoryStore();
    const aliases = bootstrap(store);
    const stringHash = aliases["@ocas/string"] as string;

    const schemaA = putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    // Note: do NOT bind any variable to a node typed by schemaA — schemaA is
    // unreachable as a typeHash of any reachable node.

    const otherSchema = putSchema(store, { type: "string" });
    const otherNode = store.cas.put(otherSchema, "other");
    store.var.set("@test/other", otherNode);

    const tplA = store.cas.put(stringHash, "rendered: {{x}}");
    store.var.set(`@ocas/template/text/${schemaA}`, tplA);

    gc(store);

    expect(store.cas.has(tplA)).toBe(false);
  });
});
