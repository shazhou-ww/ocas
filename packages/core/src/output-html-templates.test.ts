import { describe, expect, test } from "vitest";
import { bootstrap } from "./bootstrap.js";
import { registerOutputTemplates } from "./output-templates.js";
import { renderAsync } from "./render.js";
import { createMemoryStore } from "./store.js";
import type { Hash, Store } from "./types.js";

/** All 24 @ocas/output/* schema aliases. */
const ALL_OUTPUT_ALIASES = [
  "@ocas/output/put",
  "@ocas/output/get",
  "@ocas/output/has",
  "@ocas/output/hash",
  "@ocas/output/verify",
  "@ocas/output/refs",
  "@ocas/output/walk",
  "@ocas/output/list",
  "@ocas/output/list-meta",
  "@ocas/output/list-schema",
  "@ocas/output/var-set",
  "@ocas/output/var-get",
  "@ocas/output/var-delete",
  "@ocas/output/var-list",
  "@ocas/output/var-history",
  "@ocas/output/tag",
  "@ocas/output/untag",
  "@ocas/output/template-set",
  "@ocas/output/template-get",
  "@ocas/output/template-list",
  "@ocas/output/template-delete",
  "@ocas/output/gc",
  "@ocas/output/export",
  "@ocas/output/import",
] as const;

/** Helper: create store, bootstrap, register templates, return everything needed. */
function setup(): {
  store: Store;
  aliases: Record<string, Hash>;
  stringHash: Hash;
} {
  const store = createMemoryStore();
  const aliases = bootstrap(store);
  const stringHash = aliases["@ocas/string"];
  if (!stringHash) throw new Error("@ocas/string not found");
  return { store, aliases, stringHash };
}

/** Helper: put a CAS envelope and render it as HTML. */
async function renderOutput(
  store: Store,
  aliases: Record<string, Hash>,
  alias: string,
  payload: unknown,
): Promise<string> {
  const typeHash = aliases[alias];
  if (!typeHash) throw new Error(`${alias} not found`);
  const hash = store.cas.put(typeHash, payload);
  return renderAsync(store, hash, { format: "html" });
}

// ── Registration ────────────────────────────────────────────────────

describe("HTML template registration", () => {
  test("registers HTML templates for all 24 @ocas/output/* schemas", async () => {
    const { store, aliases, stringHash } = setup();
    const registered = await registerOutputTemplates(store);

    expect(Object.keys(registered)).toHaveLength(ALL_OUTPUT_ALIASES.length);

    for (const alias of ALL_OUTPUT_ALIASES) {
      // Check the return value has the alias
      expect(registered).toHaveProperty(alias);

      // Check the HTML template variable exists
      const schemaHash = aliases[alias];
      if (!schemaHash) throw new Error(`${alias} not found`);
      const varName = `@ocas/template/html/${schemaHash}`;
      const variable = store.var.get(varName, stringHash);
      expect(variable).not.toBeNull();

      // Verify it points to a valid string node
      if (variable !== null) {
        const templateNode = store.cas.get(variable.value);
        expect(templateNode).not.toBeNull();
        if (templateNode !== null) {
          expect(typeof templateNode.payload).toBe("string");
        }
      }
    }
  });

  test("HTML templates are distinct from text templates", async () => {
    const { store, aliases, stringHash } = setup();
    await registerOutputTemplates(store);

    // Pick one alias and verify HTML != text
    const putHash = aliases["@ocas/output/put"];
    if (!putHash) throw new Error("@ocas/output/put not found");

    const textVar = store.var.get(`@ocas/template/text/${putHash}`, stringHash);
    const htmlVar = store.var.get(`@ocas/template/html/${putHash}`, stringHash);

    expect(textVar).not.toBeNull();
    expect(htmlVar).not.toBeNull();

    // Their CAS content hashes should differ (different template strings)
    if (textVar && htmlVar) {
      expect(textVar.value).not.toBe(htmlVar.value);
    }
  });

  test("registration is idempotent", async () => {
    const { store } = setup();
    const first = await registerOutputTemplates(store);
    const second = await registerOutputTemplates(store);
    expect(first).toEqual(second);
  });
});

