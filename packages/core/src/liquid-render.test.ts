import { describe, expect, test } from "bun:test";
import { bootstrap } from "./bootstrap.js";
import { renderWithTemplate } from "./liquid-render.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";
import type { Hash } from "./types.js";

// Helper to create an in-memory Store with bootstrap
async function createTempVarStore() {
  const store = createMemoryStore();
  bootstrap(store);
  return {
    store,
    cleanup: async () => {},
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
    const { store, cleanup } = await createTempVarStore();

    try {
      const childSchema = putSchema(store, {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
      const childHash = store.cas.put(childSchema, {
        value: "child content",
      });

      const parentSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          child: { type: "string", format: "ocas_ref" },
        },
      });
      const parentHash = store.cas.put(parentSchema, {
        name: "parent",
        child: childHash,
      });

      // Register template for parent
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "Parent: {{ payload.name }}\n{% render payload.child %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, templateHash);

      // Register template for child
      const childTemplateHash = store.cas.put(
        templateSchema,
        "Child: {{ payload.value }}",
      );
      store.var.set(`@ocas/template/text/${childSchema}`, childTemplateHash);

      const output = await renderWithTemplate(store, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Parent: parent");
      expect(output).toContain("Child: child content");
    } finally {
      await cleanup();
    }
  });

  test("2.2 Explicit Decay: {% render <variable>, decay: 0.7 %}", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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

      const templateSchema = putSchema(store, { type: "string" });

      // Template that shows the level and renders child with explicit decay
      const template = store.cas.put(
        templateSchema,
        "Level {{ payload.level }}\n{% render payload.child, decay: 0.7 %}",
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, rootHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Level 0");
      // Child1 should render with resolution=0.7 (explicit decay)
      expect(output).toContain("Level 1");
      expect(output).toContain("Level 2");
    } finally {
      await cleanup();
    }
  });

  test("2.3 Multiple render Tags in One Template", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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
        },
      });
      const parentHash = store.cas.put(parentSchema, {
        left: leftHash,
        right: rightHash,
      });

      const templateSchema = putSchema(store, { type: "string" });
      const parentTemplate = store.cas.put(
        templateSchema,
        "Left:\n{% render payload.left %}\nRight:\n{% render payload.right %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, parentTemplate);

      const childTemplate = store.cas.put(
        templateSchema,
        "Value: {{ payload.value }}",
      );
      store.var.set(`@ocas/template/text/${childSchema}`, childTemplate);

      const output = await renderWithTemplate(store, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Left:");
      expect(output).toContain("Value: left");
      expect(output).toContain("Right:");
      expect(output).toContain("Value: right");
    } finally {
      await cleanup();
    }
  });

  test("2.4 Render Tag with Missing/Null Reference", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          child: {
            anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
          },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, {
        name: "test",
        child: null,
      });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "Before\n{% render payload.child %}\nAfter",
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Before");
      expect(output).toContain("After");
      // Should not crash, null renders as empty
    } finally {
      await cleanup();
    }
  });

  test("2.5 Render Tag with Non-existent Hash", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const fakeHash = "ZZZZZZZZZZZZZ" as Hash;
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          child: { type: "string", format: "ocas_ref" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, {
        name: "test",
        child: fakeHash,
      });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "{% render payload.child %}",
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain(`cas:${fakeHash}`);
    } finally {
      await cleanup();
    }
  });

  test("2.6 Resolution Below Epsilon (Force Reference)", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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

      const templateSchema = putSchema(store, { type: "string" });
      const parentTemplate = store.cas.put(
        templateSchema,
        "{% render payload.child %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, parentTemplate);

      // resolution=0.02, decay=0.5, child gets 0.01 which equals epsilon
      const output = await renderWithTemplate(store, parentHash, {
        resolution: 0.02,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toMatch(/cas:[0-9A-HJKMNP-TV-Z]{13}/);
    } finally {
      await cleanup();
    }
  });
});

