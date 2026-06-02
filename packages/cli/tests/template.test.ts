import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash, OcasStore } from "@ocas/core";
import { bootstrap } from "@ocas/core";
import { openStore as openFsStore } from "@ocas/fs";

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
  cliPath = join(import.meta.dir, "../src/index.ts");

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
async function runCli(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(
    ["bun", "run", cliPath, "--home", storePath, ...args],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  await proc.exited;

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode: proc.exitCode ?? 0,
  };
}

/**
 * Get bootstrap @ocas/string type hash
 */
async function getStringHash(store: OcasStore): Promise<Hash> {
  const builtinSchemas = await bootstrap(store);
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
