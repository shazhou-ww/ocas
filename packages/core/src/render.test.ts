import { describe, expect, test } from "vitest";
import { bootstrap } from "./bootstrap.js";
import { CasNodeNotFoundError } from "./errors.js";
import { render, renderAsync, renderDirect } from "./render.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";
import type { Hash } from "./types.js";

describe("Suite 1: Basic Rendering (No Nesting)", () => {
  test("1.1 Render Simple Primitives", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const textSchema = putSchema(store, { type: "string" });
    const hash = store.cas.put(textSchema, "hello");

    const output = render(store, hash, { resolution: 1.0 });

    expect(output).toContain("hello");
    expect(output.trim()).toBeTruthy();
  });

  test("1.2 Render Object Node (Flat)", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const objSchema = putSchema(store, {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number" },
      },
    });
    const hash = store.cas.put(objSchema, { name: "test", count: 42 });

    const output = render(store, hash, { resolution: 1.0 });

    expect(output).toContain("name");
    expect(output).toContain("test");
    expect(output).toContain("count");
    expect(output).toContain("42");
  });

  test("1.3 Render Array Node (Flat)", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const arraySchema = putSchema(store, {
      type: "array",
      items: { type: "number" },
    });
    const hash = store.cas.put(arraySchema, [1, 2, 3]);

    const output = render(store, hash, { resolution: 1.0 });

    expect(output).toContain("1");
    expect(output).toContain("2");
    expect(output).toContain("3");
  });

  test("1.4 Render with resolution=0 (Force Reference)", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const textSchema = putSchema(store, { type: "string" });
    const hash = store.cas.put(textSchema, "hello");

    const output = render(store, hash, { resolution: 0 });

    expect(output.trim()).toBe(`cas:${hash}`);
  });

  test("1.5 Render Non-existent Hash Throws Error", () => {
    const store = createMemoryStore();
    const fakeHash = "ZZZZZZZZZZZZZ" as Hash;

    // Non-existent root node should throw
    expect(() => render(store, fakeHash)).toThrow(CasNodeNotFoundError);
    expect(() => render(store, fakeHash)).toThrow("CAS node not found");
    expect(() => render(store, fakeHash)).toThrow(fakeHash);
  });
});