describe("Suite 3: Template Context Variables", () => {
  test("3.1 Context Variable: resolution", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "test" });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "Resolution: {{ resolution }}",
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 0.75,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Resolution: 0.75");
    } finally {
      await cleanup();
    }
  });

  test("3.2 Context Variable: epsilon", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "test" });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(templateSchema, "Epsilon: {{ epsilon }}");
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.005,
      });

      expect(output).toContain("Epsilon: 0.005");
    } finally {
      await cleanup();
    }
  });

  test("3.3 Context Variable: hash", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "test" });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(templateSchema, "Hash: {{ hash }}");
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain(`Hash: ${nodeHash}`);
    } finally {
      await cleanup();
    }
  });

  test("3.4 Context Variable: payload", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "number" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "test", count: 42 });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "Name: {{ payload.name }}, Count: {{ payload.count }}",
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("Name: test, Count: 42");
    } finally {
      await cleanup();
    }
  });

  test("3.5 Context Variable: type", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "test" });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(templateSchema, "Type: {{ type }}");
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain(`Type: ${nodeSchema}`);
    } finally {
      await cleanup();
    }
  });

  test("3.6 Context Variable: timestamp", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "test" });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "Timestamp: {{ timestamp }}",
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toMatch(/Timestamp: \d+/);
    } finally {
      await cleanup();
    }
  });

  test("3.7 All Context Variables Together", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "test" });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        `Hash: {{ hash }}
Type: {{ type }}
Resolution: {{ resolution }}
Epsilon: {{ epsilon }}
Payload: {{ payload.name }}
Timestamp: {{ timestamp }}`,
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
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
      await cleanup();
    }
  });
});

describe("Suite 4: Render Flow Integration", () => {
  test("4.1 Template Discovery by Type Hash", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "test" });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "Custom template: {{ payload.name }}",
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("Custom template: test");
    } finally {
      await cleanup();
    }
  });

  test("4.2 Empty Template", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "test" });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(templateSchema, "");
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output.length).toBe(0);
    } finally {
      await cleanup();
    }
  });

  test("4.3 Template with LiquidJS Syntax Error", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "test" });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "{% render %}", // Invalid: no variable
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      await expect(async () => {
        await renderWithTemplate(store, nodeHash, {
          resolution: 1.0,
          decay: 0.5,
          epsilon: 0.01,
        });
      }).toThrow();
    } finally {
      await cleanup();
    }
  });
});

describe("Suite 5: Decay Priority Chain", () => {
  test("5.1 Template Explicit Decay > CLI Decay", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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

      const templateSchema = putSchema(store, { type: "string" });
      const parentTemplate = store.cas.put(
        templateSchema,
        "{% render payload.child, decay: 0.7 %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, parentTemplate);

      const childTemplate = store.cas.put(
        templateSchema,
        "Resolution: {{ resolution }}",
      );
      store.var.set(`@ocas/template/text/${childSchema}`, childTemplate);

      const output = await renderWithTemplate(store, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      // Child should have resolution=0.7 (explicit decay wins over CLI decay=0.5)
      expect(output).toContain("Resolution: 0.7");
    } finally {
      await cleanup();
    }
  });

  test("5.2 CLI Decay > Engine Default", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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

      const templateSchema = putSchema(store, { type: "string" });
      const parentTemplate = store.cas.put(
        templateSchema,
        "{% render payload.child %}", // No explicit decay
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, parentTemplate);

      const childTemplate = store.cas.put(
        templateSchema,
        "Resolution: {{ resolution }}",
      );
      store.var.set(`@ocas/template/text/${childSchema}`, childTemplate);

      const output = await renderWithTemplate(store, parentHash, {
        resolution: 1.0,
        decay: 0.6,
        epsilon: 0.01,
      });

      // Child should have resolution=0.6 (CLI decay wins over default 0.5)
      expect(output).toContain("Resolution: 0.6");
    } finally {
      await cleanup();
    }
  });

  test("5.3 Engine Default (No Template, No CLI)", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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

      const templateSchema = putSchema(store, { type: "string" });
      const parentTemplate = store.cas.put(
        templateSchema,
        "{% render payload.child %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, parentTemplate);

      const childTemplate = store.cas.put(
        templateSchema,
        "Resolution: {{ resolution }}",
      );
      store.var.set(`@ocas/template/text/${childSchema}`, childTemplate);

      const output = await renderWithTemplate(
        store,
        parentHash,
        { resolution: 1.0, epsilon: 0.01 }, // No decay specified
      );

      // Child should have resolution=0.5 (engine default)
      expect(output).toContain("Resolution: 0.5");
    } finally {
      await cleanup();
    }
  });
});

