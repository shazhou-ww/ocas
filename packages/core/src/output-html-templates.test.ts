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

// ── Structured HTML templates ───────────────────────────────────────

describe("Structured HTML output", () => {
  test("get: renders type, timestamp, payload as key-value pairs", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/get", {
      type: "AAAAAAAAAAAAA",
      payload: { name: "test" },
      timestamp: 1700000000,
    });
    expect(html).toContain("<code");
    expect(html).toContain("AAAAAAAAAAAAA");
    expect(html).toContain("1700000000");
  });

  test("get: includes tags when present", async () => {
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
    expect(html).toContain("env");
    expect(html).toContain("prod");
  });

  test("var-set: renders name, schema, value as key-value pairs", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/var-set", {
      name: "@test/my-var",
      schema: "AAAAAAAAAAAAA",
      value: "BBBBBBBBBBBBB",
    });
    expect(html).toContain("@test/my-var");
    expect(html).toContain("<code");
    expect(html).toContain("AAAAAAAAAAAAA");
    expect(html).toContain("BBBBBBBBBBBBB");
  });

  test("var-get: renders name, schema, value, and valueTags", async () => {
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
    expect(html).toContain("@test/v");
    expect(html).toContain("status");
    expect(html).toContain("active");
  });

  test("var-delete: renders deleted variable info", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/var-delete", {
      name: "@test/deleted",
      schema: "AAAAAAAAAAAAA",
      value: "BBBBBBBBBBBBB",
    });
    expect(html).toContain("@test/deleted");
    expect(html).toContain("<code");
  });

  test("template-set: renders schema hash and content hash", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/template-set",
      {
        schemaHash: "AAAAAAAAAAAAA",
        contentHash: "BBBBBBBBBBBBB",
      },
    );
    expect(html).toContain("AAAAAAAAAAAAA");
    expect(html).toContain("BBBBBBBBBBBBB");
    expect(html).toContain("<code");
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

  test("list: renders as <table> with hash, created, updated columns", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/list", [
      { hash: "AAAAAAAAAAAAA", created: 1000, updated: 2000 },
      { hash: "BBBBBBBBBBBBB", created: 3000, updated: 4000 },
    ]);
    expect(html).toContain("<table");
    expect(html).toContain("AAAAAAAAAAAAA");
    expect(html).toContain("BBBBBBBBBBBBB");
    expect(html).toContain("<code");
  });

  test("list-meta: renders as <table> like list", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/list-meta", [
      { hash: "AAAAAAAAAAAAA", created: 1000, updated: 2000 },
    ]);
    expect(html).toContain("<table");
    expect(html).toContain("AAAAAAAAAAAAA");
  });

  test("list-schema: renders as <table> like list", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(
      store,
      aliases,
      "@ocas/output/list-schema",
      [{ hash: "AAAAAAAAAAAAA", created: 1000, updated: 2000 }],
    );
    expect(html).toContain("<table");
    expect(html).toContain("AAAAAAAAAAAAA");
  });

  test("var-list: renders as <table> with name, schema, value columns", async () => {
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
    expect(html).toContain("<table");
    expect(html).toContain("@test/a");
    expect(html).toContain("@test/b");
    expect(html).toContain("<code");
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

  test("template-list: renders as <table> with schema and content hash", async () => {
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
    expect(html).toContain("<table");
    expect(html).toContain("AAAAAAAAAAAAA");
    expect(html).toContain("BBBBBBBBBBBBB");
    expect(html).toContain("<code");
  });

  test("tag: renders tag entries with key, value, target", async () => {
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
    expect(html).toContain("env");
    expect(html).toContain("prod");
    expect(html).toContain("AAAAAAAAAAAAA");
  });

  test("untag: renders untag entries", async () => {
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
    expect(html).toContain("env");
    expect(html).toContain("prod");
  });

  test("empty arrays render an empty state", async () => {
    const { store, aliases } = setup();
    await registerOutputTemplates(store);

    const html = await renderOutput(store, aliases, "@ocas/output/list", []);
    // Should still produce valid HTML (maybe an empty table body)
    expect(html).toContain("<table");
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