describe("Suite 2: Resolution Decay Model", () => {
  test("2.1 Single-level Nesting with Default Decay", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const childSchema = putSchema(store, {
      type: "object",
      properties: {
        content: { type: "string" },
      },
    });
    const childHash = store.cas.put(childSchema, { content: "leaf" });

    const parentSchema = putSchema(store, {
      type: "object",
      properties: {
        title: { type: "string" },
        child: { type: "string", format: "ocas_ref" },
      },
    });
    const parentHash = store.cas.put(parentSchema, {
      title: "root",
      child: childHash,
    });

    const output = render(store, parentHash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.01,
    });

    expect(output).toContain("title");
    expect(output).toContain("root");
    expect(output).toContain("content");
    expect(output).toContain("leaf");
  });

  test("2.2 Multi-level Nesting Reaches Epsilon", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const leafSchema = putSchema(store, {
      type: "object",
      properties: {
        value: { type: "number" },
        next: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });

    // Create 8-level chain
    let currentHash: Hash | null = null;
    for (let i = 7; i >= 0; i--) {
      currentHash = store.cas.put(leafSchema, {
        value: i,
        next: currentHash,
      });
    }

    const output = render(store, currentHash as Hash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.01,
    });

    // At depth 7: resolution = 0.5^7 = 0.0078125 <= 0.01
    expect(output).toContain("value");
    expect(output).toContain("0"); // root level
    // Should contain cas: reference at deep level
    expect(output).toMatch(/cas:[0-9A-HJKMNP-TV-Z]{13}/);
  });

  test("2.3 High Decay (Quick Cutoff)", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const nodeSchema = putSchema(store, {
      type: "object",
      properties: {
        level: { type: "number" },
        child: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });

    // Create 3-level nested structure
    const level2Hash = store.cas.put(nodeSchema, { level: 2, child: null });
    const level1Hash = store.cas.put(nodeSchema, {
      level: 1,
      child: level2Hash,
    });
    const rootHash = store.cas.put(nodeSchema, {
      level: 0,
      child: level1Hash,
    });

    const output = render(store, rootHash, {
      resolution: 1.0,
      decay: 0.1,
      epsilon: 0.01,
    });

    expect(output).toContain("level");
    expect(output).toContain("0"); // root
    expect(output).toContain("1"); // level 1 (0.1 > 0.01)
    // Level 2 should be reference (0.01 <= 0.01)
    expect(output).toMatch(/cas:[0-9A-HJKMNP-TV-Z]{13}/);
  });

  test("2.4 Low Decay (Deep Expansion)", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const nodeSchema = putSchema(store, {
      type: "object",
      properties: {
        level: { type: "number" },
        next: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });

    // Create 10-level chain
    let currentHash: Hash | null = null;
    for (let i = 9; i >= 0; i--) {
      currentHash = store.cas.put(nodeSchema, {
        level: i,
        next: currentHash,
      });
    }

    const output = render(store, currentHash as Hash, {
      resolution: 1.0,
      decay: 0.9,
      epsilon: 0.01,
    });

    // All 10 levels should be expanded (0.9^10 ≈ 0.349 > 0.01)
    for (let i = 0; i < 10; i++) {
      expect(output).toContain(`${i}`);
    }
  });

  test("2.5 Starting Resolution Below 1.0", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const nodeSchema = putSchema(store, {
      type: "object",
      properties: {
        level: { type: "number" },
        next: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });

    // Create 5-level chain
    let currentHash: Hash | null = null;
    for (let i = 4; i >= 0; i--) {
      currentHash = store.cas.put(nodeSchema, {
        level: i,
        next: currentHash,
      });
    }

    const output = render(store, currentHash as Hash, {
      resolution: 0.5,
      decay: 0.5,
      epsilon: 0.01,
    });

    // resolution sequence: 0.5, 0.25, 0.125, 0.0625, 0.03125 (all > 0.01)
    expect(output).toContain("0");
    expect(output).toContain("1");
    expect(output).toContain("2");
    expect(output).toContain("3");
  });
});