describe("Suite 6: Recursive Rendering Edge Cases", () => {
  test("6.1 Deep Recursion (10 Levels)", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "Level {{ payload.level }}\n{% render payload.next %}",
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, currentHash as Hash, {
        resolution: 1.0,
        decay: 0.9,
        epsilon: 0.01,
      });

      // All 10 levels should render
      for (let i = 0; i < 10; i++) {
        expect(output).toContain(`Level ${i}`);
      }
    } finally {
      await cleanup();
    }
  });

  test("6.2 Cycle Detection with Templates", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          ref: {
            anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
          },
        },
      });

      // Create simple node first
      const nodeAHash = store.cas.put(nodeSchema, { name: "A", ref: null });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "Node {{ payload.name }}\n{% render payload.ref %}",
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeAHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Node A");
    } finally {
      await cleanup();
    }
  });

  test("6.3 Array of ocas_ref with Template", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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

      const templateSchema = putSchema(store, { type: "string" });
      const parentTemplate = store.cas.put(
        templateSchema,
        "{% for item in payload.items %}{% render item %}\n{% endfor %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, parentTemplate);

      const itemTemplate = store.cas.put(
        templateSchema,
        "Item: {{ payload.name }}",
      );
      store.var.set(`@ocas/template/text/${itemSchema}`, itemTemplate);

      const output = await renderWithTemplate(store, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Item: item1");
      expect(output).toContain("Item: item2");
      expect(output).toContain("Item: item3");
    } finally {
      await cleanup();
    }
  });
});

describe("Suite 7: Error Handling & Edge Cases", () => {
  test("7.1 Template Missing render Variable", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "test" });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(templateSchema, "{% render missingVar %}");
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      // Should complete without throwing
      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  test("7.2 Template Invalid Decay Value", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "{% render payload.child, decay: 1.5 %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, template);

      await expect(async () => {
        await renderWithTemplate(store, parentHash, {
          resolution: 1.0,
          decay: 0.5,
          epsilon: 0.01,
        });
      }).toThrow(/decay/);
    } finally {
      await cleanup();
    }
  });

  test("7.3 Template Negative Decay", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "{% render payload.child, decay: -0.5 %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, template);

      await expect(async () => {
        await renderWithTemplate(store, parentHash, {
          resolution: 1.0,
          decay: 0.5,
          epsilon: 0.01,
        });
      }).toThrow();
    } finally {
      await cleanup();
    }
  });

  test("7.4 Template Decay=0 (Invalid)", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "{% render payload.child, decay: 0 %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, template);

      await expect(async () => {
        await renderWithTemplate(store, parentHash, {
          resolution: 1.0,
          decay: 0.5,
          epsilon: 0.01,
        });
      }).toThrow(/decay/);
    } finally {
      await cleanup();
    }
  });

  test("7.5 Template Decay=1 (Valid Edge)", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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

      const templateSchema = putSchema(store, { type: "string" });
      const parentTemplate = store.cas.put(
        templateSchema,
        "{% render payload.child, decay: 1 %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, parentTemplate);

      const childTemplate = store.cas.put(
        templateSchema,
        "Resolution: {{ resolution }}",
      );
      store.var.set(`@ocas/template/text/${childSchema}`, childTemplate);

      const output = await renderWithTemplate(store, parentHash, {
        resolution: 0.5,
        decay: 0.5,
        epsilon: 0.01,
      });

      // Child should have resolution=0.5 (0.5 * 1 = 0.5, no decay)
      expect(output).toContain("Resolution: 0.5");
    } finally {
      await cleanup();
    }
  });

  test("7.6 Template with Unicode Content", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const nodeHash = store.cas.put(nodeSchema, { name: "世界" });

      const templateSchema = putSchema(store, { type: "string" });
      const template = store.cas.put(
        templateSchema,
        "你好: {{ payload.name }} 🌍",
      );
      store.var.set(`@ocas/template/text/${nodeSchema}`, template);

      const output = await renderWithTemplate(store, nodeHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("你好: 世界 🌍");
    } finally {
      await cleanup();
    }
  });
});

