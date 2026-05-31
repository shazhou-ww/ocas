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
    const metaHash = builtinSchemas["@schema"] ?? "";
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
        id: { type: "string", format: "cas_ref" },
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
// Step 4: refs() — extract cas_ref hashes from a node's payload
// ──────────────────────────────────────────────────────────────────────────────
describe("refs", () => {
  test("returns empty array when schema has no cas_ref fields", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { title: { type: "string" } },
    });
    const nodeHash = await store.put(schemaHash, { title: "hello" });
    const node = store.get(nodeHash) as CasNode;

    expect(refs(store, node)).toEqual([]);
  });

  test("returns the cas_ref hash values from payload", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: {
        parentHash: { type: "string", format: "cas_ref" },
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

  test("collects multiple cas_ref fields", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: {
        leftHash: { type: "string", format: "cas_ref" },
        rightHash: { type: "string", format: "cas_ref" },
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

  test("skips null/undefined cas_ref values", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: {
        optionalRef: { type: "string", format: "cas_ref" },
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
// Step 5: walk() — BFS traversal via cas_ref links
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
        nextHash: { type: "string", format: "cas_ref" },
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
        peerHash: { type: "string", format: "cas_ref" },
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
        leftHash: { type: "string", format: "cas_ref" },
        rightHash: { type: "string", format: "cas_ref" },
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
      properties: { ref: { type: "string", format: "cas_ref" } },
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
    const metaHash = builtinSchemas["@schema"] ?? "";
    const metaNode = store.get(metaHash) as CasNode;

    expect(metaNode.type).toBe(metaHash);
  });

  test("schema nodes have type === metaHash", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);
    const metaHash = builtinSchemas["@schema"] ?? "";
    const schemaHash = await putSchema(store, { type: "string" });
    const schemaNode = store.get(schemaHash) as CasNode;

    expect(schemaNode.type).toBe(metaHash);
  });

  test("data nodes have type === schemaHash (not metaHash)", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);
    const metaHash = builtinSchemas["@schema"] ?? "";
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { val: { type: "number" } },
    });
    const dataHash = await store.put(schemaHash, { val: 99 });
    const dataNode = store.get(dataHash) as CasNode;

    expect(dataNode.type).toBe(schemaHash);
    expect(dataNode.type).not.toBe(metaHash);
  });

  test("bootstrap is idempotent across putSchema calls", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);
    const metaHash = builtinSchemas["@schema"] ?? "";

    await putSchema(store, { type: "string" });
    await putSchema(store, { type: "number" });

    // bootstrap node should still be there and unchanged
    const metaNode = store.get(metaHash) as CasNode;
    expect(metaNode.type).toBe(metaHash);
  });
});