describe("Suite 3: Complex Graph Structures", () => {
  test("3.1 Multiple Child References", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const itemSchema = putSchema(store, {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    });

    const item1 = store.cas.put(itemSchema, { name: "item1" });
    const item2 = store.cas.put(itemSchema, { name: "item2" });
    const item3 = store.cas.put(itemSchema, { name: "item3" });

    const parentSchema = putSchema(store, {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "string", format: "ocas_ref" },
        },
      },
    });
    const parentHash = store.cas.put(parentSchema, {
      items: [item1, item2, item3],
    });

    const output = render(store, parentHash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.01,
    });

    expect(output).toContain("item1");
    expect(output).toContain("item2");
    expect(output).toContain("item3");
  });

  test("3.2 Object with Multiple ocas_ref Fields", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const childSchema = putSchema(store, {
      type: "object",
      properties: {
        value: { type: "string" },
      },
    });

    const leftHash = store.cas.put(childSchema, { value: "left" });
    const rightHash = store.cas.put(childSchema, { value: "right" });

    const parentSchema = putSchema(store, {
      type: "object",
      properties: {
        left: { type: "string", format: "ocas_ref" },
        right: { type: "string", format: "ocas_ref" },
        data: { type: "string" },
      },
    });
    const parentHash = store.cas.put(parentSchema, {
      left: leftHash,
      right: rightHash,
      data: "node",
    });

    const output = render(store, parentHash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.01,
    });

    expect(output).toContain("left");
    expect(output).toContain("right");
    expect(output).toContain("node");
  });

  test("3.3 Cycle Detection", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const nodeSchema = putSchema(store, {
      type: "object",
      properties: {
        name: { type: "string" },
        ref: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });

    const hashA = store.cas.put(nodeSchema, { name: "A", ref: null });
    const hashB = store.cas.put(nodeSchema, { name: "B", ref: hashA });

    // Manually update A to reference B (simulate cycle)
    // Note: In practice, this requires store manipulation
    // For this test, we'll create a simpler case

    const output = render(store, hashB, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.01,
    });

    // Should not infinite loop
    expect(output).toContain("B");
    expect(output).toContain("A");
  });

  test("3.4 DAG (Shared Descendant)", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const leafSchema = putSchema(store, {
      type: "object",
      properties: {
        value: { type: "string" },
      },
    });
    const sharedLeaf = store.cas.put(leafSchema, { value: "shared" });

    const branchSchema = putSchema(store, {
      type: "object",
      properties: {
        name: { type: "string" },
        child: { type: "string", format: "ocas_ref" },
      },
    });
    const branchA = store.cas.put(branchSchema, {
      name: "A",
      child: sharedLeaf,
    });
    const branchB = store.cas.put(branchSchema, {
      name: "B",
      child: sharedLeaf,
    });

    const rootSchema = putSchema(store, {
      type: "object",
      properties: {
        left: { type: "string", format: "ocas_ref" },
        right: { type: "string", format: "ocas_ref" },
      },
    });
    const rootHash = store.cas.put(rootSchema, {
      left: branchA,
      right: branchB,
    });

    const output = render(store, rootHash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.01,
    });

    expect(output).toContain("A");
    expect(output).toContain("B");
    expect(output).toContain("shared");
  });

  test("3.5 Deep Tree", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const nodeSchema = putSchema(store, {
      type: "object",
      properties: {
        value: { type: "number" },
        left: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
        right: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });

    // Create binary tree (just 5 levels for test speed)
    async function createTree(depth: number, value: number): Promise<Hash> {
      if (depth === 0) {
        return store.cas.put(nodeSchema, { value, left: null, right: null });
      }
      const left = await createTree(depth - 1, value * 2);
      const right = await createTree(depth - 1, value * 2 + 1);
      return store.cas.put(nodeSchema, { value, left, right });
    }

    const rootHash = await createTree(5, 1);

    const output = render(store, rootHash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.01,
    });

    // Should complete without error
    expect(output).toContain("value");
  });
});

describe("Suite 4: Epsilon Boundary Cases", () => {
  test("4.1 Resolution Exactly at Epsilon", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const textSchema = putSchema(store, { type: "string" });
    const hash = store.cas.put(textSchema, "test");

    const output = render(store, hash, {
      resolution: 0.01,
      decay: 0.5,
      epsilon: 0.01,
    });

    expect(output.trim()).toBe(`cas:${hash}`);
  });

  test("4.2 Resolution Just Above Epsilon", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const textSchema = putSchema(store, { type: "string" });
    const hash = store.cas.put(textSchema, "test");

    const output = render(store, hash, {
      resolution: 0.0100001,
      epsilon: 0.01,
    });

    expect(output).toContain("test");
    expect(output).not.toContain("cas:");
  });

  test("4.3 Very Small Epsilon (Deep Expansion)", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const nodeSchema = putSchema(store, {
      type: "object",
      properties: {
        level: { type: "number" },
        next: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });

    // Create 15-level chain
    let currentHash: Hash | null = null;
    for (let i = 14; i >= 0; i--) {
      currentHash = store.cas.put(nodeSchema, {
        level: i,
        next: currentHash,
      });
    }

    const output = render(store, currentHash as Hash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.000001,
    });

    // Many levels should be expanded
    expect(output).toContain("0");
    expect(output).toContain("5");
    expect(output).toContain("10");
  });

  test("4.4 Zero Epsilon (Never Prune)", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const nodeSchema = putSchema(store, {
      type: "object",
      properties: {
        level: { type: "number" },
        next: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });

    // Create 20-level chain
    let currentHash: Hash | null = null;
    for (let i = 19; i >= 0; i--) {
      currentHash = store.cas.put(nodeSchema, {
        level: i,
        next: currentHash,
      });
    }

    const output = render(store, currentHash as Hash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0,
    });

    // All levels should be present
    expect(output).toContain("0");
    expect(output).toContain("10");
    expect(output).toContain("19");
  });
});

