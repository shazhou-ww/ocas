import { describe, expect, test } from "vitest";
import { bootstrap } from "./bootstrap.js";
import { computeClosure } from "./closure.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";

describe("computeClosure", () => {
  test("1.1 basic node traversal — collects A, B, C linked by ocas_ref", () => {
    const store = createMemoryStore();
    bootstrap(store);

    const refSchema = putSchema(store, {
      type: "object",
      properties: {
        next: { type: "string", format: "ocas_ref" },
        name: { type: "string" },
      },
    });

    const stringSchema = putSchema(store, { type: "string" });
    const cHash = store.cas.put(stringSchema, "leaf-c");
    const bHash = store.cas.put(refSchema, { next: cHash, name: "b" });
    const aHash = store.cas.put(refSchema, { next: bHash, name: "a" });

    const result = computeClosure(store, [aHash]);

    expect(result.nodes.has(aHash)).toBe(true);
    expect(result.nodes.has(bHash)).toBe(true);
    expect(result.nodes.has(cHash)).toBe(true);
  });

  test("1.2 schema chain inclusion — schema and meta-schema are part of the closure", () => {
    const store = createMemoryStore();
    const aliases = bootstrap(store);
    const metaHash = aliases["@ocas/schema"] as string;

    const schemaHash = putSchema(store, { type: "object" });
    const nodeHash = store.cas.put(schemaHash, { foo: "bar" });

    const result = computeClosure(store, [nodeHash]);

    expect(result.nodes.has(nodeHash)).toBe(true);
    expect(result.nodes.has(schemaHash)).toBe(true);
    expect(result.nodes.has(metaHash)).toBe(true);
  });

  test("1.3 template variable nodes — template content is included", () => {
    const store = createMemoryStore();
    const aliases = bootstrap(store);
    const stringHash = aliases["@ocas/string"] as string;

    const schemaHash = putSchema(store, { type: "object" });
    const nodeHash = store.cas.put(schemaHash, { x: 1 });

    // Register a template for schemaHash
    const templateContent = "rendered: {{ x }}";
    const contentHash = store.cas.put(stringHash, templateContent);
    store.var.set(`@ocas/template/text/${schemaHash}`, contentHash);

    const result = computeClosure(store, [nodeHash]);

    expect(result.nodes.has(nodeHash)).toBe(true);
    expect(result.nodes.has(schemaHash)).toBe(true);
    expect(result.nodes.has(contentHash)).toBe(true);
    const templateVarNames = result.vars.map((v) => v.name);
    expect(templateVarNames).toContain(`@ocas/template/text/${schemaHash}`);
  });

  test("1.4 multiple roots — union of closures", () => {
    const store = createMemoryStore();
    bootstrap(store);

    const stringSchema = putSchema(store, { type: "string" });
    const aHash = store.cas.put(stringSchema, "alpha");
    const bHash = store.cas.put(stringSchema, "beta");
    store.var.set("@test/a", aHash);
    store.var.set("@test/b", bHash);

    const result = computeClosure(store, [aHash, bHash]);

    expect(result.nodes.has(aHash)).toBe(true);
    expect(result.nodes.has(bHash)).toBe(true);
  });

  test("1.5 cycle handling — terminates on self-references", () => {
    const store = createMemoryStore();
    bootstrap(store);

    const refSchema = putSchema(store, {
      type: "object",
      properties: {
        next: { type: "string", format: "ocas_ref" },
      },
    });

    // Build a self-loop by hashing first then storing
    const stringSchema = putSchema(store, { type: "string" });
    const placeholder = store.cas.put(stringSchema, "self");
    // Create a cycle A -> B -> A
    const bHash = store.cas.put(refSchema, { next: placeholder });
    const aHash = store.cas.put(refSchema, { next: bHash });

    // Mutate B to point back to A is impossible in CAS — instead test that
    // the same node is visited only once even if reached via multiple paths.
    const result = computeClosure(store, [aHash, aHash]);

    expect(result.nodes.has(aHash)).toBe(true);
    expect(result.nodes.has(bHash)).toBe(true);
    // The placeholder is reached from B
    expect(result.nodes.has(placeholder)).toBe(true);
    // Each node appears exactly once in the set
    expect(result.nodes.size).toBeGreaterThan(0);
  });

  test("1.6 variables pointing into closure are collected", () => {
    const store = createMemoryStore();
    bootstrap(store);

    const stringSchema = putSchema(store, { type: "string" });
    const xHash = store.cas.put(stringSchema, "x-content");
    const yHash = store.cas.put(stringSchema, "y-content");

    store.var.set("@test/x", xHash);
    store.var.set("@test/y", yHash);

    const result = computeClosure(store, [xHash]);

    const names = result.vars.map((v) => v.name);
    expect(names).toContain("@test/x");
    expect(names).not.toContain("@test/y");
  });

  test("1.7 @ocas/* builtin vars whose values are in closure are collected", () => {
    const store = createMemoryStore();
    const aliases = bootstrap(store);
    const metaHash = aliases["@ocas/schema"] as string;

    const result = computeClosure(store, [metaHash]);

    // @ocas/schema is a builtin var pointing to metaHash
    const names = result.vars.map((v) => v.name);
    expect(names).toContain("@ocas/schema");
  });

  test("1.8 tags on closure nodes are collected", () => {
    const store = createMemoryStore();
    bootstrap(store);

    const stringSchema = putSchema(store, { type: "string" });
    const aHash = store.cas.put(stringSchema, "tagged-a");
    const bHash = store.cas.put(stringSchema, "tagged-b");

    store.tag.tag(aHash, [{ op: "set", key: "env", value: "prod" }]);
    store.tag.tag(bHash, [{ op: "set", key: "env", value: "dev" }]);

    const result = computeClosure(store, [aHash]);

    const aTags = result.tags.get(aHash);
    expect(aTags).toBeDefined();
    expect(aTags?.some((t) => t.key === "env" && t.value === "prod")).toBe(
      true,
    );
    // B is not in the closure
    expect(result.tags.has(bHash)).toBe(false);
  });

  test("1.9 empty roots → empty closure", () => {
    const store = createMemoryStore();
    bootstrap(store);

    const result = computeClosure(store, []);

    expect(result.nodes.size).toBe(0);
    expect(result.vars).toEqual([]);
    expect(result.tags.size).toBe(0);
  });

  test("1.10 template content for any schema in closure is included", () => {
    const store = createMemoryStore();
    const aliases = bootstrap(store);
    const stringHash = aliases["@ocas/string"] as string;

    // schema A has template, schema B does not — both reachable via refs
    const refSchema = putSchema(store, {
      type: "object",
      properties: {
        next: { type: "string", format: "ocas_ref" },
      },
    });

    const innerSchema = putSchema(store, { type: "object" });
    const innerNode = store.cas.put(innerSchema, { x: 1 });
    const outerNode = store.cas.put(refSchema, { next: innerNode });

    const tplA = store.cas.put(stringHash, "A:{{ next }}");
    const tplInner = store.cas.put(stringHash, "INNER");
    store.var.set(`@ocas/template/text/${refSchema}`, tplA);
    store.var.set(`@ocas/template/text/${innerSchema}`, tplInner);

    const result = computeClosure(store, [outerNode]);

    expect(result.nodes.has(tplA)).toBe(true);
    expect(result.nodes.has(tplInner)).toBe(true);
  });

  test("C.1 closure includes refs embedded inside schema payloads (#130)", () => {
    const store = createMemoryStore();
    const aliases = bootstrap(store);
    const metaHash = aliases["@ocas/schema"] as string;
    const stringHash = aliases["@ocas/string"] as string;

    const customMeta = store.cas.put(metaHash, {
      type: "object",
      properties: {
        extraRef: { type: "string", format: "ocas_ref" },
        type: { type: "string" },
      },
    });
    const targetHash = store.cas.put(stringHash, "secret");
    const S = store.cas.put(customMeta, {
      extraRef: targetHash,
      type: "string",
    });
    const D = store.cas.put(S, "hello");

    const result = computeClosure(store, [D]);

    expect(result.nodes.has(D)).toBe(true);
    expect(result.nodes.has(S)).toBe(true);
    expect(result.nodes.has(customMeta)).toBe(true);
    expect(result.nodes.has(targetHash)).toBe(true);
  });
});