// ── Missing text templates ──────────────────────────────────────────

describe("Missing text templates filled", () => {
  test("list-meta text template renders like list", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const typeHash = aliases["@ocas/output/list-meta"];
    if (!typeHash) throw new Error("@ocas/output/list-meta not found");
    const hash = store.cas.put(typeHash, [
      { hash: "AAAAAAAAAAAAA", created: 1000, updated: 2000 },
    ]);
    const output = await renderAsync(store, hash, { format: "text" });
    expect(output).toContain("AAAAAAAAAAAAA");
  });

  test("list-schema text template renders like list", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const typeHash = aliases["@ocas/output/list-schema"];
    if (!typeHash) throw new Error("@ocas/output/list-schema not found");
    const hash = store.cas.put(typeHash, [
      { hash: "BBBBBBBBBBBBB", created: 1000, updated: 2000 },
    ]);
    const output = await renderAsync(store, hash, { format: "text" });
    expect(output).toContain("BBBBBBBBBBBBB");
  });

  test("export text template shows counts", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const typeHash = aliases["@ocas/output/export"];
    if (!typeHash) throw new Error("@ocas/output/export not found");
    const hash = store.cas.put(typeHash, { nodes: 10, vars: 5, tags: 3 });
    const output = await renderAsync(store, hash, { format: "text" });
    expect(output).toContain("10");
    expect(output).toContain("5");
    expect(output).toContain("3");
  });

  test("import text template shows nested results", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const typeHash = aliases["@ocas/output/import"];
    if (!typeHash) throw new Error("@ocas/output/import not found");
    const hash = store.cas.put(typeHash, {
      nodes: { imported: 10, skipped: 2 },
      vars: { created: 3, updated: 1 },
      tags: 5,
    });
    const output = await renderAsync(store, hash, { format: "text" });
    expect(output).toContain("10");
    expect(output).toContain("2");
    expect(output).toContain("3");
    expect(output).toContain("1");
    expect(output).toContain("5");
  });
});

// ── Simple value HTML templates (card layout) ──────────────────────

describe("Simple value HTML output", () => {
  test("put: card with 'Stored' header and hash pill", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/put",
      "AAAAAAAAAAAAA",
    );
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Stored");
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<dl");
  });

  test("has: card with 'Exists' header and green badge for true", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/has", true);
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Exists");
    expect(html).toContain("ocas-badge");
    expect(html).toContain("ocas-badge-ok");
    expect(html).toContain("yes");
  });

  test("has: red badge for false", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/has", false);
    expect(html).toContain("ocas-badge-error");
    expect(html).toContain("no");
  });

  test("hash: card with 'Hash' header and hash pill", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/hash",
      "BBBBBBBBBBBBB",
    );
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Hash");
    expect(html).toContain('<code class="ocas-hash">BBBBBBBBBBBBB</code>');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<dl");
  });

  test("verify: card with 'Verify' header and tri-state badges", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    // ok → green badge
    const okHtml = await renderOutput(
      store,
      aliases,
      "@ocas/output/verify",
      "ok",
    );
    expect(okHtml).toContain('class="ocas-card"');
    expect(okHtml).toContain("Verify");
    expect(okHtml).toContain("ocas-badge-ok");
    expect(okHtml).toContain("ok");

    // corrupted → red badge
    const corruptedHtml = await renderOutput(
      store,
      aliases,
      "@ocas/output/verify",
      "corrupted",
    );
    expect(corruptedHtml).toContain("ocas-badge-error");
    expect(corruptedHtml).toContain("corrupted");

    // invalid → yellow badge
    const invalidHtml = await renderOutput(
      store,
      aliases,
      "@ocas/output/verify",
      "invalid",
    );
    expect(invalidHtml).toContain("ocas-badge-warn");
    expect(invalidHtml).toContain("invalid");
  });

  test("template-get: card with 'Template' header and <pre> code block", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/template-get",
      "<div>{{ name }}</div>",
    );
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Template");
    expect(html).toContain('<pre class="ocas-template-content">');
  });

  test("template-delete: card with 'Template Deleted' header and green badge for deleted", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/template-delete",
      { deleted: true },
    );
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Template Deleted");
    expect(html).toContain("ocas-badge-ok");
    expect(html).toContain("deleted");
  });

  test("template-delete: red badge when not found", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/template-delete",
      { deleted: false },
    );
    expect(html).toContain("ocas-badge-error");
    expect(html).toContain("not found");
  });
});