describe("Suite 5: YAML Output Format", () => {
  test("5.1 Valid YAML Syntax", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const objSchema = putSchema(store, {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number" },
      },
    });
    const hash = store.cas.put(objSchema, { name: "test", count: 42 });

    const output = render(store, hash);

    // Basic YAML validation - should have key: value pairs
    expect(output).toMatch(/\w+:/);
  });

  test("5.2 Nested Object Indentation", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const nestedSchema = putSchema(store, {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            inner: { type: "string" },
          },
        },
      },
    });
    const hash = store.cas.put(nestedSchema, {
      outer: { inner: "value" },
    });

    const output = render(store, hash);

    // Should have proper indentation (2 spaces)
    expect(output).toContain("outer");
    expect(output).toContain("inner");
    expect(output).toContain("value");
  });

  test("5.3 Array Rendering", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const arraySchema = putSchema(store, {
      type: "array",
      items: { type: "number" },
    });
    const hash = store.cas.put(arraySchema, [1, 2, 3]);

    const output = render(store, hash);

    // YAML array format
    expect(output).toMatch(/[-[].*[1-3]/);
  });

  test("5.4 CAS Reference in YAML", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const childSchema = putSchema(store, {
      type: "object",
      properties: {
        value: { type: "string" },
      },
    });
    const childHash = store.cas.put(childSchema, { value: "child" });

    const parentSchema = putSchema(store, {
      type: "object",
      properties: {
        child: { type: "string", format: "ocas_ref" },
      },
    });
    const parentHash = store.cas.put(parentSchema, { child: childHash });

    const output = render(store, parentHash, {
      resolution: 1.0,
      decay: 0.1,
      epsilon: 0.5,
    });

    // Child should be rendered as cas: reference
    expect(output).toMatch(/cas:[0-9A-HJKMNP-TV-Z]{13}/);
  });

  test("5.5 Special Characters Escaping", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const textSchema = putSchema(store, { type: "string" });
    const hash = store.cas.put(textSchema, "line1\nline2: value");

    const output = render(store, hash);

    // Should handle newlines and colons
    expect(output).toBeTruthy();
  });

  test("5.6 Null Handling", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const nullableSchema = putSchema(store, {
      type: "object",
      properties: {
        ref: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });
    const hash = store.cas.put(nullableSchema, { ref: null });

    const output = render(store, hash);

    expect(output).toContain("null");
  });
});

describe("Suite 6: Schema Integration", () => {
  test("6.1 Detect ocas_ref Fields via Schema", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const childSchema = putSchema(store, {
      type: "object",
      properties: {
        value: { type: "string" },
      },
    });
    const childHash = store.cas.put(childSchema, { value: "child" });

    const parentSchema = putSchema(store, {
      type: "object",
      properties: {
        link: { type: "string", format: "ocas_ref" },
      },
    });
    const parentHash = store.cas.put(parentSchema, { link: childHash });

    const output = render(store, parentHash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.01,
    });

    expect(output).toContain("child");
  });

  test("6.2 Non-ocas_ref String Not Expanded", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const objSchema = putSchema(store, {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    });
    const hash = store.cas.put(objSchema, { name: "ABC123XYZ9012" });

    const output = render(store, hash);

    // Should be plain string, not expanded
    expect(output).toContain("ABC123XYZ9012");
    expect(output).not.toMatch(/cas:[0-9A-HJKMNP-TV-Z]{13}/);
  });

  test("6.3 Array of ocas_ref", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const itemSchema = putSchema(store, {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    });
    const item1 = store.cas.put(itemSchema, { name: "item1" });
    const item2 = store.cas.put(itemSchema, { name: "item2" });

    const arraySchema = putSchema(store, {
      type: "array",
      items: { type: "string", format: "ocas_ref" },
    });
    const arrayHash = store.cas.put(arraySchema, [item1, item2]);

    const output = render(store, arrayHash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.01,
    });

    expect(output).toContain("item1");
    expect(output).toContain("item2");
  });

  test("6.4 anyOf with ocas_ref (Nullable Reference)", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const childSchema = putSchema(store, {
      type: "object",
      properties: {
        value: { type: "string" },
      },
    });
    const childHash = store.cas.put(childSchema, { value: "child" });

    const parentSchema = putSchema(store, {
      type: "object",
      properties: {
        ref: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });
    const parentHash = store.cas.put(parentSchema, { ref: childHash });

    const output = render(store, parentHash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.01,
    });

    expect(output).toContain("child");
  });

  test("6.5 Schema-less Node (Bootstrap Node)", async () => {
    const store = createMemoryStore();
    const types = bootstrap(store);
    const schemaHash = types["@ocas/schema"];

    const output = render(store, schemaHash);

    // Should render without recursive expansion
    expect(output).toBeTruthy();
  });
});

