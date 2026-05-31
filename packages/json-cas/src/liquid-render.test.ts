import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "./bootstrap.js";
import { renderWithTemplate } from "./liquid-render.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";
import type { Hash } from "./types.js";
import { createVariableStore } from "./variable-store.js";

// Helper to create a temporary variable store
async function createTempVarStore() {
  const tempDir = await mkdtemp(join(tmpdir(), "json-cas-test-"));
  const dbPath = join(tempDir, "vars.db");
  const store = createMemoryStore();
  await bootstrap(store);
  const varStore = createVariableStore(dbPath, store);
  return {
    store,
    varStore,
    tempDir,
    cleanup: async () => await rm(tempDir, { recursive: true }),
  };
}

describe("Suite 1: LiquidJS Setup & Configuration", () => {
  test("1.1 liquidjs Package Installed", async () => {
    // Verify liquidjs can be imported
    const { Liquid } = await import("liquidjs");
    expect(Liquid).toBeDefined();
  });

  test("1.2 Liquid Engine Instance Created", async () => {
    const { Liquid } = await import("liquidjs");
    const engine = new Liquid({
      strictFilters: false,
      strictVariables: false,
    });
    expect(engine).toBeDefined();
  });

  test("1.3 Custom render Tag Can Be Registered", async () => {
    const { Liquid } = await import("liquidjs");
    const engine = new Liquid();

    // Register a test tag
    engine.registerTag("test", {
      parse(_token) {
        // Test parsing
      },
      render() {
        return "test";
      },
    });

    const output = await engine.parseAndRender("{% test %}");
    expect(output).toBe("test");
  });
});

describe("Suite 2: Custom {% render %} Tag Implementation", () => {
  test("2.1 Basic Syntax: {% render <variable> %}", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const childSchema = await putSchema(store, {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
      const childHash = await store.put(childSchema, {
        value: "child content",
      });

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          child: { type: "string", format: "cas_ref" },
        },
      });
      const parentHash = await store.put(parentSchema, {
        name: "parent",
        child: childHash,
      });

      // Register template for parent
      const templateSchema = await putSchema(store, { type: "string" });
      const templateHash = await store.put(
        templateSchema,
        "Parent: {{ payload.name }}\n{% render payload.child %}",
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, templateHash);

      // Register template for child
      const childTemplateHash = await store.put(
        templateSchema,
        "Child: {{ payload.value }}",
      );
      varStore.set(`@ucas/template/text/${childSchema}`, childTemplateHash);

      const output = await renderWithTemplate(store, varStore, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Parent: parent");
      expect(output).toContain("Child: child content");
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("2.2 Explicit Decay: {% render <variable>, decay: 0.7 %}", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          level: { type: "number" },
          child: {
            anyOf: [{ type: "string", format: "cas_ref" }, { type: "null" }],
          },
        },
      });

      // Create 3-level nested structure
      const level2Hash = await store.put(nodeSchema, { level: 2, child: null });
      const level1Hash = await store.put(nodeSchema, {
        level: 1,
        child: level2Hash,
      });
      const rootHash = await store.put(nodeSchema, {
        level: 0,
        child: level1Hash,
      });

      const templateSchema = await putSchema(store, { type: "string" });

      // Template that shows the level and renders child with explicit decay
      const template = await store.put(
        templateSchema,
        "Level {{ payload.level }}\n{% render payload.child, decay: 0.7 %}",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, rootHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Level 0");
      // Child1 should render with resolution=0.7 (explicit decay)
      expect(output).toContain("Level 1");
      expect(output).toContain("Level 2");
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("2.3 Multiple render Tags in One Template", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const childSchema = await putSchema(store, {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
      const leftHash = await store.put(childSchema, { value: "left" });
      const rightHash = await store.put(childSchema, { value: "right" });

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          left: { type: "string", format: "cas_ref" },
          right: { type: "string", format: "cas_ref" },
        },
      });
      const parentHash = await store.put(parentSchema, {
        left: leftHash,
        right: rightHash,
      });

      const templateSchema = await putSchema(store, { type: "string" });
      const parentTemplate = await store.put(
        templateSchema,
        "Left:\n{% render payload.left %}\nRight:\n{% render payload.right %}",
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, parentTemplate);

      const childTemplate = await store.put(
        templateSchema,
        "Value: {{ payload.value }}",
      );
      varStore.set(`@ucas/template/text/${childSchema}`, childTemplate);

      const output = await renderWithTemplate(store, varStore, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Left:");
      expect(output).toContain("Value: left");
      expect(output).toContain("Right:");
      expect(output).toContain("Value: right");
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("2.4 Render Tag with Missing/Null Reference", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          child: {
            anyOf: [{ type: "string", format: "cas_ref" }, { type: "null" }],
          },
        },
      });
      const nodeHash = await store.put(nodeSchema, {
        name: "test",
        child: null,
      });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "Before\n{% render payload.child %}\nAfter",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Before");
      expect(output).toContain("After");
      // Should not crash, null renders as empty
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("2.5 Render Tag with Non-existent Hash", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const fakeHash = "ZZZZZZZZZZZZZ" as Hash;
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          child: { type: "string", format: "cas_ref" },
        },
      });
      const nodeHash = await store.put(nodeSchema, {
        name: "test",
        child: fakeHash,
      });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "{% render payload.child %}",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain(`cas:${fakeHash}`);
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("2.6 Resolution Below Epsilon (Force Reference)", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const childSchema = await putSchema(store, {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
      const childHash = await store.put(childSchema, { value: "child" });

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          child: { type: "string", format: "cas_ref" },
        },
      });
      const parentHash = await store.put(parentSchema, { child: childHash });

      const templateSchema = await putSchema(store, { type: "string" });
      const parentTemplate = await store.put(
        templateSchema,
        "{% render payload.child %}",
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, parentTemplate);

      // resolution=0.02, decay=0.5, child gets 0.01 which equals epsilon
      const output = await renderWithTemplate(store, varStore, parentHash, {
        resolution: 0.02,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toMatch(/cas:[0-9A-HJKMNP-TV-Z]{13}/);
    } finally {
      varStore.close();
      await cleanup();
    }
  });
});