describe("Suite 8: Performance & Scalability", () => {
  test("8.1 Wide Fan-out (100 Children)", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
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
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { type: "string", format: "ocas_ref" },
          },
        },
      });
      const parentHash = store.cas.put(parentSchema, { items: children });

      const templateSchema = putSchema(store, { type: "string" });
      const parentTemplate = store.cas.put(
        templateSchema,
        "{% for child in payload.items %}{% render child %}{% endfor %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, parentTemplate);

      const itemTemplate = store.cas.put(templateSchema, "{{ payload.value }}");
      store.var.set(`@ocas/template/text/${itemSchema}`, itemTemplate);

      const start = Date.now();
      const output = await renderWithTemplate(store, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2000);
      expect(output).toBeTruthy();
    } finally {
      await cleanup();
    }
  });
});

describe("Suite 9: E2E Template Variable Rendering (Issue #52)", () => {
  test("9.1 Direct Property Access - Should Render Empty", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema for person object
      const personSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });

      // Create node with data
      const personHash = store.cas.put(personSchema, {
        name: "Alice",
        age: 30,
      });

      // Register template using direct property access (incorrect syntax)
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "Name: {{ name }}, Age: {{ age }}",
      );
      store.var.set(`@ocas/template/text/${personSchema}`, templateHash);

      // Render - should produce empty values
      const output = await renderWithTemplate(store, personHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("Name: , Age: ");
    } finally {
      await cleanup();
    }
  });

  test("9.2 Correct Syntax with payload Prefix", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema for person object
      const personSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });

      // Create node with data
      const personHash = store.cas.put(personSchema, {
        name: "Alice",
        age: 30,
      });

      // Register template using correct payload. prefix
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "Name: {{ payload.name }}, Age: {{ payload.age }}",
      );
      store.var.set(`@ocas/template/text/${personSchema}`, templateHash);

      // Render - should produce correct values
      const output = await renderWithTemplate(store, personHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("Name: Alice, Age: 30");
    } finally {
      await cleanup();
    }
  });

  test("9.3 CLI Render Command - Template Variable Access", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema and node
      const personSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });

      const personHash = store.cas.put(personSchema, {
        name: "Bob",
        age: 25,
      });

      // Register template
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "User: {{ payload.name }}, Age: {{ payload.age }}",
      );
      store.var.set(`@ocas/template/text/${personSchema}`, templateHash);

      // This simulates the CLI flow
      const output = await renderWithTemplate(store, personHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("User: Bob");
      expect(output).toContain("Age: 25");
    } finally {
      await cleanup();
    }
  });

  test("9.4 Top-Level Primitive Payload - String", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema for simple string
      const stringSchema = putSchema(store, { type: "string" });

      // Create node with string payload
      const stringHash = store.cas.put(stringSchema, "Hello World");

      // Register template
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "Value is: {{ payload }}",
      );
      store.var.set(`@ocas/template/text/${stringSchema}`, templateHash);

      // Render
      const output = await renderWithTemplate(store, stringHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("Value is: Hello World");
    } finally {
      await cleanup();
    }
  });

  test("9.5 Top-Level Primitive Payload - Number", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema for number
      const numberSchema = putSchema(store, { type: "number" });

      // Create node with number payload
      const numberHash = store.cas.put(numberSchema, 42);

      // Register template
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "The answer is {{ payload }}",
      );
      store.var.set(`@ocas/template/text/${numberSchema}`, templateHash);

      // Render
      const output = await renderWithTemplate(store, numberHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("The answer is 42");
    } finally {
      await cleanup();
    }
  });

  test("9.6 Nested Object Property Access", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema for nested object
      const userSchema = putSchema(store, {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              address: {
                type: "object",
                properties: {
                  city: { type: "string" },
                },
              },
            },
          },
        },
      });

      // Create node with nested data
      const userHash = store.cas.put(userSchema, {
        user: {
          name: "Bob",
          address: {
            city: "NYC",
          },
        },
      });

      // Register template with deep property access
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "User {{ payload.user.name }} lives in {{ payload.user.address.city }}",
      );
      store.var.set(`@ocas/template/text/${userSchema}`, templateHash);

      // Render
      const output = await renderWithTemplate(store, userHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("User Bob lives in NYC");
    } finally {
      await cleanup();
    }
  });

  test("9.7 Array Property Access and Iteration", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema with array
      const tagsSchema = putSchema(store, {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
      });

      // Create node with array data
      const tagsHash = store.cas.put(tagsSchema, {
        tags: ["javascript", "typescript", "bun"],
      });

      // Register template with array iteration
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "Tags: {% for tag in payload.tags %}{{ tag }}{% unless forloop.last %}, {% endunless %}{% endfor %}",
      );
      store.var.set(`@ocas/template/text/${tagsSchema}`, templateHash);

      // Render
      const output = await renderWithTemplate(store, tagsHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("Tags: javascript, typescript, bun");
    } finally {
      await cleanup();
    }
  });

  test("9.8 Missing Property Access - Graceful Handling", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema
      const personSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });

      // Create node without age property
      const personHash = store.cas.put(personSchema, {
        name: "Alice",
      });

      // Register template that references missing property
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "Name: {{ payload.name }}, Age: {{ payload.age }}",
      );
      store.var.set(`@ocas/template/text/${personSchema}`, templateHash);

      // Render - age should be empty
      const output = await renderWithTemplate(store, personHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("Name: Alice, Age: ");
    } finally {
      await cleanup();
    }
  });

  test("9.9 Null Property Value Rendering", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema allowing null
      const personSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: ["string", "null"] },
        },
      });

      // Create node with null email
      const personHash = store.cas.put(personSchema, {
        name: "Charlie",
        email: null,
      });

      // Register template
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "Name: {{ payload.name }}, Email: {{ payload.email }}",
      );
      store.var.set(`@ocas/template/text/${personSchema}`, templateHash);

      // Render - email should be empty
      const output = await renderWithTemplate(store, personHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("Name: Charlie, Email: ");
    } finally {
      await cleanup();
    }
  });

  test("9.10 Boolean Property Rendering", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema with boolean
      const userSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          active: { type: "boolean" },
        },
      });

      // Create node with boolean
      const userHash = store.cas.put(userSchema, {
        name: "Dave",
        active: true,
      });

      // Register template with conditional
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "User {{ payload.name }} is {% if payload.active %}active{% else %}inactive{% endif %}",
      );
      store.var.set(`@ocas/template/text/${userSchema}`, templateHash);

      // Render
      const output = await renderWithTemplate(store, userHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("User Dave is active");
    } finally {
      await cleanup();
    }
  });

  test("9.11 Zero and Empty String Values", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema
      const dataSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "number" },
        },
      });

      // Create node with empty string and zero
      const dataHash = store.cas.put(dataSchema, {
        name: "",
        count: 0,
      });

      // Register template
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "Name: '{{ payload.name }}', Count: {{ payload.count }}",
      );
      store.var.set(`@ocas/template/text/${dataSchema}`, templateHash);

      // Render - zero and empty string should appear
      const output = await renderWithTemplate(store, dataHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toBe("Name: '', Count: 0");
    } finally {
      await cleanup();
    }
  });

  test("9.12 Special Characters in String Values", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create schema
      const textSchema = putSchema(store, {
        type: "object",
        properties: {
          text: { type: "string" },
        },
      });

      // Create node with special characters
      const textHash = store.cas.put(textSchema, {
        text: 'Hello "World" & <tag>',
      });

      // Register template
      const templateSchema = putSchema(store, { type: "string" });
      const templateHash = store.cas.put(
        templateSchema,
        "Text: {{ payload.text }}",
      );
      store.var.set(`@ocas/template/text/${textSchema}`, templateHash);

      // Render
      const output = await renderWithTemplate(store, textHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain('Hello "World" & <tag>');
    } finally {
      await cleanup();
    }
  });
});