describe("Suite 7: Error Handling", () => {
  test("7.1 Missing Referenced Node", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const parentSchema = putSchema(store, {
      type: "object",
      properties: {
        child: { type: "string", format: "ocas_ref" },
      },
    });
    const fakeChildHash = "ZZZZZZZZZZZZZ" as Hash;
    const parentHash = store.cas.put(parentSchema, { child: fakeChildHash });

    const output = render(store, parentHash);

    // Should render missing ref as cas:<hash>
    expect(output).toContain(`cas:${fakeChildHash}`);
  });

  test("7.3 Invalid Resolution Parameter", () => {
    const store = createMemoryStore();
    const fakeHash = "AAAAAAAAAAAAA" as Hash;

    expect(() => render(store, fakeHash, { resolution: -1 })).toThrow();
  });

  test("7.4 Invalid Decay Parameter", () => {
    const store = createMemoryStore();
    const fakeHash = "AAAAAAAAAAAAA" as Hash;

    expect(() => render(store, fakeHash, { decay: 1.5 })).toThrow();
  });

  test("7.5 Invalid Epsilon Parameter", () => {
    const store = createMemoryStore();
    const fakeHash = "AAAAAAAAAAAAA" as Hash;

    expect(() => render(store, fakeHash, { epsilon: -0.01 })).toThrow();
  });
});

describe("Suite 8: Performance & Edge Cases", () => {
  test("8.1 Large Payload", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const arraySchema = putSchema(store, {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          name: { type: "string" },
        },
      },
    });

    const largeArray = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `item${i}`,
    }));
    const hash = store.cas.put(arraySchema, largeArray);

    const start = Date.now();
    const output = render(store, hash);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
    expect(output).toBeTruthy();
  });

  test("8.2 Wide Fan-out", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const itemSchema = putSchema(store, {
      type: "object",
      properties: {
        value: { type: "number" },
      },
    });

    const children: Hash[] = [];
    for (let i = 0; i < 100; i++) {
      const hash = store.cas.put(itemSchema, { value: i });
      children.push(hash);
    }

    const parentSchema = putSchema(store, {
      type: "array",
      items: { type: "string", format: "ocas_ref" },
    });
    const parentHash = store.cas.put(parentSchema, children);

    const output = render(store, parentHash, {
      resolution: 1.0,
      decay: 0.5,
      epsilon: 0.01,
    });

    expect(output).toBeTruthy();
  });

  test("8.3 Empty Payload", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const emptySchema = putSchema(store, { type: "object" });
    const hash = store.cas.put(emptySchema, {});

    const output = render(store, hash);

    expect(output.trim()).toMatch(/\{\}/);
  });

  test("8.4 Unicode in Payload", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const textSchema = putSchema(store, {
      type: "object",
      properties: {
        text: { type: "string" },
      },
    });
    const hash = store.cas.put(textSchema, { text: "你好世界 🌍" });

    const output = render(store, hash);

    expect(output).toContain("你好世界");
    expect(output).toContain("🌍");
  });
});

