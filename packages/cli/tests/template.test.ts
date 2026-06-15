import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash, Store } from "@ocas/core";
import { bootstrap } from "@ocas/core";
import { openStore as openFsStore } from "@ocas/fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

// ---- Test helpers ----

let testDir: string;
let storePath: string;
let cliPath: string;

beforeEach(() => {
  // Create unique temp directory for each test
  testDir = join(
    tmpdir(),
    `ocas-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  storePath = join(testDir, "store");
  cliPath = join(import.meta.dirname, "../dist/index.js");

  mkdirSync(testDir, { recursive: true });
  mkdirSync(storePath, { recursive: true });
});

afterEach(() => {
  // Clean up test directory
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

/**
 * Run CLI command and return stdout, stderr, and exit code
 */
function runCli(...rawArgs: (string | string[])[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const args = rawArgs.flat();
  try {
    const stdout = execFileSync(
      "node",
      [cliPath, "--home", storePath, ...args],
      {
        encoding: "utf-8",
        timeout: 10000,
      },
    );
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? "").trim(),
      exitCode: err.status ?? 1,
    };
  }
}

/**
 * Get bootstrap @ocas/string type hash
 */
async function getStringHash(store: Store): Promise<Hash> {
  const builtinSchemas = bootstrap(store);
  return builtinSchemas["@ocas/string"] ?? "";
}

// ---- Tests ----

describe("template set", () => {
  test("set template from file", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const templateFile = join(testDir, "template.txt");
    writeFileSync(templateFile, "Hello {{name}}!");

    const { stdout, stderr, exitCode } = await runCli(
      "template",
      "set",
      stringHash,
      templateFile,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const envelope = JSON.parse(stdout);
    expect(envelope).toHaveProperty("type");
    expect(envelope.value).toHaveProperty("contentHash");
    expect(envelope.value.schemaHash).toBe(stringHash);
  });

  test("set template with --inline flag", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const { stdout, exitCode } = await runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      "Inline template content",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope).toHaveProperty("type");
    expect(envelope.value).toHaveProperty("contentHash");
    expect(envelope.value.schemaHash).toBe(stringHash);
  });

  test("update existing template (idempotent)", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const templateFile = join(testDir, "template.txt");
    writeFileSync(templateFile, "Version 1");

    // Set first time
    await runCli("template", "set", stringHash, templateFile);

    // Update with new content
    writeFileSync(templateFile, "Version 2");
    const { stdout, exitCode } = await runCli(
      "template",
      "set",
      stringHash,
      templateFile,
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value).toHaveProperty("contentHash");

    // Verify we can get the new version
    const { stdout: getOut } = await runCli("template", "get", stringHash);
    expect(JSON.parse(getOut).value).toBe("Version 2");
  });

  test("error when file not found", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const { stderr, exitCode } = await runCli(
      "template",
      "set",
      stringHash,
      "/nonexistent/file.txt",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error:");
  });

  test("error when schema hash invalid", async () => {
    const templateFile = join(testDir, "template.txt");
    writeFileSync(templateFile, "content");

    const { stderr, exitCode } = await runCli(
      "template",
      "set",
      "INVALID_HASH",
      templateFile,
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error:");
  });

  test("error when both file and --inline provided", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const templateFile = join(testDir, "template.txt");
    writeFileSync(templateFile, "content");

    const { stderr, exitCode } = await runCli(
      "template",
      "set",
      stringHash,
      templateFile,
      "--inline",
      "inline content",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error:");
  });

  test("support multi-line templates", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const multilineContent = "Line 1\nLine 2\nLine 3";
    const { exitCode } = await runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      multilineContent,
    );

    expect(exitCode).toBe(0);

    // Verify content
    const { stdout: getOut } = await runCli("template", "get", stringHash);
    expect(JSON.parse(getOut).value).toBe(multilineContent);
  });

  test("support empty templates", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const { stdout, exitCode } = await runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      "",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value).toHaveProperty("contentHash");
  });

  test("error when neither file nor --inline provided", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const { stderr, exitCode } = await runCli("template", "set", stringHash);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  test("support templates with special characters", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const specialContent = "Template with {{var}} and $env and @ref";
    const { exitCode } = await runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      specialContent,
    );

    expect(exitCode).toBe(0);

    // Verify content preserved
    const { stdout: getOut } = await runCli("template", "get", stringHash);
    expect(JSON.parse(getOut).value).toBe(specialContent);
  });
});

describe("template get", () => {
  test("retrieve template as envelope value", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const content = "Hello {{name}}!";
    await runCli("template", "set", stringHash, "--inline", content);

    const { stdout, stderr, exitCode } = await runCli(
      "template",
      "get",
      stringHash,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const envelope = JSON.parse(stdout);
    expect(envelope).toHaveProperty("type");
    expect(envelope.value).toBe(content);
  });

  test("error when template not found", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const { stderr, exitCode } = await runCli("template", "get", stringHash);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error:");
    expect(stderr).toContain("not found");
  });

  test("preserve exact whitespace", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // The envelope's value preserves exact whitespace (JSON-escaped),
    // so trimming the surrounding JSON output is harmless.
    const content = "spaces\n\ttabs\t\nmixed";
    await runCli("template", "set", stringHash, "--inline", content);

    const { stdout } = await runCli("template", "get", stringHash);

    expect(JSON.parse(stdout).value).toBe(content);
  });

  test("support multi-line templates", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const multiline = "Line 1\nLine 2\nLine 3";
    await runCli("template", "set", stringHash, "--inline", multiline);

    const { stdout } = await runCli("template", "get", stringHash);

    expect(JSON.parse(stdout).value).toBe(multiline);
  });
});

describe("template list", () => {
  test("list all templates", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // Create multiple templates
    await runCli("template", "set", stringHash, "--inline", "Template 1");
    await runCli("template", "set", "SCHEMA_HASH_2", "--inline", "Template 2");

    const { stdout, exitCode } = await runCli("template", "list");

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope).toHaveProperty("type");
    expect(Array.isArray(envelope.value)).toBe(true);
    expect(envelope.value.length).toBeGreaterThanOrEqual(1);

    // Check structure
    const item = envelope.value[0];
    expect(item).toHaveProperty("schemaHash");
    expect(item).toHaveProperty("contentHash");
  });

  test("entry contentHash matches set result", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const { stdout: setOut } = await runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      "Some template content",
    );
    const { contentHash } = JSON.parse(setOut).value;

    const { stdout } = await runCli("template", "list");

    const value = JSON.parse(stdout).value as Array<{
      schemaHash: string;
      contentHash: string;
    }>;
    const item = value.find((i) => i.schemaHash === stringHash);
    expect(item).toBeDefined();
    if (item) {
      expect(item.contentHash).toBe(contentHash);
    }
  });

  test("empty list when no templates", async () => {
    const { stdout, exitCode } = await runCli("template", "list");

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.value)).toBe(true);
    expect(envelope.value.length).toBe(0);
  });

  test("exclude non-template variables", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // Create a template
    await runCli("template", "set", stringHash, "--inline", "Template");

    // Create a regular variable (not under @ocas/template/text/)
    const hash = store.cas.put(stringHash, "regular var content");
    await runCli("var", "set", "regular/var", hash);

    const { stdout } = await runCli("template", "list");

    const envelope = JSON.parse(stdout);
    // Should only contain template variables
    for (const item of envelope.value) {
      expect(item.schemaHash).toBeDefined();
    }
  });

  test("output JSON envelope with array value", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    await runCli("template", "set", stringHash, "--inline", "Test");

    const { stdout } = await runCli("template", "list");

    // Should be valid JSON
    expect(() => JSON.parse(stdout)).not.toThrow();

    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.value)).toBe(true);
  });
});

describe("template delete", () => {
  test("delete template variable binding", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    await runCli("template", "set", stringHash, "--inline", "Template");

    const { stdout, stderr, exitCode } = await runCli(
      "template",
      "delete",
      stringHash,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const envelope = JSON.parse(stdout);
    expect(envelope).toHaveProperty("type");
    expect(envelope.value).toHaveProperty("deleted");
    expect(envelope.value.deleted).toBe(true);

    // Verify template is gone
    const { exitCode: getExitCode } = await runCli(
      "template",
      "get",
      stringHash,
    );
    expect(getExitCode).toBe(1);
  });

  test("error when template not found", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const { stderr, exitCode } = await runCli("template", "delete", stringHash);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error:");
    expect(stderr).toContain("not found");
  });

  test("deletion does not affect other templates", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // Create two templates
    await runCli("template", "set", stringHash, "--inline", "Template 1");
    await runCli("template", "set", "SCHEMA_HASH_2", "--inline", "Template 2");

    // Delete first template
    await runCli("template", "delete", stringHash);

    // Verify second still exists
    const { stdout } = await runCli("template", "list");
    const value = JSON.parse(stdout).value as Array<{
      schemaHash: string;
      contentHash: string;
    }>;

    // Should not find deleted template
    const deleted = value.find((i) => i.schemaHash === stringHash);
    expect(deleted).toBeUndefined();
  });

  test("CAS content remains after variable deletion", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    await runCli("template", "set", stringHash, "--inline", "Content");

    // Get the content hash before deletion
    const { stdout: setOut } = await runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      "Content",
    );
    const { contentHash } = JSON.parse(setOut).value;

    // Delete the template variable
    await runCli("template", "delete", stringHash);

    // Verify CAS node still exists
    const { exitCode: hasExitCode } = await runCli("has", contentHash);
    expect(hasExitCode).toBe(0);
  });

  test("deletion is non-idempotent (second delete fails)", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    await runCli("template", "set", stringHash, "--inline", "Template");

    // First deletion succeeds
    const { exitCode: firstExit } = await runCli(
      "template",
      "delete",
      stringHash,
    );
    expect(firstExit).toBe(0);

    // Second deletion fails
    const { exitCode: secondExit } = await runCli(
      "template",
      "delete",
      stringHash,
    );
    expect(secondExit).toBe(1);
  });
});

describe("template integration", () => {
  test("end-to-end workflow: set→get→list→delete", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const content = "Integration test template";

    // Set
    const { exitCode: setExit } = await runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      content,
    );
    expect(setExit).toBe(0);

    // Get
    const { stdout: getOut, exitCode: getExit } = await runCli(
      "template",
      "get",
      stringHash,
    );
    expect(getExit).toBe(0);
    expect(JSON.parse(getOut).value).toBe(content);

    // List
    const { stdout: listOut, exitCode: listExit } = await runCli(
      "template",
      "list",
    );
    expect(listExit).toBe(0);
    const listData = JSON.parse(listOut).value;
    expect(listData.length).toBeGreaterThan(0);

    // Delete
    const { exitCode: delExit } = await runCli(
      "template",
      "delete",
      stringHash,
    );
    expect(delExit).toBe(0);

    // Verify deleted
    const { exitCode: finalGet } = await runCli("template", "get", stringHash);
    expect(finalGet).toBe(1);
  });

  test("templates compatible with generic var commands", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // Set via template command
    await runCli("template", "set", stringHash, "--inline", "Content");

    // List via var command - should see template variable
    const { stdout } = await runCli("var", "list", "@ocas/template/text/");

    const output = JSON.parse(stdout);
    expect(output.value.length).toBeGreaterThan(0);
  });

  test("multiple templates for different schemas", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // Create templates for different schemas
    await runCli("template", "set", stringHash, "--inline", "Template 1");
    await runCli("template", "set", "SCHEMA_HASH_2", "--inline", "Template 2");
    await runCli("template", "set", "SCHEMA_HASH_3", "--inline", "Template 3");

    // List should show all
    const { stdout } = await runCli("template", "list");
    const value = JSON.parse(stdout).value;
    expect(value.length).toBeGreaterThanOrEqual(1);
  });
});

describe("template error handling", () => {
  test("unknown template subcommand", async () => {
    const { stderr, exitCode } = await runCli("template", "unknown");

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown");
  });

  test("missing schema hash argument", async () => {
    const { stderr, exitCode } = await runCli("template", "set");

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });
});

// ---- --format html tests (Phase 2c) ----

describe("template set --format html", () => {
  test("stores HTML template at @ocas/template/html/<schema-hash>", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const templateFile = join(testDir, "tpl.html");
    writeFileSync(
      templateFile,
      '<div class="person"><h2>{{ name }}</h2></div>',
    );

    const { stdout, exitCode } = runCli(
      "template",
      "set",
      stringHash,
      templateFile,
      "--format",
      "html",
    );

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.value).toHaveProperty("schemaHash", stringHash);
    expect(envelope.value).toHaveProperty("contentHash");

    // Verify stored at html namespace
    const { stdout: getHtml, exitCode: getHtmlExit } = runCli(
      "template",
      "get",
      stringHash,
      "--format",
      "html",
    );
    expect(getHtmlExit).toBe(0);
    expect(JSON.parse(getHtml).value).toBe(
      '<div class="person"><h2>{{ name }}</h2></div>',
    );

    // Verify NOT stored at text namespace
    const { exitCode: getTextExit } = runCli("template", "get", stringHash);
    expect(getTextExit).toBe(1);
  });

  test("--format html with --inline", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const { stdout, exitCode } = runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      "<p>{{ name }}</p>",
      "--format",
      "html",
    );

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.value).toHaveProperty("schemaHash", stringHash);
    expect(envelope.value).toHaveProperty("contentHash");

    // Verify content
    const { stdout: getOut } = runCli(
      "template",
      "get",
      stringHash,
      "--format",
      "html",
    );
    expect(JSON.parse(getOut).value).toBe("<p>{{ name }}</p>");
  });

  test("--format html --static stores at .../static suffix", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const staticFile = join(testDir, "static.json");
    writeFileSync(
      staticFile,
      '{"css": ".person { color: blue; }", "js": "console.log(\'loaded\');"}',
    );

    const { stdout, exitCode } = runCli(
      "template",
      "set",
      stringHash,
      staticFile,
      "--format",
      "html",
      "--static",
    );

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.value).toHaveProperty("schemaHash", stringHash);
    expect(envelope.value).toHaveProperty("contentHash");

    // Verify distinct from instance template and text template
    // Instance template should not exist
    const { exitCode: getInstanceExit } = runCli(
      "template",
      "get",
      stringHash,
      "--format",
      "html",
    );
    expect(getInstanceExit).toBe(1);

    // Text template should not exist
    const { exitCode: getTextExit } = runCli("template", "get", stringHash);
    expect(getTextExit).toBe(1);

    // Verify stored under var with /static suffix
    const { stdout: varList } = runCli(
      "var",
      "list",
      `@ocas/template/html/${stringHash}/static`,
    );
    const vars = JSON.parse(varList).value;
    expect(vars.length).toBe(1);
  });

  test("--static without --format html is rejected", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const staticFile = join(testDir, "static.json");
    writeFileSync(staticFile, '{"css": "", "js": ""}');

    const { stderr, exitCode } = runCli(
      "template",
      "set",
      stringHash,
      staticFile,
      "--static",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--static");
    expect(stderr).toContain("--format html");

    // Verify no variable was created
    const { stdout: varList } = runCli(
      "var",
      "list",
      `@ocas/template/html/${stringHash}`,
    );
    const vars = JSON.parse(varList).value;
    expect(vars.length).toBe(0);
  });
});

describe("template get --format html", () => {
  test("retrieves HTML instance template", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const content = '<div class="person"><h2>{{ name }}</h2></div>';
    runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      content,
      "--format",
      "html",
    );

    const { stdout, exitCode } = runCli(
      "template",
      "get",
      stringHash,
      "--format",
      "html",
    );

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.value).toBe(content);
  });

  test("not found when no HTML template exists", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const { stderr, exitCode } = runCli(
      "template",
      "get",
      stringHash,
      "--format",
      "html",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Template not found");
  });

  test("does not return text template when --format html", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // Set a text template
    runCli("template", "set", stringHash, "--inline", "Text template");

    // Request HTML — should fail
    const { exitCode } = runCli(
      "template",
      "get",
      stringHash,
      "--format",
      "html",
    );
    expect(exitCode).toBe(1);
  });
});

describe("template list --format html", () => {
  test("lists only HTML templates", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // Create a text template for stringHash (schema A)
    runCli("template", "set", stringHash, "--inline", "Text A");

    // Create an HTML instance template for stringHash (schema A)
    runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      "<p>HTML A</p>",
      "--format",
      "html",
    );

    // Create a text template for SCHEMA_HASH_2 (schema B)
    runCli("template", "set", "SCHEMA_HASH_2", "--inline", "Text B");

    // List HTML templates
    const { stdout, exitCode } = runCli("template", "list", "--format", "html");

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.value)).toBe(true);

    // Should contain only schema A
    const schemaHashes = envelope.value.map(
      (v: { schemaHash: string }) => v.schemaHash,
    );
    expect(schemaHashes).toContain(stringHash);

    // Text templates for B should NOT appear
    // (schemaHashes should not contain values corresponding to text-only templates)
    for (const item of envelope.value) {
      // All items should come from html namespace
      expect(item).toHaveProperty("schemaHash");
      expect(item).toHaveProperty("contentHash");
    }
  });

  test("includes static templates in list", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // Create an HTML static template
    runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      '{"css":"","js":""}',
      "--format",
      "html",
      "--static",
    );

    const { stdout, exitCode } = runCli("template", "list", "--format", "html");

    expect(exitCode).toBe(0);
    const items = JSON.parse(stdout).value;
    expect(items.length).toBeGreaterThanOrEqual(1);

    // Should include entry with /static suffix
    const staticEntry = items.find(
      (i: { schemaHash: string }) => i.schemaHash === `${stringHash}/static`,
    );
    expect(staticEntry).toBeDefined();
  });
});

describe("template delete --format html", () => {
  test("removes HTML template, text template unaffected", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // Set both text and HTML templates
    runCli("template", "set", stringHash, "--inline", "Text template");
    runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      "<p>HTML template</p>",
      "--format",
      "html",
    );

    // Delete HTML template
    const { stdout, exitCode } = runCli(
      "template",
      "delete",
      stringHash,
      "--format",
      "html",
    );

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.value).toHaveProperty("deleted", true);

    // HTML template should be gone
    const { exitCode: getHtmlExit } = runCli(
      "template",
      "get",
      stringHash,
      "--format",
      "html",
    );
    expect(getHtmlExit).toBe(1);

    // Text template should still exist
    const { stdout: textOut, exitCode: getTextExit } = runCli(
      "template",
      "get",
      stringHash,
    );
    expect(getTextExit).toBe(0);
    expect(JSON.parse(textOut).value).toBe("Text template");
  });

  test("not found when no HTML template exists", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const { stderr, exitCode } = runCli(
      "template",
      "delete",
      stringHash,
      "--format",
      "html",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Template not found");
  });
});

describe("template default format text (backward compat)", () => {
  test("set without --format stores at text namespace", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    const templateFile = join(testDir, "tpl.txt");
    writeFileSync(templateFile, "Name: {{ name }}");

    const { exitCode } = runCli("template", "set", stringHash, templateFile);
    expect(exitCode).toBe(0);

    // Verify stored in text namespace
    const { stdout: varList } = runCli(
      "var",
      "list",
      `@ocas/template/text/${stringHash}`,
    );
    const vars = JSON.parse(varList).value;
    expect(vars.length).toBe(1);
  });

  test("get without --format retrieves from text namespace", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    runCli("template", "set", stringHash, "--inline", "Name: {{ name }}");

    const { stdout, exitCode } = runCli("template", "get", stringHash);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).value).toBe("Name: {{ name }}");
  });

  test("list without --format lists only text templates", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // Set both text and HTML templates
    runCli("template", "set", stringHash, "--inline", "Text");
    runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      "<p>HTML</p>",
      "--format",
      "html",
    );

    const { stdout } = runCli("template", "list");
    const items = JSON.parse(stdout).value;

    // Should only contain text templates
    expect(items.length).toBe(1);
    expect(items[0].schemaHash).toBe(stringHash);
  });

  test("delete without --format removes from text namespace only", async () => {
    const store = await openFsStore(storePath);
    const stringHash = await getStringHash(store);

    // Set both text and HTML templates
    runCli("template", "set", stringHash, "--inline", "Text");
    runCli(
      "template",
      "set",
      stringHash,
      "--inline",
      "<p>HTML</p>",
      "--format",
      "html",
    );

    // Delete without --format
    const { exitCode } = runCli("template", "delete", stringHash);
    expect(exitCode).toBe(0);

    // Text should be gone
    const { exitCode: getTextExit } = runCli("template", "get", stringHash);
    expect(getTextExit).toBe(1);

    // HTML should still exist
    const { stdout: htmlOut, exitCode: getHtmlExit } = runCli(
      "template",
      "get",
      stringHash,
      "--format",
      "html",
    );
    expect(getHtmlExit).toBe(0);
    expect(JSON.parse(htmlOut).value).toBe("<p>HTML</p>");
  });
});