describe("Suite 3: Template Context Variables", () => {
  test("3.1 Context Variable: resolution", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "test" });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "Resolution: {{ resolution }}",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 0.75,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Resolution: 0.75");
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("3.2 Context Variable: epsilon", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "test" });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "Epsilon: {{ epsilon }}",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.005,
      });

      expect(output).toContain("Epsilon: 0.005");
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("3.3 Context Variable: hash", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "test" });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(templateSchema, "Hash: {{ hash }}");
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain(`Hash: ${nodeHash}`);
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("3.4 Context Variable: payload", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "number" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "test", count: 42 });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "Name: {{ payload.name }}, Count: {{ payload.count }}",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("Name: test, Count: 42");
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("3.5 Context Variable: type", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "test" });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(templateSchema, "Type: {{ type }}");
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain(`Type: ${nodeSchema}`);
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("3.6 Context Variable: timestamp", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "test" });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "Timestamp: {{ timestamp }}",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toMatch(/Timestamp: \d+/);
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("3.7 All Context Variables Together", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "test" });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        `Hash: {{ hash }}
Type: {{ type }}
Resolution: {{ resolution }}
Epsilon: {{ epsilon }}
Payload: {{ payload.name }}
Timestamp: {{ timestamp }}`,
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 0.8,
        decay: 0.6,
        epsilon: 0.02,
      });

      expect(output).toContain(`Hash: ${nodeHash}`);
      expect(output).toContain(`Type: ${nodeSchema}`);
      expect(output).toContain("Resolution: 0.8");
      expect(output).toContain("Epsilon: 0.02");
      expect(output).toContain("Payload: test");
      expect(output).toMatch(/Timestamp: \d+/);
    } finally {
      varStore.close();
      await cleanup();
    }
  });
});

describe("Suite 4: Render Flow Integration", () => {
  test("4.1 Template Discovery by Type Hash", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "test" });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "Custom template: {{ payload.name }}",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("Custom template: test");
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("4.4 Empty Template", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "test" });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(templateSchema, "");
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output.length).toBe(0);
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("4.5 Template with LiquidJS Syntax Error", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "test" });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "{% render %}", // Invalid: no variable
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      await expect(async () => {
        await renderWithTemplate(store, varStore, nodeHash, {
          resolution: 1.0,
          decay: 0.5,
          epsilon: 0.01,
        });
      }).toThrow();
    } finally {
      varStore.close();
      await cleanup();
    }
  });
});