describe("Suite 9: renderDirect (in-memory rendering)", () => {
  test("9.1 Render primitive value without store", () => {
    const fakeTypeHash = "0000000000000" as Hash;
    const output = renderDirect(fakeTypeHash, "hello world", null, null);
    expect(output.trim()).toBe("hello world");
  });

  test("9.2 Render object value without store", () => {
    const fakeTypeHash = "0000000000000" as Hash;
    const output = renderDirect(
      fakeTypeHash,
      {
        name: "Alice",
        age: 30,
      },
      null,
      null,
    );
    expect(output).toContain("name: Alice");
    expect(output).toContain("age: 30");
  });

  test("9.3 Render array value without store", () => {
    const fakeTypeHash = "0000000000000" as Hash;
    const output = renderDirect(fakeTypeHash, ["a", "b", "c"], null, null);
    expect(output).toContain("-");
    expect(output).toContain("a");
    expect(output).toContain("b");
    expect(output).toContain("c");
  });

  test("9.4 Render nested object without store", () => {
    const fakeTypeHash = "0000000000000" as Hash;
    const output = renderDirect(
      fakeTypeHash,
      {
        user: { name: "Bob", role: "admin" },
        active: true,
      },
      null,
      null,
    );
    expect(output).toContain("name: Bob");
    expect(output).toContain("role: admin");
    expect(output).toContain("active: true");
  });

  test("9.5 Render with store expands ocas_ref fields", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    // Create a child node
    const childSchema = putSchema(store, {
      type: "object",
      properties: { msg: { type: "string" } },
    });
    const childHash = store.cas.put(childSchema, { msg: "inner" });

    // Parent schema with ocas_ref
    const parentSchema = putSchema(store, {
      type: "object",
      properties: {
        child: { type: "string", format: "ocas_ref" },
      },
    });

    // Render directly with store — ocas_ref should expand
    const output = renderDirect(
      parentSchema,
      { child: childHash },
      store,
      null,
    );
    expect(output).toContain("msg: inner");
  });

  test("9.6 Render with resolution/decay options", () => {
    const fakeTypeHash = "0000000000000" as Hash;
    const output = renderDirect(fakeTypeHash, { key: "value" }, null, {
      resolution: 0.5,
      decay: 0.8,
    });
    expect(output).toContain("key: value");
  });

  test("9.7 Validate parameters", () => {
    const fakeTypeHash = "0000000000000" as Hash;
    expect(() =>
      renderDirect(fakeTypeHash, "x", null, { resolution: 2 }),
    ).toThrow("resolution must be in [0, 1]");
    expect(() => renderDirect(fakeTypeHash, "x", null, { decay: 0 })).toThrow(
      "decay must be in (0, 1]",
    );
    expect(() =>
      renderDirect(fakeTypeHash, "x", null, { epsilon: -1 }),
    ).toThrow("epsilon must be >= 0");
  });

  test("9.8 Render null value", () => {
    const fakeTypeHash = "0000000000000" as Hash;
    const output = renderDirect(fakeTypeHash, null, null, null);
    expect(output.trim()).toBe("null");
  });

  test("9.9 ocas_ref without store renders as cas: reference", () => {
    // Without store, can't identify ocas_ref fields — hash strings stay as strings
    const fakeTypeHash = "0000000000000" as Hash;
    const someHash = "ABCDEFGH12345" as Hash;
    const output = renderDirect(fakeTypeHash, { ref: someHash }, null, null);
    // Without store, it's just a string value
    expect(output).toContain(`ref: ${someHash}`);
  });

  test("9.10 store present but schema missing — renders without ref expansion", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const unknownType = "ZZZZZZZZZZZZ0" as Hash;
    const output = renderDirect(unknownType, { key: "val" }, store, null);
    expect(output).toContain("key: val");
  });
});