// ── Structured HTML templates (card layout) ────────────────────────

describe("Structured HTML output — card layout", () => {
  // ── @ocas/output/get ──

  test("get: wrapped in ocas-card with 'Node Detail' header", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/get", {
      type: "AAAAAAAAAAAAA",
      payload: { name: "test" },
      timestamp: 1700000000,
    });
    expect(html).toContain('<div class="ocas-card">');
    expect(html).toContain('<div class="ocas-card-header">Node Detail</div>');
  });

  test("get: uses ocas-dl grid with Type and Timestamp rows", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/get", {
      type: "AAAAAAAAAAAAA",
      payload: { name: "test" },
      timestamp: 1700000000,
    });
    expect(html).toContain('<dl class="ocas-dl">');
    expect(html).toContain("<dt>Type</dt>");
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
    expect(html).toContain("<dt>Timestamp</dt>");
    expect(html).toContain("1700000000");
  });

  test("get: renders tag pills with ocas-tag class when tags present", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/get", {
      type: "AAAAAAAAAAAAA",
      payload: "hello",
      timestamp: 1700000000,
      tags: [
        {
          key: "env",
          value: "prod",
          target: "BBBBBBBBBBBBB",
          created: 1700000000,
        },
      ],
    });
    expect(html).toContain("<dt>Tags</dt>");
    expect(html).toContain('<span class="ocas-tag">env:prod</span>');
  });

  test("get: omits tags row when no tags present", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/get", {
      type: "AAAAAAAAAAAAA",
      payload: "hello",
      timestamp: 1700000000,
    });
    expect(html).not.toContain("<dt>Tags</dt>");
    expect(html).not.toContain('<span class="ocas-tag">');
  });

  test("get: renders tag key only when value is absent", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/get", {
      type: "AAAAAAAAAAAAA",
      payload: "hello",
      timestamp: 1700000000,
      tags: [{ key: "pinned", target: "BBBBBBBBBBBBB", created: 1700000000 }],
    });
    expect(html).toContain('<span class="ocas-tag">pinned</span>');
  });

  // ── @ocas/output/var-set ──

  test("var-set: wrapped in ocas-card with 'Variable Set' header", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/var-set", {
      name: "@test/my-var",
      schema: "AAAAAAAAAAAAA",
      value: "BBBBBBBBBBBBB",
    });
    expect(html).toContain('<div class="ocas-card">');
    expect(html).toContain('<div class="ocas-card-header">Variable Set</div>');
  });

  test("var-set: uses ocas-dl grid with Name, Schema, Value rows", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/var-set", {
      name: "@test/my-var",
      schema: "AAAAAAAAAAAAA",
      value: "BBBBBBBBBBBBB",
    });
    expect(html).toContain('<dl class="ocas-dl">');
    expect(html).toContain("<dt>Name</dt>");
    expect(html).toContain("@test/my-var");
    expect(html).toContain("<dt>Schema</dt>");
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
    expect(html).toContain("<dt>Value</dt>");
    expect(html).toContain('<code class="ocas-hash">BBBBBBBBBBBBB</code>');
  });

  // ── @ocas/output/var-get ──

  test("var-get: wrapped in ocas-card with 'Variable Detail' header", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/var-get", {
      name: "@test/v",
      schema: "AAAAAAAAAAAAA",
      value: "BBBBBBBBBBBBB",
    });
    expect(html).toContain('<div class="ocas-card">');
    expect(html).toContain(
      '<div class="ocas-card-header">Variable Detail</div>',
    );
  });

  test("var-get: uses ocas-dl grid with Name, Schema, Value rows", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/var-get", {
      name: "@test/v",
      schema: "AAAAAAAAAAAAA",
      value: "BBBBBBBBBBBBB",
    });
    expect(html).toContain('<dl class="ocas-dl">');
    expect(html).toContain("<dt>Name</dt>");
    expect(html).toContain("<dt>Schema</dt>");
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
    expect(html).toContain("<dt>Value</dt>");
    expect(html).toContain('<code class="ocas-hash">BBBBBBBBBBBBB</code>');
  });

  test("var-get: renders tag pills with ocas-tag when valueTags present", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/var-get", {
      name: "@test/v",
      schema: "AAAAAAAAAAAAA",
      value: "BBBBBBBBBBBBB",
      valueTags: [
        {
          key: "status",
          value: "active",
          target: "BBBBBBBBBBBBB",
          created: 1700000000,
        },
      ],
    });
    expect(html).toContain("<dt>Tags</dt>");
    expect(html).toContain('<span class="ocas-tag">status:active</span>');
  });

  test("var-get: omits tags row when no valueTags present", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/var-get", {
      name: "@test/v",
      schema: "AAAAAAAAAAAAA",
      value: "BBBBBBBBBBBBB",
    });
    expect(html).not.toContain("<dt>Tags</dt>");
    expect(html).not.toContain('<span class="ocas-tag">');
  });

  // ── @ocas/output/var-delete ──

  test("var-delete: wrapped in ocas-card with 'Variable Deleted' header", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/var-delete", {
      name: "@test/deleted",
      schema: "AAAAAAAAAAAAA",
      value: "BBBBBBBBBBBBB",
    });
    expect(html).toContain('<div class="ocas-card">');
    expect(html).toContain(
      '<div class="ocas-card-header">Variable Deleted</div>',
    );
  });

  test("var-delete: uses ocas-dl grid with Name, Schema, Value rows", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/var-delete", {
      name: "@test/deleted",
      schema: "AAAAAAAAAAAAA",
      value: "BBBBBBBBBBBBB",
    });
    expect(html).toContain('<dl class="ocas-dl">');
    expect(html).toContain("<dt>Name</dt>");
    expect(html).toContain("@test/deleted");
    expect(html).toContain("<dt>Schema</dt>");
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
    expect(html).toContain("<dt>Value</dt>");
    expect(html).toContain('<code class="ocas-hash">BBBBBBBBBBBBB</code>');
  });

  // ── @ocas/output/template-set ──

  test("template-set: wrapped in ocas-card with 'Template Set' header", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/template-set",
      { schemaHash: "AAAAAAAAAAAAA", contentHash: "BBBBBBBBBBBBB" },
    );
    expect(html).toContain('<div class="ocas-card">');
    expect(html).toContain('<div class="ocas-card-header">Template Set</div>');
  });

  test("template-set: uses ocas-dl grid with Schema and Content rows", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/template-set",
      { schemaHash: "AAAAAAAAAAAAA", contentHash: "BBBBBBBBBBBBB" },
    );
    expect(html).toContain('<dl class="ocas-dl">');
    expect(html).toContain("<dt>Schema</dt>");
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
    expect(html).toContain("<dt>Content</dt>");
    expect(html).toContain('<code class="ocas-hash">BBBBBBBBBBBBB</code>');
  });
});

