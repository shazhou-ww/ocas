import { describe, expect, test } from "vitest";
import { bootstrap } from "./bootstrap.js";
import { renderAsync } from "./render.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";

describe("HTML Render MVP", () => {
  describe("HTML template discovery", () => {
    test("discovers HTML instance template from @ocas/template/html/<type-hash>", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      // Create a simple schema
      const personSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });

      // Register HTML template for this schema
      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");
      const templateContent =
        '<div class="person"><h2>{{ payload.name }}</h2><p>Age: {{ payload.age }}</p></div>';
      const templateHash = store.cas.put(stringHash, templateContent);
      store.var.set(`@ocas/template/html/${personSchema}`, templateHash);

      // Create a person node
      const personHash = store.cas.put(personSchema, {
        name: "Alice",
        age: 30,
      });

      // Render with HTML format
      const output = await renderAsync(store, personHash, { format: "html" });

      // Should contain the rendered HTML fragment
      expect(output).toContain('<div class="person">');
      expect(output).toContain("<h2>Alice</h2>");
      expect(output).toContain("<p>Age: 30</p>");
    });

    test("HTML template uses LiquidJS engine", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const listSchema = putSchema(store, {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { type: "string" },
          },
        },
      });

      // Register HTML template with LiquidJS loop
      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");
      const templateContent =
        "<ul>{% for item in payload.items %}<li>{{ item }}</li>{% endfor %}</ul>";
      const templateHash = store.cas.put(stringHash, templateContent);
      store.var.set(`@ocas/template/html/${listSchema}`, templateHash);

      // Create a list node
      const listHash = store.cas.put(listSchema, {
        items: ["one", "two", "three"],
      });

      // Render with HTML format
      const output = await renderAsync(store, listHash, { format: "html" });

      // Should contain the rendered list
      expect(output).toContain("<ul>");
      expect(output).toContain("<li>one</li>");
      expect(output).toContain("<li>two</li>");
      expect(output).toContain("<li>three</li>");
      expect(output).toContain("</ul>");
    });
  });

  describe("YAML fallback for missing HTML templates", () => {
    test("falls back to YAML in <pre><code> when no HTML template exists", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const personSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });

      // NO HTML template registered - should fall back
      const personHash = store.cas.put(personSchema, { name: "Bob", age: 25 });

      // Render with HTML format
      const output = await renderAsync(store, personHash, { format: "html" });

      // Should contain YAML wrapped in <pre><code>
      expect(output).toContain("<pre><code>");
      expect(output).toContain("name:");
      expect(output).toContain("Bob");
      expect(output).toContain("age:");
      expect(output).toContain("25");
      expect(output).toContain("</code></pre>");
    });

    test("fallback escapes HTML special characters in YAML content", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const schema = putSchema(store, {
        type: "object",
        properties: {
          html: { type: "string" },
        },
      });

      // Payload contains HTML-unsafe characters
      const hash = store.cas.put(schema, {
        html: '<script>alert("xss")</script>',
      });

      const output = await renderAsync(store, hash, { format: "html" });

      // Angle brackets should be escaped in the fallback YAML
      expect(output).toContain("&lt;script&gt;");
      expect(output).not.toContain("<script>");
    });
  });

  describe("HTML compose templates", () => {
    test("uses builtin compose template when none is registered", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const simpleSchema = putSchema(store, {
        type: "object",
        properties: { message: { type: "string" } },
      });

      // Register HTML instance template
      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");
      const templateContent = "<div>{{ payload.message }}</div>";
      const templateHash = store.cas.put(stringHash, templateContent);
      store.var.set(`@ocas/template/html/${simpleSchema}`, templateHash);

      const nodeHash = store.cas.put(simpleSchema, { message: "Hello" });

      const output = await renderAsync(store, nodeHash, { format: "html" });

      // Should have complete HTML document structure
      expect(output).toContain("<!DOCTYPE html>");
      expect(output).toContain("<html");
      expect(output).toContain("<head>");
      expect(output).toContain('<meta charset="UTF-8">');
      expect(output).toContain("</head>");
      expect(output).toContain("<body>");
      expect(output).toContain("<div>Hello</div>");
      expect(output).toContain("</body>");
      expect(output).toContain("</html>");
    });

    test("custom @ocas/template/html/_compose overrides builtin", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const simpleSchema = putSchema(store, {
        type: "object",
        properties: { message: { type: "string" } },
      });

      // Register HTML instance template
      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");
      const templateContent = "<p>{{ payload.message }}</p>";
      const templateHash = store.cas.put(stringHash, templateContent);
      store.var.set(`@ocas/template/html/${simpleSchema}`, templateHash);

      // Register custom compose template
      const customCompose =
        '<!DOCTYPE html>\n<html>\n<head><title>Custom</title></head>\n<body class="custom">\n{{ content }}\n</body>\n</html>';
      const composeHash = store.cas.put(stringHash, customCompose);
      store.var.set("@ocas/template/html/_compose", composeHash);

      const nodeHash = store.cas.put(simpleSchema, { message: "Custom Shell" });

      const output = await renderAsync(store, nodeHash, { format: "html" });

      // Should use custom shell
      expect(output).toContain("<!DOCTYPE html>");
      expect(output).toContain("<title>Custom</title>");
      expect(output).toContain('<body class="custom">');
      expect(output).toContain("<p>Custom Shell</p>");
    });
  });

  describe("Text format backward compatibility", () => {
    test("text format remains unchanged by HTML feature", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const textSchema = putSchema(store, { type: "string" });
      const hash = store.cas.put(textSchema, "hello");

      // Default format (text)
      const output1 = await renderAsync(store, hash);
      expect(output1).toContain("hello");
      expect(output1).not.toContain("<html>");
      expect(output1).not.toContain("<!DOCTYPE");

      // Explicit text format
      const output2 = await renderAsync(store, hash, { format: "text" });
      expect(output2).toContain("hello");
      expect(output2).not.toContain("<html>");

      // Both should be identical
      expect(output1).toBe(output2);
    });
  });

  test("fallback YAML is also wrapped in builtin HTML shell", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const schema = putSchema(store, {
      type: "object",
      properties: { name: { type: "string" } },
    });

    // No HTML template registered
    const hash = store.cas.put(schema, { name: "fallback" });

    const output = await renderAsync(store, hash, { format: "html" });

    // Should have full HTML document structure even in fallback
    expect(output).toContain("<!DOCTYPE html>");
    expect(output).toContain("<html");
    expect(output).toContain("<body>");
    expect(output).toContain("<pre><code>");
    expect(output).toContain("</code></pre>");
    expect(output).toContain("</body>");
    expect(output).toContain("</html>");
  });

  describe("Self-contained HTML output", () => {
    test("HTML output is a valid complete document", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const dataSchema = putSchema(store, {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
        },
      });

      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");
      const templateContent =
        "<article><h1>{{ payload.title }}</h1><div>{{ payload.content }}</div></article>";
      const templateHash = store.cas.put(stringHash, templateContent);
      store.var.set(`@ocas/template/html/${dataSchema}`, templateHash);

      const nodeHash = store.cas.put(dataSchema, {
        title: "Test Article",
        content: "This is content",
      });

      const output = await renderAsync(store, nodeHash, { format: "html" });

      // Valid HTML5 document
      expect(output.trim()).toMatch(/^<!DOCTYPE html>/i);
      expect(output).toContain("<html");
      expect(output).toContain("</html>");
      expect(output).toContain("<head>");
      expect(output).toContain("</head>");
      expect(output).toContain("<body>");
      expect(output).toContain("</body>");

      // Content is embedded
      expect(output).toContain("<article>");
      expect(output).toContain("<h1>Test Article</h1>");
      expect(output).toContain("<div>This is content</div>");
    });
  });
});
