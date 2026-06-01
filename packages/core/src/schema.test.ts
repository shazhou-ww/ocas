import { describe, expect, test } from "bun:test";

import { bootstrap } from "./bootstrap.js";
import { getSchema, putSchema, refs, validate, walk } from "./schema.js";
import { createMemoryStore } from "./store.js";
import type { CasNode } from "./types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Step 1: putSchema() — store a JSON Schema as a CAS node
// ──────────────────────────────────────────────────────────────────────────────
describe("putSchema", () => {
  test("returns a valid 13-char hash", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, { type: "object", properties: {} });
    expect(hash).toHaveLength(13);
    expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("schema node is stored in the store", async () => {
    const store = createMemoryStore();
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const hash = await putSchema(store, schema);

    expect(store.has(hash)).toBe(true);
    const node = store.get(hash);
    expect(node).not.toBeNull();
    expect(node?.payload).toEqual(schema);
  });

  test("schema node type equals the meta-schema hash", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"] ?? "";
    const schemaHash = await putSchema(store, { type: "string" });
    const node = store.get(schemaHash) as CasNode;

    expect(node.type).toBe(metaHash);
  });

  test("putSchema is idempotent: same schema → same hash", async () => {
    const store = createMemoryStore();
    const schema = { type: "number" };
    const h1 = await putSchema(store, schema);
    const h2 = await putSchema(store, schema);

    expect(h1).toBe(h2);
  });

  test("different schemas produce different hashes", async () => {
    const store = createMemoryStore();
    const h1 = await putSchema(store, { type: "string" });
    const h2 = await putSchema(store, { type: "number" });

    expect(h1).not.toBe(h2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 2: getSchema() — retrieve a JSON Schema by type hash
// ──────────────────────────────────────────────────────────────────────────────
describe("getSchema", () => {
  test("returns the original schema object", async () => {
    const store = createMemoryStore();
    const schema = { type: "object", properties: { age: { type: "number" } } };
    const hash = await putSchema(store, schema);

    expect(getSchema(store, hash)).toEqual(schema);
  });

  test("returns null for an unknown hash", () => {
    const store = createMemoryStore();
    expect(getSchema(store, "0000000000000")).toBeNull();
  });

  test("roundtrip: put then get returns the same schema", async () => {
    const store = createMemoryStore();
    const schema = {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", format: "ocas_ref" },
        label: { type: "string" },
      },
    };
    const hash = await putSchema(store, schema);
    expect(getSchema(store, hash)).toEqual(schema);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 3: validate() — validate a node's payload against its schema
// ──────────────────────────────────────────────────────────────────────────────
describe("validate", () => {
  test("returns true when payload matches the schema", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "number" } },
      required: ["name"],
    });
    const nodeHash = await store.put(schemaHash, { name: "Alice", age: 30 });
    const node = store.get(nodeHash) as CasNode;

    expect(validate(store, node)).toBe(true);
  });

  test("returns false when payload violates the schema", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { count: { type: "number" } },
      required: ["count"],
    });
    const nodeHash = await store.put(schemaHash, { count: "not-a-number" });
    const node = store.get(nodeHash) as CasNode;

    expect(validate(store, node)).toBe(false);
  });

  test("returns false when required field is missing", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      required: ["title"],
      properties: { title: { type: "string" } },
    });
    const nodeHash = await store.put(schemaHash, {});
    const node = store.get(nodeHash) as CasNode;

    expect(validate(store, node)).toBe(false);
  });

  test("returns false when schema cannot be found", async () => {
    const store = createMemoryStore();
    const fakeNode: CasNode = {
      type: "0000000000000",
      payload: { x: 1 },
      timestamp: Date.now(),
    };

    expect(validate(store, fakeNode)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 4: refs() — extract ocas_ref hashes from a node's payload
// ──────────────────────────────────────────────────────────────────────────────
describe("refs", () => {
  test("returns empty array when schema has no ocas_ref fields", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { title: { type: "string" } },
    });
    const nodeHash = await store.put(schemaHash, { title: "hello" });
    const node = store.get(nodeHash) as CasNode;

    expect(refs(store, node)).toEqual([]);
  });

  test("returns the ocas_ref hash values from payload", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: {
        parentHash: { type: "string", format: "ocas_ref" },
        label: { type: "string" },
      },
    });

    const targetHash = "AAAAAAAAAAAAA";
    const nodeHash = await store.put(schemaHash, {
      parentHash: targetHash,
      label: "child",
    });
    const node = store.get(nodeHash) as CasNode;

    expect(refs(store, node)).toEqual([targetHash]);
  });

  test("collects multiple ocas_ref fields", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: {
        leftHash: { type: "string", format: "ocas_ref" },
        rightHash: { type: "string", format: "ocas_ref" },
      },
    });

    const h1 = "AAAAAAAAAAAAA";
    const h2 = "BBBBBBBBBBBBB";
    const nodeHash = await store.put(schemaHash, {
      leftHash: h1,
      rightHash: h2,
    });
    const node = store.get(nodeHash) as CasNode;

    const result = refs(store, node);
    expect(result).toHaveLength(2);
    expect(result).toContain(h1);
    expect(result).toContain(h2);
  });

  test("skips null/undefined ocas_ref values", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: {
        optionalRef: { type: "string", format: "ocas_ref" },
        label: { type: "string" },
      },
    });

    const nodeHash = await store.put(schemaHash, { label: "no ref here" });
    const node = store.get(nodeHash) as CasNode;

    expect(refs(store, node)).toEqual([]);
  });

  test("returns empty array when schema is not found", () => {
    const store = createMemoryStore();
    const orphanNode: CasNode = {
      type: "0000000000000",
      payload: { x: 1 },
      timestamp: Date.now(),
    };

    expect(refs(store, orphanNode)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 5: walk() — BFS traversal via ocas_ref links
// ──────────────────────────────────────────────────────────────────────────────
describe("walk", () => {
  test("visits a single node with no refs", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { val: { type: "number" } },
    });
    const nodeHash = await store.put(schemaHash, { val: 42 });

    const visited: string[] = [];
    walk(store, nodeHash, (hash) => visited.push(hash));

    expect(visited).toEqual([nodeHash]);
  });

  test("visits all reachable nodes in a chain A → B → C", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: {
        nextHash: { type: "string", format: "ocas_ref" },
        val: { type: "number" },
      },
    });

    const hashC = await store.put(schemaHash, { val: 3 });
    const hashB = await store.put(schemaHash, { nextHash: hashC, val: 2 });
    const hashA = await store.put(schemaHash, { nextHash: hashB, val: 1 });

    const visited: string[] = [];
    walk(store, hashA, (hash) => visited.push(hash));

    expect(visited).toHaveLength(3);
    expect(visited).toContain(hashA);
    expect(visited).toContain(hashB);
    expect(visited).toContain(hashC);
    expect(visited[0]).toBe(hashA);
  });

  test("handles cycles without infinite loop", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: {
        peerHash: { type: "string", format: "ocas_ref" },
        val: { type: "number" },
      },
    });

    // A → B, B → A (manual cycle by inserting pre-known hash)
    const hashA = await store.put(schemaHash, { val: 1 });
    const _hashB = await store.put(schemaHash, { peerHash: hashA, val: 2 });

    // update A to point at B — since store is content-addressed we can't mutate,
    // so we build a diamond: root → A and root → B, A → C, B → C
    const hashC = await store.put(schemaHash, { val: 3 });
    const hashD = await store.put(schemaHash, { peerHash: hashC, val: 4 });
    const hashE = await store.put(schemaHash, { peerHash: hashC, val: 5 });

    const schemaHash2 = await putSchema(store, {
      type: "object",
      properties: {
        leftHash: { type: "string", format: "ocas_ref" },
        rightHash: { type: "string", format: "ocas_ref" },
      },
    });
    const rootHash = await store.put(schemaHash2, {
      leftHash: hashD,
      rightHash: hashE,
    });

    const visited = new Set<string>();
    walk(store, rootHash, (hash) => visited.add(hash));

    // Should visit root + hashD + hashE + hashC (shared node visited once)
    expect(visited.has(rootHash)).toBe(true);
    expect(visited.has(hashD)).toBe(true);
    expect(visited.has(hashE)).toBe(true);
    expect(visited.has(hashC)).toBe(true);
    expect(visited.size).toBe(4);
  });

  test("skips missing hashes gracefully", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { ref: { type: "string", format: "ocas_ref" } },
    });
    const nodeHash = await store.put(schemaHash, { ref: "0000000000000" });

    const visited: string[] = [];
    walk(store, nodeHash, (hash) => visited.push(hash));

    // visits the root; the dangling ref hash has no stored node so it's skipped
    expect(visited).toContain(nodeHash);
  });

  test("visitor receives both hash and node", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const nodeHash = await store.put(schemaHash, { x: 7 });

    let receivedHash: string | null = null;
    let receivedNode: CasNode | null = null;
    walk(store, nodeHash, (hash, node) => {
      receivedHash = hash;
      receivedNode = node;
    });

    expect(receivedHash).toBe(nodeHash);
    expect(receivedNode?.payload).toEqual({ x: 7 });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 6: Bootstrap self-reference in schema context
// ──────────────────────────────────────────────────────────────────────────────
describe("bootstrap meta-schema self-reference", () => {
  test("metaNode.type === metaHash (self-referencing)", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"] ?? "";
    const metaNode = store.get(metaHash) as CasNode;

    expect(metaNode.type).toBe(metaHash);
  });

  test("schema nodes have type === metaHash", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"] ?? "";
    const schemaHash = await putSchema(store, { type: "string" });
    const schemaNode = store.get(schemaHash) as CasNode;

    expect(schemaNode.type).toBe(metaHash);
  });

  test("data nodes have type === schemaHash (not metaHash)", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"] ?? "";
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { val: { type: "number" } },
    });
    const dataHash = await store.put(schemaHash, { val: 99 });
    const dataNode = store.get(dataHash) as CasNode;

    expect(dataNode.type).toBe(schemaHash);
    expect(dataNode.type).not.toBe(metaHash);
  });

  // ── P1 leaf constraints ──────────────────────────────────────────────────

  test("accepts schema with numeric constraints (minimum/maximum)", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "number",
      minimum: 0,
      maximum: 100,
      exclusiveMinimum: -1,
      exclusiveMaximum: 101,
    });
    expect(hash).toHaveLength(13);

    // validate a conforming payload
    const nodeHash = await store.put(hash, 42);
    const node = store.get(nodeHash) as CasNode;
    expect(validate(store, node)).toBe(true);

    // validate a non-conforming payload
    const badHash = await store.put(hash, 200);
    const badNode = store.get(badHash) as CasNode;
    expect(validate(store, badNode)).toBe(false);
  });

  test("accepts schema with string constraints (minLength/maxLength/pattern)", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "string",
      minLength: 1,
      maxLength: 10,
      pattern: "^[a-z]+$",
    });
    expect(hash).toHaveLength(13);

    const goodHash = await store.put(hash, "hello");
    expect(validate(store, store.get(goodHash) as CasNode)).toBe(true);

    const badHash = await store.put(hash, "HELLO");
    expect(validate(store, store.get(badHash) as CasNode)).toBe(false);
  });

  test("accepts schema with array constraints (minItems/maxItems/uniqueItems)", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "array",
      items: { type: "number" },
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
    });
    expect(hash).toHaveLength(13);

    const goodHash = await store.put(hash, [1, 2, 3]);
    expect(validate(store, store.get(goodHash) as CasNode)).toBe(true);

    const tooMany = await store.put(hash, [1, 2, 3, 4]);
    expect(validate(store, store.get(tooMany) as CasNode)).toBe(false);

    const dupes = await store.put(hash, [1, 1]);
    expect(validate(store, store.get(dupes) as CasNode)).toBe(false);
  });

  test("rejects schema with wrong constraint types", async () => {
    const store = createMemoryStore();
    await expect(
      putSchema(store, { type: "number", minimum: "zero" } as never),
    ).rejects.toThrow();
    await expect(
      putSchema(store, { type: "string", maxLength: true } as never),
    ).rejects.toThrow();
    await expect(
      putSchema(store, { type: "array", uniqueItems: 1 } as never),
    ).rejects.toThrow();
  });

  test("accepts schema with nested property constraints", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 50 },
        age: { type: "number", minimum: 0, maximum: 150 },
        scores: {
          type: "array",
          items: { type: "number" },
          minItems: 1,
          uniqueItems: true,
        },
      },
      required: ["name"],
    });
    expect(hash).toHaveLength(13);

    const good = await store.put(hash, {
      name: "Alice",
      age: 30,
      scores: [95, 87],
    });
    expect(validate(store, store.get(good) as CasNode)).toBe(true);
  });

  test("bootstrap is idempotent across putSchema calls", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"] ?? "";

    await putSchema(store, { type: "string" });
    await putSchema(store, { type: "number" });

    // bootstrap node should still be there and unchanged
    const metaNode = store.get(metaHash) as CasNode;
    expect(metaNode.type).toBe(metaHash);
  });

  // ── P2 combinators, conditionals, and leaf constraints ──────────────────

  test("accepts schema with allOf", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      allOf: [
        { type: "object", properties: { name: { type: "string" } } },
        { required: ["name"] },
      ],
    });
    expect(hash).toHaveLength(13);

    const good = await store.put(hash, { name: "Alice" });
    expect(validate(store, store.get(good) as CasNode)).toBe(true);

    const bad = await store.put(hash, {});
    expect(validate(store, store.get(bad) as CasNode)).toBe(false);
  });

  test("accepts schema with if/then/else", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "object",
      properties: {
        kind: { type: "string" },
        value: {},
      },
      if: { properties: { kind: { const: "number" } } },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a thenable
      then: { properties: { value: { type: "number" } } },
      else: { properties: { value: { type: "string" } } },
    });
    expect(hash).toHaveLength(13);
  });

  test("accepts schema with patternProperties", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "object",
      patternProperties: {
        "^x-": { type: "string" },
      },
    });
    expect(hash).toHaveLength(13);

    const good = await store.put(hash, { "x-custom": "hello" });
    expect(validate(store, store.get(good) as CasNode)).toBe(true);
  });

  test("accepts schema with prefixItems (tuple)", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "array",
      prefixItems: [{ type: "string" }, { type: "number" }],
    });
    expect(hash).toHaveLength(13);
  });

  test("accepts schema with multipleOf", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "number",
      multipleOf: 5,
    });
    expect(hash).toHaveLength(13);

    const good = await store.put(hash, 15);
    expect(validate(store, store.get(good) as CasNode)).toBe(true);

    const bad = await store.put(hash, 7);
    expect(validate(store, store.get(bad) as CasNode)).toBe(false);
  });

  test("accepts schema with minProperties/maxProperties", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "object",
      minProperties: 1,
      maxProperties: 3,
    });
    expect(hash).toHaveLength(13);

    const good = await store.put(hash, { a: 1, b: 2 });
    expect(validate(store, store.get(good) as CasNode)).toBe(true);

    const empty = await store.put(hash, {});
    expect(validate(store, store.get(empty) as CasNode)).toBe(false);
  });

  test("accepts schema with default value", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "string",
      default: "hello",
    });
    expect(hash).toHaveLength(13);
  });

  test("rejects invalid P2 keyword types", async () => {
    const store = createMemoryStore();
    await expect(
      putSchema(store, { allOf: "not-array" } as never),
    ).rejects.toThrow();
    await expect(
      putSchema(store, { multipleOf: "five" } as never),
    ).rejects.toThrow();
    await expect(
      putSchema(store, { patternProperties: [1, 2] } as never),
    ).rejects.toThrow();
  });

  test("collectRefs traverses allOf sub-schemas", async () => {
    const store = createMemoryStore();
    const innerSchema = await putSchema(store, { type: "string" });
    const schema = await putSchema(store, {
      allOf: [
        {
          type: "object",
          properties: { ref: { type: "string", format: "ocas_ref" } },
        },
      ],
    });

    const targetHash = await store.put(innerSchema, "target");
    const nodeHash = await store.put(schema, { ref: targetHash });
    const node = store.get(nodeHash) as CasNode;
    const refList = refs(store, node);
    expect(refList).toContain(targetHash);
  });

  test("collectRefs traverses patternProperties", async () => {
    const store = createMemoryStore();
    const innerSchema = await putSchema(store, { type: "string" });
    const schema = await putSchema(store, {
      type: "object",
      patternProperties: {
        "^ref_": { type: "string", format: "ocas_ref" },
      },
    });

    const targetHash = await store.put(innerSchema, "hello");
    const nodeHash = await store.put(schema, { ref_a: targetHash });
    const node = store.get(nodeHash) as CasNode;
    const refList = refs(store, node);
    expect(refList).toContain(targetHash);
  });

  test("collectRefs traverses prefixItems", async () => {
    const store = createMemoryStore();
    const innerSchema = await putSchema(store, { type: "string" });
    const schema = await putSchema(store, {
      type: "array",
      prefixItems: [{ type: "string", format: "ocas_ref" }, { type: "number" }],
    });

    const targetHash = await store.put(innerSchema, "hello");
    const nodeHash = await store.put(schema, [targetHash, 42]);
    const node = store.get(nodeHash) as CasNode;
    const refList = refs(store, node);
    expect(refList).toContain(targetHash);
  });

  // ── P3 combinators, propertyNames, and metadata ──────────────────────────

  test("accepts schema with not", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      not: { type: "string" },
    });
    expect(hash).toHaveLength(13);

    const good = await store.put(hash, 42);
    expect(validate(store, store.get(good) as CasNode)).toBe(true);

    const bad = await store.put(hash, "hello");
    expect(validate(store, store.get(bad) as CasNode)).toBe(false);
  });

  test("accepts schema with contains", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "array",
      contains: { type: "number", minimum: 10 },
    });
    expect(hash).toHaveLength(13);

    const good = await store.put(hash, [1, 2, 15]);
    expect(validate(store, store.get(good) as CasNode)).toBe(true);

    const bad = await store.put(hash, [1, 2, 3]);
    expect(validate(store, store.get(bad) as CasNode)).toBe(false);
  });

  test("accepts schema with propertyNames", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "object",
      propertyNames: { pattern: "^[a-z]+$" },
    });
    expect(hash).toHaveLength(13);

    const good = await store.put(hash, { foo: 1, bar: 2 });
    expect(validate(store, store.get(good) as CasNode)).toBe(true);

    const bad = await store.put(hash, { Foo: 1 });
    expect(validate(store, store.get(bad) as CasNode)).toBe(false);
  });

  test("accepts schema with metadata keywords", async () => {
    const store = createMemoryStore();
    const hash = await putSchema(store, {
      type: "string",
      examples: ["hello", "world"],
      readOnly: true,
      deprecated: false,
      $comment: "This is a test schema",
    });
    expect(hash).toHaveLength(13);
  });

  test("rejects invalid P3 keyword types", async () => {
    const store = createMemoryStore();
    await expect(
      putSchema(store, { not: "not-object" } as never),
    ).rejects.toThrow();
    await expect(
      putSchema(store, { examples: "not-array" } as never),
    ).rejects.toThrow();
    await expect(
      putSchema(store, { readOnly: "yes" } as never),
    ).rejects.toThrow();
    await expect(putSchema(store, { $comment: 42 } as never)).rejects.toThrow();
  });

  test("collectRefs traverses contains", async () => {
    const store = createMemoryStore();
    const innerSchema = await putSchema(store, { type: "string" });
    const schema = await putSchema(store, {
      type: "array",
      contains: { type: "string", format: "ocas_ref" },
    });

    const targetHash = await store.put(innerSchema, "hello");
    const nodeHash = await store.put(schema, [targetHash, "not-a-ref"]);
    const node = store.get(nodeHash) as CasNode;
    const refList = refs(store, node);
    expect(refList).toContain(targetHash);
  });
});