// ── Card CSS in static templates ───────────────────────────────────

describe("Card CSS in static templates", () => {
  test("static CSS includes ocas-card styles", async () => {
    const { store, aliases, stringHash } = setup();
    await registerOutputTemplates(store);

    const getHash = aliases["@ocas/output/get"];
    if (!getHash) throw new Error("@ocas/output/get not found");

    const staticVar = store.var.get(
      `@ocas/template-static/html/${getHash}`,
      stringHash,
    );
    expect(staticVar).not.toBeNull();
    if (staticVar) {
      const node = store.cas.get(staticVar.value);
      expect(node).not.toBeNull();
      if (node) {
        const parsed = JSON.parse(node.payload as string);
        expect(parsed.css).toContain(".ocas-card");
        expect(parsed.css).toContain(".ocas-card-header");
        expect(parsed.css).toContain(".ocas-dl");
        expect(parsed.css).toContain(".ocas-hash");
        expect(parsed.css).toContain(".ocas-tag");
      }
    }
  });
});

// ── List/Array HTML templates ───────────────────────────────────────

describe("List/Array HTML output", () => {
  test("refs: renders hash list with <code> items", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/refs", [
      "AAAAAAAAAAAAA",
      "BBBBBBBBBBBBB",
    ]);
    expect(html).toContain("AAAAAAAAAAAAA");
    expect(html).toContain("BBBBBBBBBBBBB");
    expect(html).toContain("<code");
  });

  test("walk: renders walked node list", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/walk", [
      "AAAAAAAAAAAAA",
      "BBBBBBBBBBBBB",
    ]);
    expect(html).toContain("AAAAAAAAAAAAA");
    expect(html).toContain("BBBBBBBBBBBBB");
  });

  test("list: card layout with 'Nodes' header, styled table, hash pills, time columns", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/list", [
      { hash: "AAAAAAAAAAAAA", created: 1000, updated: 2000 },
      { hash: "BBBBBBBBBBBBB", created: 3000, updated: 4000 },
    ]);
    // Card layout
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Nodes");
    expect(html).toContain("2 entries");
    // Styled table
    expect(html).toContain('class="ocas-table"');
    // Uppercase th headers
    expect(html).toContain("<th>HASH</th>");
    expect(html).toContain("<th>CREATED</th>");
    expect(html).toContain("<th>UPDATED</th>");
    // Hash pills
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
    expect(html).toContain('<code class="ocas-hash">BBBBBBBBBBBBB</code>');
    // Time columns
    expect(html).toContain('class="ocas-col-time"');
  });

  test("list-meta: card layout with 'Meta-Schemas' header", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/list-meta", [
      { hash: "AAAAAAAAAAAAA", created: 1000, updated: 2000 },
    ]);
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Meta-Schemas");
    expect(html).toContain("1 entries");
    expect(html).toContain('class="ocas-table"');
    expect(html).toContain("<th>HASH</th>");
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
  });

  test("list-schema: card layout with 'Schemas' header", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/list-schema",
      [{ hash: "AAAAAAAAAAAAA", created: 1000, updated: 2000 }],
    );
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Schemas");
    expect(html).toContain("1 entries");
    expect(html).toContain('class="ocas-table"');
    expect(html).toContain("<th>HASH</th>");
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
  });

  test("var-list: card layout with 'Variables' header, name bold, hash pills", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/var-list", [
      {
        name: "@test/a",
        schema: "AAAAAAAAAAAAA",
        value: "BBBBBBBBBBBBB",
      },
      {
        name: "@test/b",
        schema: "CCCCCCCCCCCCC",
        value: "DDDDDDDDDDDDD",
      },
    ]);
    // Card layout
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Variables");
    expect(html).toContain("2 entries");
    // Styled table
    expect(html).toContain('class="ocas-table"');
    // Uppercase th headers
    expect(html).toContain("<th>NAME</th>");
    expect(html).toContain("<th>SCHEMA</th>");
    expect(html).toContain("<th>VALUE</th>");
    // Name column bold class
    expect(html).toContain('class="ocas-col-name"');
    // Hash pills for schema and value
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
    expect(html).toContain('<code class="ocas-hash">BBBBBBBBBBBBB</code>');
    // Contains variable names
    expect(html).toContain("@test/a");
    expect(html).toContain("@test/b");
  });

  test("var-history: renders name + list of historical values", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/var-history",
      {
        name: "@test/var",
        schema: "AAAAAAAAAAAAA",
        values: ["BBBBBBBBBBBBB", "CCCCCCCCCCCCC"],
      },
    );
    expect(html).toContain("@test/var");
    expect(html).toContain("BBBBBBBBBBBBB");
    expect(html).toContain("CCCCCCCCCCCCC");
  });

  test("template-list: card layout with 'Templates' header, 2-column table", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/template-list",
      [
        { schemaHash: "AAAAAAAAAAAAA", contentHash: "BBBBBBBBBBBBB" },
        { schemaHash: "CCCCCCCCCCCCC", contentHash: "DDDDDDDDDDDDD" },
      ],
    );
    // Card layout
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Templates");
    expect(html).toContain("2 entries");
    // Styled table
    expect(html).toContain('class="ocas-table"');
    // Uppercase th headers
    expect(html).toContain("<th>SCHEMA</th>");
    expect(html).toContain("<th>CONTENT</th>");
    // Hash pills
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
    expect(html).toContain('<code class="ocas-hash">BBBBBBBBBBBBB</code>');
  });

  test("tag: card layout with 'Tags' header, em-dash for null values", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/tag", [
      {
        key: "env",
        value: "prod",
        target: "AAAAAAAAAAAAA",
        created: 1700000000,
      },
      {
        key: "status",
        value: null,
        target: "BBBBBBBBBBBBB",
        created: 1700000000,
      },
    ]);
    // Card layout
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Tags");
    expect(html).toContain("2 entries");
    // Styled table
    expect(html).toContain('class="ocas-table"');
    // Uppercase th headers
    expect(html).toContain("<th>KEY</th>");
    expect(html).toContain("<th>VALUE</th>");
    expect(html).toContain("<th>TARGET</th>");
    // Content
    expect(html).toContain("env");
    expect(html).toContain("prod");
    expect(html).toContain('<code class="ocas-hash">AAAAAAAAAAAAA</code>');
    // Em-dash for null value
    expect(html).toContain("—");
  });

  test("untag: card layout with 'Untagged' header", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/untag", [
      {
        key: "env",
        value: "prod",
        target: "AAAAAAAAAAAAA",
        created: 1700000000,
      },
    ]);
    // Card layout
    expect(html).toContain('class="ocas-card"');
    expect(html).toContain("Untagged");
    expect(html).toContain("1 entries");
    // Styled table
    expect(html).toContain('class="ocas-table"');
    expect(html).toContain("<th>KEY</th>");
    expect(html).toContain("env");
    expect(html).toContain("prod");
  });

  test("empty arrays render card with '0 entries' header and empty tbody", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    // Test all 7 table templates with empty arrays
    const tableTemplates: Array<[string, string]> = [
      ["@ocas/output/list", "Nodes"],
      ["@ocas/output/list-meta", "Meta-Schemas"],
      ["@ocas/output/list-schema", "Schemas"],
      ["@ocas/output/var-list", "Variables"],
      ["@ocas/output/tag", "Tags"],
      ["@ocas/output/untag", "Untagged"],
      ["@ocas/output/template-list", "Templates"],
    ];

    for (const [alias, title] of tableTemplates) {
      const html = await renderOutput(store, aliases, alias, []);
      // Card layout preserved
      expect(html).toContain('class="ocas-card"');
      // Header shows 0 entries
      expect(html).toContain("0 entries");
      expect(html).toContain(title);
      // Table structure preserved
      expect(html).toContain("<table");
      // No data rows (tbody is empty)
      const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
      expect(tbodyMatch).not.toBeNull();
      if (tbodyMatch) {
        expect(tbodyMatch[1]).not.toContain("<tr>");
      }
    }
  });
});