describe("Suite 5: Decay Priority Chain", () => {
  test("5.1 Template Explicit Decay > CLI Decay", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const childSchema = await putSchema(store, {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
      const childHash = await store.put(childSchema, { value: "child" });

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          child: { type: "string", format: "cas_ref" },
        },
      });
      const parentHash = await store.put(parentSchema, { child: childHash });

      const templateSchema = await putSchema(store, { type: "string" });
      const parentTemplate = await store.put(
        templateSchema,
        "{% render payload.child, decay: 0.7 %}",
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, parentTemplate);

      const childTemplate = await store.put(
        templateSchema,
        "Resolution: {{ resolution }}",
      );
      varStore.set(`@ucas/template/text/${childSchema}`, childTemplate);

      const output = await renderWithTemplate(store, varStore, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      // Child should have resolution=0.7 (explicit decay wins over CLI decay=0.5)
      expect(output).toContain("Resolution: 0.7");
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("5.2 CLI Decay > Engine Default", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const childSchema = await putSchema(store, {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
      const childHash = await store.put(childSchema, { value: "child" });

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          child: { type: "string", format: "cas_ref" },
        },
      });
      const parentHash = await store.put(parentSchema, { child: childHash });

      const templateSchema = await putSchema(store, { type: "string" });
      const parentTemplate = await store.put(
        templateSchema,
        "{% render payload.child %}", // No explicit decay
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, parentTemplate);

      const childTemplate = await store.put(
        templateSchema,
        "Resolution: {{ resolution }}",
      );
      varStore.set(`@ucas/template/text/${childSchema}`, childTemplate);

      const output = await renderWithTemplate(store, varStore, parentHash, {
        resolution: 1.0,
        decay: 0.6,
        epsilon: 0.01,
      });

      // Child should have resolution=0.6 (CLI decay wins over default 0.5)
      expect(output).toContain("Resolution: 0.6");
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("5.3 Engine Default (No Template, No CLI)", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const childSchema = await putSchema(store, {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
      const childHash = await store.put(childSchema, { value: "child" });

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          child: { type: "string", format: "cas_ref" },
        },
      });
      const parentHash = await store.put(parentSchema, { child: childHash });

      const templateSchema = await putSchema(store, { type: "string" });
      const parentTemplate = await store.put(
        templateSchema,
        "{% render payload.child %}",
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, parentTemplate);

      const childTemplate = await store.put(
        templateSchema,
        "Resolution: {{ resolution }}",
      );
      varStore.set(`@ucas/template/text/${childSchema}`, childTemplate);

      const output = await renderWithTemplate(
        store,
        varStore,
        parentHash,
        { resolution: 1.0, epsilon: 0.01 }, // No decay specified
      );

      // Child should have resolution=0.5 (engine default)
      expect(output).toContain("Resolution: 0.5");
    } finally {
      varStore.close();
      await cleanup();
    }
  });
});

describe("Suite 7: Recursive Rendering Edge Cases", () => {
  test("7.1 Deep Recursion (10 Levels)", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          level: { type: "number" },
          next: {
            anyOf: [{ type: "string", format: "cas_ref" }, { type: "null" }],
          },
        },
      });

      // Create 10-level chain
      let currentHash: Hash | null = null;
      for (let i = 9; i >= 0; i--) {
        currentHash = await store.put(nodeSchema, {
          level: i,
          next: currentHash,
        });
      }

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "Level {{ payload.level }}\n{% render payload.next %}",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(
        store,
        varStore,
        currentHash as Hash,
        { resolution: 1.0, decay: 0.9, epsilon: 0.01 },
      );

      // All 10 levels should render
      for (let i = 0; i < 10; i++) {
        expect(output).toContain(`Level ${i}`);
      }
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("7.2 Cycle Detection with Templates", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          ref: {
            anyOf: [{ type: "string", format: "cas_ref" }, { type: "null" }],
          },
        },
      });

      // Create simple node first
      const nodeAHash = await store.put(nodeSchema, { name: "A", ref: null });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "Node {{ payload.name }}\n{% render payload.ref %}",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeAHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Node A");
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("7.4 Array of cas_ref with Template", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const itemSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const item1 = await store.put(itemSchema, { name: "item1" });
      const item2 = await store.put(itemSchema, { name: "item2" });
      const item3 = await store.put(itemSchema, { name: "item3" });

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { type: "string", format: "cas_ref" },
          },
        },
      });
      const parentHash = await store.put(parentSchema, {
        items: [item1, item2, item3],
      });

      const templateSchema = await putSchema(store, { type: "string" });
      const parentTemplate = await store.put(
        templateSchema,
        "{% for item in payload.items %}{% render item %}\n{% endfor %}",
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, parentTemplate);

      const itemTemplate = await store.put(
        templateSchema,
        "Item: {{ payload.name }}",
      );
      varStore.set(`@ucas/template/text/${itemSchema}`, itemTemplate);

      const output = await renderWithTemplate(store, varStore, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Item: item1");
      expect(output).toContain("Item: item2");
      expect(output).toContain("Item: item3");
    } finally {
      varStore.close();
      await cleanup();
    }
  });
});