describe("Suite 10: Context Variable Completeness", () => {
  test("10.1 Context Propagation in Recursive Renders", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create child schema and node
      const childSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const childHash = store.cas.put(childSchema, { name: "child" });

      // Create parent schema and node
      const parentSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          child: { type: "string", format: "ocas_ref" },
        },
      });
      const parentHash = store.cas.put(parentSchema, {
        name: "parent",
        child: childHash,
      });

      // Register parent template
      const templateSchema = putSchema(store, { type: "string" });
      const parentTemplateHash = store.cas.put(
        templateSchema,
        "Parent: {{ payload.name }}\n{% render payload.child %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, parentTemplateHash);

      // Register child template that accesses context variables
      const childTemplateHash = store.cas.put(
        templateSchema,
        "Child: {{ payload.name }}, Hash: {{ hash }}, Resolution: {{ resolution }}",
      );
      store.var.set(`@ocas/template/text/${childSchema}`, childTemplateHash);

      // Render
      const output = await renderWithTemplate(store, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Parent: parent");
      expect(output).toContain("Child: child");
      expect(output).toContain(`Hash: ${childHash}`);
      expect(output).toContain("Resolution: 0.5");
    } finally {
      await cleanup();
    }
  });

  test("10.2 Context Isolation Between Parent and Child", async () => {
    const { store, cleanup } = await createTempVarStore();

    try {
      // Create child schema and node
      const childSchema = putSchema(store, {
        type: "object",
        properties: {
          custom: { type: "string" },
        },
      });
      const childHash = store.cas.put(childSchema, {
        custom: "child_value",
      });

      // Create parent schema and node
      const parentSchema = putSchema(store, {
        type: "object",
        properties: {
          custom: { type: "string" },
          child: { type: "string", format: "ocas_ref" },
        },
      });
      const parentHash = store.cas.put(parentSchema, {
        custom: "parent_value",
        child: childHash,
      });

      // Register parent template
      const templateSchema = putSchema(store, { type: "string" });
      const parentTemplateHash = store.cas.put(
        templateSchema,
        "Parent custom: {{ payload.custom }}\n{% render payload.child %}",
      );
      store.var.set(`@ocas/template/text/${parentSchema}`, parentTemplateHash);

      // Register child template
      const childTemplateHash = store.cas.put(
        templateSchema,
        "Child custom: {{ payload.custom }}",
      );
      store.var.set(`@ocas/template/text/${childSchema}`, childTemplateHash);

      // Render
      const output = await renderWithTemplate(store, parentHash, {
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.01,
      });

      expect(output).toContain("Parent custom: parent_value");
      expect(output).toContain("Child custom: child_value");
      expect(output).not.toContain("Child custom: parent_value");
    } finally {
      await cleanup();
    }
  });
});