// ── Statistics HTML templates ───────────────────────────────────────

describe("Statistics HTML output", () => {
  test("gc: renders total, reachable, collected, scanned as metrics", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/gc", {
      total: 100,
      reachable: 80,
      collected: 20,
      scanned: 5,
    });
    expect(html).toContain("100");
    expect(html).toContain("80");
    expect(html).toContain("20");
    expect(html).toContain("5");
    // Metrics should have labels
    expect(html).toMatch(/total/i);
    expect(html).toMatch(/reachable/i);
    expect(html).toMatch(/collected/i);
    expect(html).toMatch(/scanned/i);
  });

  test("export: renders nodes, vars, tags counts", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/export", {
      nodes: 42,
      vars: 15,
      tags: 8,
    });
    expect(html).toContain("42");
    expect(html).toContain("15");
    expect(html).toContain("8");
  });

  test("import: renders nested import stats", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/import", {
      nodes: { imported: 10, skipped: 2 },
      vars: { created: 3, updated: 1 },
      tags: 5,
    });
    expect(html).toContain("10");
    expect(html).toContain("2");
    expect(html).toContain("3");
    expect(html).toContain("1");
    expect(html).toContain("5");
  });
});

// ── Shared CSS (static templates) ───────────────────────────────────

describe("Shared CSS via static templates", () => {
  test("static template is registered for output schemas", async () => {
    const { store, aliases, stringHash } = setup();
    await registerOutputTemplates(store);

    // Check for at least one static template
    // The put schema should have a static template for shared CSS
    const putHash = aliases["@ocas/output/put"];
    if (!putHash) throw new Error("@ocas/output/put not found");

    const staticVar = store.var.get(
      `@ocas/template-static/html/${putHash}`,
      stringHash,
    );
    expect(staticVar).not.toBeNull();

    if (staticVar) {
      const node = store.cas.get(staticVar.value);
      expect(node).not.toBeNull();
      if (node) {
        // Should be valid JSON with css key
        const parsed = JSON.parse(node.payload as string);
        expect(parsed).toHaveProperty("css");
        expect(typeof parsed.css).toBe("string");
      }
    }
  });

  test("CSS includes design-guide tokens as custom properties", async () => {
    const { store, aliases, stringHash } = setup();
    await registerOutputTemplates(store);

    const putHash = aliases["@ocas/output/put"];
    if (!putHash) throw new Error("@ocas/output/put not found");

    const staticVar = store.var.get(
      `@ocas/template-static/html/${putHash}`,
      stringHash,
    );
    if (!staticVar) throw new Error("Static var not found");

    const node = store.cas.get(staticVar.value);
    if (!node) throw new Error("Static node not found");

    const parsed = JSON.parse(node.payload as string);
    const css: string = parsed.css;

    // Design tokens from guide
    expect(css).toContain("--ocas-font");
    expect(css).toContain("--ocas-mono");
    expect(css).toContain("--ocas-card-bg");
    expect(css).toContain("--ocas-card-border");
    expect(css).toContain("--ocas-card-shadow");
    expect(css).toContain("--ocas-card-radius");
    expect(css).toContain("--ocas-text");
    expect(css).toContain("--ocas-text-muted");
    expect(css).toContain("--ocas-green");
    expect(css).toContain("--ocas-red");
    expect(css).toContain("--ocas-yellow");
    expect(css).toContain("--ocas-hash-bg");
    expect(css).toContain("--ocas-hash-text");
  });

  test("CSS includes card, hash, badge, and template-content styles", async () => {
    const { store, aliases, stringHash } = setup();
    await registerOutputTemplates(store);

    const putHash = aliases["@ocas/output/put"];
    if (!putHash) throw new Error("@ocas/output/put not found");

    const staticVar = store.var.get(
      `@ocas/template-static/html/${putHash}`,
      stringHash,
    );
    if (!staticVar) throw new Error("Static var not found");

    const node = store.cas.get(staticVar.value);
    if (!node) throw new Error("Static node not found");

    const parsed = JSON.parse(node.payload as string);
    const css: string = parsed.css;

    // Component styles
    expect(css).toContain(".ocas-card");
    expect(css).toContain(".ocas-card-header");
    expect(css).toContain(".ocas-hash");
    expect(css).toContain(".ocas-badge");
    expect(css).toContain(".ocas-badge-ok");
    expect(css).toContain(".ocas-badge-error");
    expect(css).toContain(".ocas-badge-warn");
    expect(css).toContain(".ocas-template-content");
  });

  test("CSS includes table styles per design guide", async () => {
    const { store, aliases, stringHash } = setup();
    await registerOutputTemplates(store);

    const putHash = aliases["@ocas/output/put"];
    if (!putHash) throw new Error("@ocas/output/put not found");

    const staticVar = store.var.get(
      `@ocas/template-static/html/${putHash}`,
      stringHash,
    );
    if (!staticVar) throw new Error("Static var not found");

    const node = store.cas.get(staticVar.value);
    if (!node) throw new Error("Static node not found");

    const parsed = JSON.parse(node.payload as string);
    const css: string = parsed.css;

    // Table styles from design guide
    expect(css).toContain(".ocas-table");
    expect(css).toContain("border-collapse: collapse");
    expect(css).toContain("width: 100%");
    // th: uppercase, small font, muted, letter-spacing
    expect(css).toContain("text-transform: uppercase");
    expect(css).toContain("letter-spacing: 0.05em");
    expect(css).toContain("var(--ocas-text-muted)");
    // td: left-aligned, padded, bottom border
    expect(css).toContain("0.4rem 0.75rem");
    expect(css).toContain("var(--ocas-card-border)");
    // last row no bottom border
    expect(css).toContain("tr:last-child td");
    // Column-specific styles
    expect(css).toContain(".ocas-col-name");
    expect(css).toContain("font-weight: 500");
    expect(css).toContain(".ocas-col-time");
    expect(css).toContain("tabular-nums");
  });

  test("CSS is injected into <style> blocks in the rendered document", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/gc", {
      total: 100,
      reachable: 80,
      collected: 20,
      scanned: 5,
    });

    // Should contain a <style> block from static template
    expect(html).toContain("<style>");
    expect(html).toContain("</style>");

    // CSS should use scoped class naming (ocas- prefix)
    expect(html).toContain(".ocas-");
  });

  test("CSS appears in <head> section", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/put",
      "AAAAAAAAAAAAA",
    );
    const headEnd = html.indexOf("</head>");
    const stylePos = html.indexOf("<style>");
    if (stylePos !== -1) {
      expect(stylePos).toBeLessThan(headEnd);
    }
  });
});

// ── End-to-end render pipeline ──────────────────────────────────────

describe("HTML render pipeline integration", () => {
  test("output produces a complete HTML document", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/gc", {
      total: 100,
      reachable: 80,
      collected: 20,
      scanned: 5,
    });

    // Valid HTML5 document structure
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
  });

  test("text format rendering is unchanged", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const typeHash = aliases["@ocas/output/put"];
    if (!typeHash) throw new Error("@ocas/output/put not found");
    const hash = store.cas.put(typeHash, "AAAAAAAAAAAAA");

    // Text render should not contain HTML document structure
    const textOutput = await renderAsync(store, hash, { format: "text" });
    expect(textOutput).toContain("AAAAAAAAAAAAA");
    expect(textOutput).not.toContain("<!DOCTYPE");
    expect(textOutput).not.toContain("<html");
  });
});
