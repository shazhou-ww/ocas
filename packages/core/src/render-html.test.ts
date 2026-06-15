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
    test("falls back to structured HTML when no HTML template exists", async () => {
      const store = createMemoryStore();
      bootstrap(store);

      const personSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });

      // NO HTML template registered - should fall back to structured HTML
      const personHash = store.cas.put(personSchema, { name: "Bob", age: 25 });

      // Render with HTML format
      const output = await renderAsync(store, personHash, { format: "html" });

      // Should contain structured HTML (not <pre><code> YAML)
      expect(output).toContain("<ul");
      expect(output).toContain("name");
      expect(output).toContain("Bob");
      expect(output).toContain("age");
      expect(output).toContain("25");
      expect(output).not.toContain("<pre><code>");
    });

    test("fallback escapes HTML special characters in values", async () => {
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

      // Angle brackets should be escaped in the fallback
      expect(output).toContain("&lt;script&gt;");
      expect(output).not.toContain("<script>alert");
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

    test("custom @ocas/template-compose/html overrides builtin", async () => {
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
      store.var.set("@ocas/template-compose/html", composeHash);

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

  test("fallback structured HTML is also wrapped in builtin HTML shell", async () => {
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
    // Should use structured HTML, not <pre><code>
    expect(output).toContain("<ul");
    expect(output).toContain("fallback");
    expect(output).not.toContain("<pre><code>");
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

  describe("Type statics — CSS/JS dedup + compose injection (Phase 2b)", () => {
    test("static template CSS/JS appears in rendered HTML document", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const personSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });

      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");

      // Register HTML instance template
      const templateContent =
        '<div class="person"><h2>{{ name }}</h2><p>Age: {{ age }}</p></div>';
      const templateHash = store.cas.put(stringHash, templateContent);
      store.var.set(`@ocas/template/html/${personSchema}`, templateHash);

      // Register static template with CSS and JS
      const staticContent =
        '{"css": ".person { color: blue; font-size: 14px; }", "js": "console.log(\'person loaded\');"}';
      const staticHash = store.cas.put(stringHash, staticContent);
      store.var.set(`@ocas/template-static/html/${personSchema}`, staticHash);

      // Create a person node
      const personHash = store.cas.put(personSchema, {
        name: "Alice",
        age: 30,
      });

      const output = await renderAsync(store, personHash, { format: "html" });

      // Should contain the rendered instance content
      expect(output).toContain('<div class="person">');
      expect(output).toContain("<h2>Alice</h2>");

      // CSS should appear in <style> within <head>
      expect(output).toContain(
        "<style>.person { color: blue; font-size: 14px; }</style>",
      );

      // JS should appear in <script> at bottom of <body>
      expect(output).toContain(
        "<script>console.log('person loaded');</script>",
      );

      // CSS appears before </head> (in the head section)
      const headEnd = output.indexOf("</head>");
      const stylePos = output.indexOf("<style>");
      expect(stylePos).toBeGreaterThan(-1);
      expect(stylePos).toBeLessThan(headEnd);

      // JS appears after content but before </body>
      const bodyEnd = output.indexOf("</body>");
      const scriptPos = output.indexOf("<script>");
      expect(scriptPos).toBeGreaterThan(-1);
      expect(scriptPos).toBeLessThan(bodyEnd);
    });

    test("same type appearing multiple times — CSS/JS injected only once", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const personSchema = putSchema(store, {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });

      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");

      // Register person HTML template
      const templateContent = '<span class="person">{{ name }}</span>';
      const templateHash = store.cas.put(stringHash, templateContent);
      store.var.set(`@ocas/template/html/${personSchema}`, templateHash);

      // Register person static template with CSS only
      const staticContent = '{"css": ".person { margin: 8px; }"}';
      const staticHash = store.cas.put(stringHash, staticContent);
      store.var.set(`@ocas/template-static/html/${personSchema}`, staticHash);

      // Create 3 person nodes
      const alice = store.cas.put(personSchema, { name: "Alice" });
      const bob = store.cas.put(personSchema, { name: "Bob" });
      const charlie = store.cas.put(personSchema, { name: "Charlie" });

      // Container schema referencing all 3
      const containerSchema = putSchema(store, {
        type: "object",
        properties: {
          people: {
            type: "array",
            items: { type: "string", format: "ocas_ref" },
          },
        },
      });

      // Container HTML template
      const containerTemplate =
        '<div class="list">{% for p in people %}{% render p %}{% endfor %}</div>';
      const containerTemplateHash = store.cas.put(
        stringHash,
        containerTemplate,
      );
      store.var.set(
        `@ocas/template/html/${containerSchema}`,
        containerTemplateHash,
      );

      const containerHash = store.cas.put(containerSchema, {
        people: [alice, bob, charlie],
      });

      const output = await renderAsync(store, containerHash, {
        format: "html",
      });

      // All 3 people should be rendered
      expect(output).toContain("Alice");
      expect(output).toContain("Bob");
      expect(output).toContain("Charlie");

      // CSS should appear exactly ONCE (dedup at type level)
      const cssMatch = output.match(
        /<style>\.person \{ margin: 8px; \}<\/style>/g,
      );
      expect(cssMatch).toHaveLength(1);
    });

    test("builtin HTML shell injects type_statics CSS in head and JS in body", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const schema = putSchema(store, {
        type: "object",
        properties: { msg: { type: "string" } },
      });

      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");

      // Register instance template
      const templateContent = "<p>{{ msg }}</p>";
      const templateHash = store.cas.put(stringHash, templateContent);
      store.var.set(`@ocas/template/html/${schema}`, templateHash);

      // Register static template with both CSS and JS
      const staticContent = '{"css": "body { margin: 0; }", "js": "init();"}';
      const staticHash = store.cas.put(stringHash, staticContent);
      store.var.set(`@ocas/template-static/html/${schema}`, staticHash);

      // No custom compose template registered
      const nodeHash = store.cas.put(schema, { msg: "hello" });

      const output = await renderAsync(store, nodeHash, { format: "html" });

      // Complete HTML5 document
      expect(output).toContain("<!DOCTYPE html>");
      expect(output).toContain("<html");
      expect(output).toContain("</html>");

      // CSS in <head>
      expect(output).toContain("<style>body { margin: 0; }</style>");
      const headEnd = output.indexOf("</head>");
      const stylePos = output.indexOf("<style>body");
      expect(stylePos).toBeLessThan(headEnd);

      // JS at bottom of <body>
      expect(output).toContain("<script>init();</script>");
      const bodyEnd = output.indexOf("</body>");
      const scriptPos = output.indexOf("<script>init");
      expect(scriptPos).toBeLessThan(bodyEnd);

      // Content inside <body>
      expect(output).toContain("<p>hello</p>");
      const bodyStart = output.indexOf("<body>");
      const contentPos = output.indexOf("<p>hello</p>");
      expect(contentPos).toBeGreaterThan(bodyStart);
      expect(contentPos).toBeLessThan(bodyEnd);
    });

    test("types without static templates render normally with empty statics", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const noteSchema = putSchema(store, {
        type: "object",
        properties: { text: { type: "string" } },
      });

      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");

      // Register HTML template — but NO static template
      const templateContent = '<div class="note">{{ text }}</div>';
      const templateHash = store.cas.put(stringHash, templateContent);
      store.var.set(`@ocas/template/html/${noteSchema}`, templateHash);

      const noteHash = store.cas.put(noteSchema, { text: "Hello world" });

      const output = await renderAsync(store, noteHash, { format: "html" });

      // Renders normally
      expect(output).toContain('<div class="note">Hello world</div>');

      // Complete HTML5 document
      expect(output).toContain("<!DOCTYPE html>");
      expect(output).toContain("<html");

      // No <style> or <script> tags for the note type
      expect(output).not.toContain("<style>");
      expect(output).not.toContain("<script>");
    });

    test("custom compose template receives and renders type_statics", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const schema = putSchema(store, {
        type: "object",
        properties: { title: { type: "string" } },
      });

      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");

      // Register instance template
      const templateContent = "<h1>{{ title }}</h1>";
      const templateHash = store.cas.put(stringHash, templateContent);
      store.var.set(`@ocas/template/html/${schema}`, templateHash);

      // Register static template
      const staticContent = '{"css": ".custom { display: flex; }"}';
      const staticHash = store.cas.put(stringHash, staticContent);
      store.var.set(`@ocas/template-static/html/${schema}`, staticHash);

      // Register custom compose template that iterates type_statics
      const customCompose = `<!DOCTYPE html>
<html>
<head>
  <title>Custom App</title>
  {% for ts in type_statics %}
    {% if ts.css %}<style>{{ ts.css }}</style>{% endif %}
  {% endfor %}
</head>
<body>
  <main>{{ content }}</main>
  {% for ts in type_statics %}
    {% if ts.js %}<script>{{ ts.js }}</script>{% endif %}
  {% endfor %}
</body>
</html>`;
      const composeHash = store.cas.put(stringHash, customCompose);
      store.var.set("@ocas/template-compose/html", composeHash);

      const nodeHash = store.cas.put(schema, { title: "My Page" });

      const output = await renderAsync(store, nodeHash, { format: "html" });

      // Custom compose was used
      expect(output).toContain("<title>Custom App</title>");
      // Content rendered inside <main>
      expect(output).toContain("<main><h1>My Page</h1></main>");
      // CSS rendered via for loop
      expect(output).toContain("<style>.custom { display: flex; }</style>");
    });

    test("type_statics passed as iterable array with type_hash and slots", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const personSchema = putSchema(store, {
        type: "object",
        properties: { name: { type: "string" } },
      });

      const docSchema = putSchema(store, {
        type: "object",
        properties: { body: { type: "string" } },
      });

      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");

      // Register templates for both types
      const personTemplate = "<span>{{ name }}</span>";
      const personTemplateHash = store.cas.put(stringHash, personTemplate);
      store.var.set(`@ocas/template/html/${personSchema}`, personTemplateHash);

      const docTemplate = "<article>{{ body }}</article>";
      const docTemplateHash = store.cas.put(stringHash, docTemplate);
      store.var.set(`@ocas/template/html/${docSchema}`, docTemplateHash);

      // Static templates: person has CSS+JS, doc has CSS only
      const personStatic =
        '{"css": ".person { color: blue; }", "js": "initPerson();"}';
      const personStaticHash = store.cas.put(stringHash, personStatic);
      store.var.set(
        `@ocas/template-static/html/${personSchema}`,
        personStaticHash,
      );

      const docStatic = '{"css": ".doc { padding: 16px; }"}';
      const docStaticHash = store.cas.put(stringHash, docStatic);
      store.var.set(`@ocas/template-static/html/${docSchema}`, docStaticHash);

      // Custom compose that outputs JSON for introspection
      const composeTemplate =
        "STATICS_JSON:{{ type_statics | json }}:END\n{{ content }}";
      const composeHash = store.cas.put(stringHash, composeTemplate);
      store.var.set("@ocas/template-compose/html", composeHash);

      // Root referencing both types
      const rootSchema = putSchema(store, {
        type: "object",
        properties: {
          person: { type: "string", format: "ocas_ref" },
          doc: { type: "string", format: "ocas_ref" },
        },
      });

      const rootTemplate = "<div>{% render person %}{% render doc %}</div>";
      const rootTemplateHash = store.cas.put(stringHash, rootTemplate);
      store.var.set(`@ocas/template/html/${rootSchema}`, rootTemplateHash);

      const personHash = store.cas.put(personSchema, { name: "Alice" });
      const docHash = store.cas.put(docSchema, { body: "Content" });
      const rootHash = store.cas.put(rootSchema, {
        person: personHash,
        doc: docHash,
      });

      const output = await renderAsync(store, rootHash, { format: "html" });

      // Extract JSON from compose output
      const jsonMatch = output.match(/STATICS_JSON:(.*?):END/);
      expect(jsonMatch).not.toBeNull();
      const statics = JSON.parse(jsonMatch?.[1] ?? "");

      // type_statics is an array
      expect(Array.isArray(statics)).toBe(true);

      // Each element has type_hash
      for (const entry of statics) {
        expect(entry).toHaveProperty("type_hash");
        expect(typeof entry.type_hash).toBe("string");
      }

      // Find person entry
      const personEntry = statics.find(
        (e: Record<string, string>) => e.type_hash === personSchema,
      );
      expect(personEntry).toBeDefined();
      expect(personEntry.css).toBe(".person { color: blue; }");
      expect(personEntry.js).toBe("initPerson();");

      // Find doc entry
      const docEntry = statics.find(
        (e: Record<string, string>) => e.type_hash === docSchema,
      );
      expect(docEntry).toBeDefined();
      expect(docEntry.css).toBe(".doc { padding: 16px; }");
      expect(docEntry).not.toHaveProperty("js"); // No JS for doc
    });

    test("types without static templates are excluded from type_statics array", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const withStatic = putSchema(store, {
        type: "object",
        properties: { a: { type: "string" } },
      });
      const withoutStatic = putSchema(store, {
        type: "object",
        properties: { b: { type: "string" } },
      });

      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");

      // Templates for both
      store.var.set(
        `@ocas/template/html/${withStatic}`,
        store.cas.put(stringHash, "<p>{{ a }}</p>"),
      );
      store.var.set(
        `@ocas/template/html/${withoutStatic}`,
        store.cas.put(stringHash, "<p>{{ b }}</p>"),
      );

      // Static template only for the first type
      store.var.set(
        `@ocas/template-static/html/${withStatic}`,
        store.cas.put(stringHash, '{"css": ".a {}"}'),
      );

      // Compose template that outputs statics count
      const composeTemplate =
        "COUNT:{{ type_statics.size }}:END\nARRAY:{{ type_statics | json }}:END\n{{ content }}";
      store.var.set(
        "@ocas/template-compose/html",
        store.cas.put(stringHash, composeTemplate),
      );

      // Root references both types
      const rootSchema = putSchema(store, {
        type: "object",
        properties: {
          c1: { type: "string", format: "ocas_ref" },
          c2: { type: "string", format: "ocas_ref" },
        },
      });
      store.var.set(
        `@ocas/template/html/${rootSchema}`,
        store.cas.put(stringHash, "<div>{% render c1 %}{% render c2 %}</div>"),
      );

      const h1 = store.cas.put(withStatic, { a: "A" });
      const h2 = store.cas.put(withoutStatic, { b: "B" });
      const rootHash = store.cas.put(rootSchema, { c1: h1, c2: h2 });

      const output = await renderAsync(store, rootHash, { format: "html" });

      // Extract array
      const jsonMatch = output.match(/ARRAY:(.*?):END/);
      expect(jsonMatch).not.toBeNull();
      const arr = JSON.parse(jsonMatch?.[1] ?? "");

      // Only the type with a static template should be in the array
      expect(arr).toHaveLength(1);
      expect(arr[0].type_hash).toBe(withStatic);
    });

    test("multiple type_statics entries generate separate style and script blocks", async () => {
      const store = createMemoryStore();
      const aliases = bootstrap(store);

      const t1 = putSchema(store, {
        type: "object",
        properties: { x: { type: "string" } },
      });
      const t2 = putSchema(store, {
        type: "object",
        properties: { y: { type: "string" } },
      });

      const stringHash = aliases["@ocas/string"];
      if (!stringHash) throw new Error("@ocas/string not found");

      // Templates
      store.var.set(
        `@ocas/template/html/${t1}`,
        store.cas.put(stringHash, "<p>{{ x }}</p>"),
      );
      store.var.set(
        `@ocas/template/html/${t2}`,
        store.cas.put(stringHash, "<p>{{ y }}</p>"),
      );

      // Static templates for both
      store.var.set(
        `@ocas/template-static/html/${t1}`,
        store.cas.put(
          stringHash,
          '{"css": "/* t1 css */", "js": "/* t1 js */"}',
        ),
      );
      store.var.set(
        `@ocas/template-static/html/${t2}`,
        store.cas.put(
          stringHash,
          '{"css": "/* t2 css */", "js": "/* t2 js */"}',
        ),
      );

      // No custom compose — uses builtin
      const rootSchema = putSchema(store, {
        type: "object",
        properties: {
          c1: { type: "string", format: "ocas_ref" },
          c2: { type: "string", format: "ocas_ref" },
        },
      });
      store.var.set(
        `@ocas/template/html/${rootSchema}`,
        store.cas.put(stringHash, "<div>{% render c1 %}{% render c2 %}</div>"),
      );

      const h1 = store.cas.put(t1, { x: "X" });
      const h2 = store.cas.put(t2, { y: "Y" });
      const rootHash = store.cas.put(rootSchema, { c1: h1, c2: h2 });

      const output = await renderAsync(store, rootHash, { format: "html" });

      // Each type's CSS produces one <style> block
      expect(output).toContain("<style>/* t1 css */</style>");
      expect(output).toContain("<style>/* t2 css */</style>");

      // Each type's JS produces one <script> block
      expect(output).toContain("<script>/* t1 js */</script>");
      expect(output).toContain("<script>/* t2 js */</script>");

      // Verify document structure: styles in head, scripts in body
      const headEnd = output.indexOf("</head>");
      const bodyEnd = output.indexOf("</body>");
      expect(output.indexOf("<style>/* t1 css */</style>")).toBeLessThan(
        headEnd,
      );
      expect(output.indexOf("<style>/* t2 css */</style>")).toBeLessThan(
        headEnd,
      );
      expect(output.indexOf("<script>/* t1 js */</script>")).toBeLessThan(
        bodyEnd,
      );
      expect(output.indexOf("<script>/* t2 js */</script>")).toBeLessThan(
        bodyEnd,
      );
    });
  });
});