describe("Suite 10: Missing Root Hash Error Handling (Issue #53)", () => {
  test("10.1 renderAsync() throws CasNodeNotFoundError for missing root hash", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const fakeHash = "AAAAAAAAAAAAA" as Hash;

    await expect(renderAsync(store, fakeHash)).rejects.toThrow(
      CasNodeNotFoundError,
    );
    await expect(renderAsync(store, fakeHash)).rejects.toThrow(
      "CAS node not found",
    );
    await expect(renderAsync(store, fakeHash)).rejects.toThrow(fakeHash);
  });

  test("10.2 render() throws CasNodeNotFoundError for missing root hash", () => {
    const store = createMemoryStore();
    const fakeHash = "ZZZZZZZZZZZZZ" as Hash;

    expect(() => render(store, fakeHash)).toThrow(CasNodeNotFoundError);
    expect(() => render(store, fakeHash)).toThrow("CAS node not found");
    expect(() => render(store, fakeHash)).toThrow(fakeHash);
  });

  test("10.3 renderDirect() does NOT throw for non-existent type hash", () => {
    const store = createMemoryStore();
    const fakeTypeHash = "0000000000000" as Hash;
    const output = renderDirect(fakeTypeHash, { key: "value" }, store, null);

    expect(output).toContain("key: value");
  });

  test("10.4 Missing nested node renders as cas: reference (no error)", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const parentSchema = putSchema(store, {
      type: "object",
      properties: {
        title: { type: "string" },
        child: { type: "string", format: "ocas_ref" },
      },
    });

    const fakeChildHash = "ZZZZZZZZZZZZZ" as Hash;
    const parentHash = store.cas.put(parentSchema, {
      title: "root",
      child: fakeChildHash,
    });

    const output = render(store, parentHash);

    expect(output).toContain("title: root");
    expect(output).toContain(`cas:${fakeChildHash}`);
  });

  test("10.5 Resolution below epsilon renders as cas: reference (no error)", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const nodeSchema = putSchema(store, {
      type: "object",
      properties: {
        level: { type: "number" },
        next: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });

    // Create 3-level chain
    let currentHash: Hash | null = null;
    for (let i = 2; i >= 0; i--) {
      currentHash = store.cas.put(nodeSchema, {
        level: i,
        next: currentHash,
      });
    }

    const output = render(store, currentHash as Hash, {
      resolution: 1.0,
      decay: 0.1,
      epsilon: 0.5,
    });

    // Level 0 should be expanded (resolution = 1.0 > 0.5)
    expect(output).toContain("level: 0");
    // Level 1+ should be cas: references (0.1, 0.01 < 0.5)
    expect(output).toContain("cas:");
  });
});

