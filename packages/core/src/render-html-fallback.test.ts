import { describe, expect, test } from "vitest";
import { bootstrap } from "./bootstrap.js";
import { renderAsync } from "./render.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";

describe("Structured HTML Fallback (#179)", () => {
  describe("Object payloads → <ul> key-value lists", () => {
    test("renders object payload as <ul> with <li> per key-value pair", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const personSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });

      // No HTML template registered
      const hash = store.cas.put(personSchema, { name: "Alice", age: 30 });
      const output = await renderAsync(store, hash, { format: "html" });

      // Should use <ul> structure, not <pre><code> YAML
      expect(output).toContain("<ul");
      expect(output).toContain("<li");
      expect(output).not.toContain("<pre><code>");
      // Key-value pairs visible
      expect(output).toContain("name");
      expect(output).toContain("Alice");
      expect(output).toContain("age");
      expect(output).toContain("30");
    });

    test("key ordering matches object's own key order", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const schema = putSchema(store, {
        type: "object",
        properties: {
          zebra: { type: "string" },
          alpha: { type: "string" },
        },
      });

      const hash = store.cas.put(schema, { zebra: "z", alpha: "a" });
      const output = await renderAsync(store, hash, { format: "html" });

      // zebra should appear before alpha
      const zebraPos = output.indexOf("zebra");
      const alphaPos = output.indexOf("alpha");
      expect(zebraPos).toBeLessThan(alphaPos);
    });
  });

  describe("Array payloads → <ul> lists", () => {
    test("renders array payload as <ul> with <li> per item", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const arraySchema = putSchema(store, {
        type: "array",
        items: { type: "string" },
      });

      const hash = store.cas.put(arraySchema, ["apple", "banana", "cherry"]);
      const output = await renderAsync(store, hash, { format: "html" });

      expect(output).toContain("<ul");
      expect(output).toContain("<li");
      expect(output).not.toContain("<pre><code>");
      expect(output).toContain("apple");
      expect(output).toContain("banana");
      expect(output).toContain("cherry");
    });

    test("array items appear in original order", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const schema = putSchema(store, {
        type: "array",
        items: { type: "string" },
      });

      const hash = store.cas.put(schema, ["first", "second", "third"]);
      const output = await renderAsync(store, hash, { format: "html" });

      const firstPos = output.indexOf("first");
      const secondPos = output.indexOf("second");
      const thirdPos = output.indexOf("third");
      expect(firstPos).toBeLessThan(secondPos);
      expect(secondPos).toBeLessThan(thirdPos);
    });
  });

  describe("Primitive payloads → inline elements", () => {
    test("string value rendered as inline element", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const strSchema = putSchema(store, { type: "string" });
      const hash = store.cas.put(strSchema, "hello world");
      const output = await renderAsync(store, hash, { format: "html" });

      expect(output).toContain("hello world");
      expect(output).not.toContain("<pre><code>");
    });

    test("number value rendered as inline element", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const numSchema = putSchema(store, { type: "number" });
      const hash = store.cas.put(numSchema, 42);
      const output = await renderAsync(store, hash, { format: "html" });

      expect(output).toContain("42");
      expect(output).not.toContain("<pre><code>");
    });

    test("boolean value rendered as inline element", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const boolSchema = putSchema(store, { type: "boolean" });
      const hash = store.cas.put(boolSchema, true);
      const output = await renderAsync(store, hash, { format: "html" });

      expect(output).toContain("true");
      expect(output).not.toContain("<pre><code>");
    });

    test("HTML special characters are escaped in primitive values", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const schema = putSchema(store, { type: "string" });
      const hash = store.cas.put(schema, '<script>alert("xss")</script>');
      const output = await renderAsync(store, hash, { format: "html" });

      expect(output).toContain("&lt;script&gt;");
      expect(output).not.toContain("<script>alert");
    });
  });

  describe("CAS ref fields → <details>/<summary>", () => {
    test("ocas_ref field renders as <details> with recursive child", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const childSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      const childHash = store.cas.put(childSchema, { name: "ChildNode" });

      const parentSchema = putSchema(store, {
        type: "object",
        properties: {
          author: { type: "string", format: "ocas_ref" },
          title: { type: "string" },
        },
      });
      const parentHash = store.cas.put(parentSchema, {
        author: childHash,
        title: "MyDoc",
      });

      const output = await renderAsync(store, parentHash, { format: "html" });

      // Should contain <details> for the ref field
      expect(output).toContain("<details");
      expect(output).toContain("<summary");
      // The child should be recursively rendered with structured HTML
      expect(output).toContain("ChildNode");
      // The child should NOT be YAML-wrapped
      expect(output).not.toContain("<pre><code>");
    });

    test("summary identifies field name and target hash", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const childSchema = putSchema(store, {
        type: "object",
        properties: { val: { type: "string" } },
      });
      const childHash = store.cas.put(childSchema, { val: "inner" });

      const parentSchema = putSchema(store, {
        type: "object",
        properties: {
          ref: { type: "string", format: "ocas_ref" },
        },
      });
      const parentHash = store.cas.put(parentSchema, { ref: childHash });

      const output = await renderAsync(store, parentHash, { format: "html" });

      // Summary should contain the hash
      expect(output).toContain(childHash);
    });
  });

  describe("Epsilon opaque rendering", () => {
    test("nodes at epsilon show cas:XXXXX without <details>", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      // Create a 3-level chain
      const nodeSchema = putSchema(store, {
        type: "object",
        properties: {
          level: { type: "number" },
          next: {
            anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
          },
        },
      });

      const leaf = store.cas.put(nodeSchema, { level: 2, next: null });
      const mid = store.cas.put(nodeSchema, { level: 1, next: leaf });
      const root = store.cas.put(nodeSchema, { level: 0, next: mid });

      const output = await renderAsync(store, root, {
        format: "html",
        resolution: 1.0,
        decay: 0.5,
        epsilon: 0.3,
      });

      // Root (res=1.0) should be expanded
      expect(output).toContain("level");
      expect(output).toContain("0");
      // Mid (childRes=0.5) should be expanded (0.5 > 0.3)
      // Leaf (childRes=0.25) should be opaque (0.25 < 0.3)
      expect(output).toMatch(/cas:[0-9A-HJKMNP-TV-Z]{13}/);
      // The opaque ref should NOT be in a <details>
      // Count <details> tags - should only be for expanded refs
      const detailsCount = (output.match(/<details/g) ?? []).length;
      // We expect at most 1 <details> (for the mid-level "next" ref)
      expect(detailsCount).toBeLessThanOrEqual(1);
    });
  });

  describe("Custom template priority", () => {
    test("custom HTML template takes priority over structured fallback", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const schema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });

      // Register a custom HTML template
      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");
      const templateContent =
        '<div class="custom"><h2>{{ payload.name }}</h2><p>Age: {{ payload.age }}</p></div>';
      const templateHash = store.cas.put(stringHash, templateContent);
      store.var.set(`@ocas/template/html/${schema}`, templateHash);

      const hash = store.cas.put(schema, { name: "Alice", age: 30 });
      const output = await renderAsync(store, hash, { format: "html" });

      // Should use the custom template, not structured fallback
      expect(output).toContain('<div class="custom">');
      expect(output).toContain("<h2>Alice</h2>");
      // Should NOT contain structured fallback <ul>
      // (the output is a complete HTML doc, so we check body content)
      const bodyContent = output.slice(
        output.indexOf("<body>"),
        output.indexOf("</body>"),
      );
      expect(bodyContent).not.toMatch(/<ul[^>]*>.*?name.*?<\/ul>/s);
    });
  });

  describe("Nested objects and arrays", () => {
    test("nested objects render as nested <ul> structures", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const schema = putSchema(store, {
        type: "object",
        properties: {
          meta: {
            type: "object",
            properties: {
              tags: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
          count: { type: "number" },
        },
      });

      const hash = store.cas.put(schema, {
        meta: { tags: ["a", "b"] },
        count: 5,
      });

      const output = await renderAsync(store, hash, { format: "html" });

      // Should have nested <ul> elements
      const ulCount = (output.match(/<ul/g) ?? []).length;
      expect(ulCount).toBeGreaterThanOrEqual(2); // outer + at least one nested
      expect(output).toContain("meta");
      expect(output).toContain("tags");
      expect(output).toContain("count");
      expect(output).toContain("5");
      expect(output).not.toContain("<pre><code>");
    });

    test("all nesting produces valid HTML with proper closing tags", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const schema = putSchema(store, {
        type: "object",
        properties: {
          nested: {
            type: "object",
            properties: {
              list: { type: "array", items: { type: "number" } },
            },
          },
        },
      });

      const hash = store.cas.put(schema, { nested: { list: [1, 2, 3] } });
      const output = await renderAsync(store, hash, { format: "html" });

      // Count opening and closing tags match
      const openUl = (output.match(/<ul/g) ?? []).length;
      const closeUl = (output.match(/<\/ul>/g) ?? []).length;
      expect(openUl).toBe(closeUl);

      const openLi = (output.match(/<li/g) ?? []).length;
      const closeLi = (output.match(/<\/li>/g) ?? []).length;
      expect(openLi).toBe(closeLi);
    });
  });

  describe("Text format unchanged", () => {
    test("text format still uses plain YAML (no HTML tags)", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const schema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });

      const hash = store.cas.put(schema, { name: "Bob", age: 25 });

      // Default format (text)
      const output = await renderAsync(store, hash);
      expect(output).toContain("name:");
      expect(output).toContain("Bob");
      expect(output).not.toContain("<ul");
      expect(output).not.toContain("<li");
      expect(output).not.toContain("<html>");

      // Explicit text format
      const output2 = await renderAsync(store, hash, { format: "text" });
      expect(output2).toBe(output);
    });
  });

  describe("YAML <pre><code> fallback superseded", () => {
    test("HTML fallback no longer uses <pre><code> YAML wrapping", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const schema = putSchema(store, {
        type: "object",
        properties: { name: { type: "string" } },
      });

      const hash = store.cas.put(schema, { name: "test" });
      const output = await renderAsync(store, hash, { format: "html" });

      expect(output).not.toContain("<pre><code>");
      expect(output).not.toContain("</code></pre>");
    });
  });

  describe("HTML escaping in structured fallback", () => {
    test("escapes HTML in object keys and string values", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const schema = putSchema(store, {
        type: "object",
        properties: {
          html: { type: "string" },
        },
      });

      const hash = store.cas.put(schema, {
        html: '<script>alert("xss")</script>',
      });
      const output = await renderAsync(store, hash, { format: "html" });

      expect(output).toContain("&lt;script&gt;");
      expect(output).not.toContain('<script>alert("xss")');
    });
  });

  describe("Empty containers", () => {
    test("empty object renders appropriately", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const schema = putSchema(store, { type: "object" });
      const hash = store.cas.put(schema, {});
      const output = await renderAsync(store, hash, { format: "html" });

      // Should not have <pre><code>
      expect(output).not.toContain("<pre><code>");
      // Should still be wrapped in the HTML shell
      expect(output).toContain("<!DOCTYPE html>");
    });

    test("empty array renders appropriately", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const schema = putSchema(store, {
        type: "array",
        items: { type: "string" },
      });
      const hash = store.cas.put(schema, []);
      const output = await renderAsync(store, hash, { format: "html" });

      expect(output).not.toContain("<pre><code>");
      expect(output).toContain("<!DOCTYPE html>");
    });
  });
});