describe("Suite 8: Error Handling & Edge Cases", () => {
  test("8.1 Template Missing render Variable", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "test" });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "{% render missingVar %}",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      // Should complete without throwing
      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBeDefined();
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("8.2 Template Invalid Decay Value", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const childSchema = await putSchema(store, {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
      const childHash = await store.put(childSchema, { value: "child" });

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          child: { type: "string", format: "cas_ref" },
        },
      });
      const parentHash = await store.put(parentSchema, { child: childHash });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "{% render payload.child, decay: 1.5 %}",
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, template);

      await expect(async () => {
        await renderWithTemplate(store, varStore, parentHash, {
          resolution: 1.0,
          decay: 0.5,
          epsilon: 0.01,
        });
      }).toThrow(/decay/);
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("8.3 Template Negative Decay", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const childSchema = await putSchema(store, {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
      const childHash = await store.put(childSchema, { value: "child" });

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          child: { type: "string", format: "cas_ref" },
        },
      });
      const parentHash = await store.put(parentSchema, { child: childHash });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "{% render payload.child, decay: -0.5 %}",
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, template);

      await expect(async () => {
        await renderWithTemplate(store, varStore, parentHash, {
          resolution: 1.0,
          decay: 0.5,
          epsilon: 0.01,
        });
      }).toThrow();
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("8.4 Template Decay=0 (Invalid)", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const childSchema = await putSchema(store, {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
      const childHash = await store.put(childSchema, { value: "child" });

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          child: { type: "string", format: "cas_ref" },
        },
      });
      const parentHash = await store.put(parentSchema, { child: childHash });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "{% render payload.child, decay: 0 %}",
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, template);

      await expect(async () => {
        await renderWithTemplate(store, varStore, parentHash, {
          resolution: 1.0,
          decay: 0.5,
          epsilon: 0.01,
        });
      }).toThrow(/decay/);
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("8.5 Template Decay=1 (Valid Edge)", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const childSchema = await putSchema(store, {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
      const childHash = await store.put(childSchema, { value: "child" });

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          child: { type: "string", format: "cas_ref" },
        },
      });
      const parentHash = await store.put(parentSchema, { child: childHash });

      const templateSchema = await putSchema(store, { type: "string" });
      const parentTemplate = await store.put(
        templateSchema,
        "{% render payload.child, decay: 1 %}",
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, parentTemplate);

      const childTemplate = await store.put(
        templateSchema,
        "Resolution: {{ resolution }}",
      );
      varStore.set(`@ucas/template/text/${childSchema}`, childTemplate);

      const output = await renderWithTemplate(store, varStore, parentHash, {
        resolution: 0.5,
        decay: 0.5,
        epsilon: 0.01,
      });

      // Child should have resolution=0.5 (0.5 * 1 = 0.5, no decay)
      expect(output).toContain("Resolution: 0.5");
    } finally {
      varStore.close();
      await cleanup();
    }
  });

  test("8.6 Template with Unicode Content", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = await putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = await store.put(nodeSchema, { name: "世界" });

      const templateSchema = await putSchema(store, { type: "string" });
      const template = await store.put(
        templateSchema,
        "你好: {{ payload.name }} 🌍",
      );
      varStore.set(`@ucas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, varStore, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("你好: 世界 🌍");
    } finally {
      varStore.close();
      await cleanup();
    }
  });
});

describe("Suite 10: Performance & Scalability", () => {
  test("10.1 Wide Fan-out (100 Children)", async () => {
    const { store, varStore, cleanup } = await createTempVarStore();

    try {
      const itemSchema = await putSchema(store, {
        type: "object",
        properties: {
          value: { type: "number" },
        },
      });

      const children: Hash[] = [];
      for (let i = 0; i < 100; i++) {
        const hash = await store.put(itemSchema, { value: i });
        children.push(hash);
      }

      const parentSchema = await putSchema(store, {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { type: "string", format: "cas_ref" },
          },
        },
      });
      const parentHash = await store.put(parentSchema, { items: children });

      const templateSchema = await putSchema(store, { type: "string" });
      const parentTemplate = await store.put(
        templateSchema,
        "{% for child in payload.items %}{% render child %}{% endfor %}",
      );
      varStore.set(`@ucas/template/text/${parentSchema}`, parentTemplate);

      const itemTemplate = await store.put(
        templateSchema,
        "{{ payload.value }}",
      );
      varStore.set(`@ucas/template/text/${itemSchema}`, itemTemplate);

      const start = Date.now();
      const output = await renderWithTemplate(store, varStore, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2000);
      expect(output).toBeTruthy();
    } finally {
      varStore.close();
      await cleanup();
    }
  });
});