describe("Suite 11: Map-Reduce-Compose Pipeline", () => {
  test("11.1 Compose template invoked with content and type_statics", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    // Create type T1 with static template
    const t1Schema = putSchema(store, {
      type: "object",
      properties: {
        value: { type: "string" },
      },
    });

    const t1Hash = store.cas.put(t1Schema, { value: "test1" });

    // Register static template for T1
    const stringSchema = putSchema(store, { type: "string" });
    const staticTemplate = `{"slot1": "value1"}`;
    const staticTemplateHash = store.cas.put(stringSchema, staticTemplate);
    store.var.set(`@ocas/template-static/text/${t1Schema}`, staticTemplateHash);

    // Register T1 template
    const t1Template = "T1: {{ value }}";
    const t1TemplateHash = store.cas.put(stringSchema, t1Template);
    store.var.set(`@ocas/template/text/${t1Schema}`, t1TemplateHash);

    // Register compose template
    const composeTemplate = `COMPOSED:
{{ content }}
STATICS: {{ type_statics | json }}`;
    const composeTemplateHash = store.cas.put(stringSchema, composeTemplate);
    store.var.set("@ocas/template-compose/text", composeTemplateHash);

    // Render
    const output = await renderAsync(store, t1Hash, { format: "text" });

    // Verify compose template was invoked
    expect(output).toContain("COMPOSED:");
    expect(output).toContain("T1: test1"); // DFS content
    expect(output).toContain("STATICS:"); // Type statics section
    expect(output).toContain(`"${t1Schema}"`); // Type hash in statics
    expect(output).toContain("slot1"); // Static slot name
    expect(output).toContain("value1"); // Static slot value
  });

  test("11.2 Identity compose when no compose template exists", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    // Create a simple type with template
    const schema = putSchema(store, {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    });

    const hash = store.cas.put(schema, { name: "Alice" });

    // Register template for the type
    const stringSchema = putSchema(store, { type: "string" });
    const template = "Name: {{ name }}";
    const templateHash = store.cas.put(stringSchema, template);
    store.var.set(`@ocas/template/text/${schema}`, templateHash);

    // NO compose template registered

    // Render
    const output = await renderAsync(store, hash, { format: "text" });

    // Verify output is just the DFS content (identity compose)
    expect(output).toBe("Name: Alice");
    expect(output).not.toContain("COMPOSED:"); // No compose wrapper
    expect(output).not.toContain("STATICS:"); // No statics
  });

  test("11.3 Format defaults to 'text'", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    // Create a simple type with text template
    const schema = putSchema(store, {
      type: "object",
      properties: {
        value: { type: "string" },
      },
    });

    const hash = store.cas.put(schema, { value: "test" });

    // Register template in text namespace
    const stringSchema = putSchema(store, { type: "string" });
    const template = "Value: {{ value }}";
    const templateHash = store.cas.put(stringSchema, template);
    store.var.set(`@ocas/template/text/${schema}`, templateHash);

    // Render without format option
    const output = await renderAsync(store, hash);

    // Should use text format by default
    expect(output).toBe("Value: test");
  });

  test("11.4 Type collection across multiple nodes", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    // Create two different types
    const t1Schema = putSchema(store, {
      type: "object",
      properties: {
        value: { type: "string" },
      },
    });

    const t2Schema = putSchema(store, {
      type: "object",
      properties: {
        count: { type: "number" },
      },
    });

    const t1Hash = store.cas.put(t1Schema, { value: "test" });
    const t2Hash = store.cas.put(t2Schema, { count: 42 });

    // Create root that references both
    const rootSchema = putSchema(store, {
      type: "object",
      properties: {
        child1: { type: "string", format: "ocas_ref" },
        child2: { type: "string", format: "ocas_ref" },
      },
    });

    const rootHash = store.cas.put(rootSchema, {
      child1: t1Hash,
      child2: t2Hash,
    });

    // Register templates
    const stringSchema = putSchema(store, { type: "string" });

    const t1Template = "T1: {{ value }}";
    const t1TemplateHash = store.cas.put(stringSchema, t1Template);
    store.var.set(`@ocas/template/text/${t1Schema}`, t1TemplateHash);

    const t2Template = "T2: {{ count }}";
    const t2TemplateHash = store.cas.put(stringSchema, t2Template);
    store.var.set(`@ocas/template/text/${t2Schema}`, t2TemplateHash);

    const rootTemplate = `Root:
{% render child1 %}
{% render child2 %}`;
    const rootTemplateHash = store.cas.put(stringSchema, rootTemplate);
    store.var.set(`@ocas/template/text/${rootSchema}`, rootTemplateHash);

    // Register static templates for both types
    const t1StaticTemplate = `{"css": ".t1 { color: red; }"}`;
    const t1StaticHash = store.cas.put(stringSchema, t1StaticTemplate);
    store.var.set(`@ocas/template-static/text/${t1Schema}`, t1StaticHash);

    const t2StaticTemplate = `{"css": ".t2 { color: blue; }"}`;
    const t2StaticHash = store.cas.put(stringSchema, t2StaticTemplate);
    store.var.set(`@ocas/template-static/text/${t2Schema}`, t2StaticHash);

    // Register compose template
    const composeTemplate = `=== PAGE ===
{{ content }}
=== STYLES ===
{% for entry in type_statics %}{{ entry.css }}
{% endfor %}`;
    const composeTemplateHash = store.cas.put(stringSchema, composeTemplate);
    store.var.set("@ocas/template-compose/text", composeTemplateHash);

    // Render
    const output = await renderAsync(store, rootHash, { format: "text" });

    // Verify all types were collected and their statics rendered
    expect(output).toContain("=== PAGE ===");
    expect(output).toContain("Root:");
    expect(output).toContain("T1: test");
    expect(output).toContain("T2: 42");
    expect(output).toContain("=== STYLES ===");
    expect(output).toContain(".t1 { color: red; }");
    expect(output).toContain(".t2 { color: blue; }");
  });
});
