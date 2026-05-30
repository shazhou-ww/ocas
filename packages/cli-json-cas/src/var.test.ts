import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CLI var commands", () => {
  let storePath: string;
  let varDbPath: string;
  let cliPath: string;
  let schemaHash: string;
  let hashA: string;
  let hashB: string;
  let testCounter = 0;

  beforeEach(async () => {
    // Create temporary paths with counter to ensure uniqueness
    testCounter++;
    storePath = join(tmpdir(), `test-cli-store-${Date.now()}-${testCounter}`);
    varDbPath = join(storePath, "variables.db");
    cliPath = join(import.meta.dir, "index.ts");

    // Initialize store and create test data
    const initResult = spawnSync(
      "bun",
      [cliPath, "--store", storePath, "init"],
      {
        encoding: "utf-8",
      },
    );
    expect(initResult.status).toBe(0);

    // Create a schema
    const schemaFile = join(tmpdir(), `schema-${Date.now()}.json`);
    await Bun.write(
      schemaFile,
      JSON.stringify({
        type: "object",
        properties: { name: { type: "string" } },
      }),
    );

    const schemaPutResult = spawnSync(
      "bun",
      [cliPath, "--store", storePath, "schema", "put", schemaFile],
      { encoding: "utf-8" },
    );
    expect(schemaPutResult.status).toBe(0);
    schemaHash = schemaPutResult.stdout.trim();

    // Create test CAS nodes
    const dataFileA = join(tmpdir(), `data-a-${Date.now()}.json`);
    await Bun.write(dataFileA, JSON.stringify({ name: "hello" }));

    const putResultA = spawnSync(
      "bun",
      [cliPath, "--store", storePath, "put", schemaHash, dataFileA],
      { encoding: "utf-8" },
    );
    expect(putResultA.status).toBe(0);
    hashA = putResultA.stdout.trim();

    const dataFileB = join(tmpdir(), `data-b-${Date.now()}.json`);
    await Bun.write(dataFileB, JSON.stringify({ name: "world" }));

    const putResultB = spawnSync(
      "bun",
      [cliPath, "--store", storePath, "put", schemaHash, dataFileB],
      { encoding: "utf-8" },
    );
    expect(putResultB.status).toBe(0);
    hashB = putResultB.stdout.trim();
  });

  afterEach(() => {
    // Cleanup
    try {
      unlinkSync(varDbPath);
    } catch {
      // Ignore
    }
  });

  describe("Test Group 1: Variable Creation", () => {
    test("1.1: Create variable with valid scope", () => {
      const result = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );

      expect(result.status).toBe(0);

      const output = JSON.parse(result.stdout);
      // Expect envelope format
      expect(output.type).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      expect(output.value).toBeDefined();

      // Check the actual variable in the value field
      const variable = output.value;
      expect(variable.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(variable.scope).toBe("uwf/thread/");
      expect(variable.value).toBe(hashA);
      expect(variable.schema).toBe(schemaHash);
      expect(variable.created).toBeGreaterThan(Date.now() - 5000);
      expect(variable.updated).toBe(variable.created);
    });

    test("1.2: Create variable fails with scope not ending in /", () => {
      const result = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("scope must end with /");
    });

    test("1.3: Create variable fails with non-existent CAS node", () => {
      const fakeHash = "FAKEHASH00000";
      const result = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/",
          "--value",
          fakeHash,
        ],
        { encoding: "utf-8" },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("CAS node not found");
    });
  });

  describe("Test Group 2: Variable Retrieval", () => {
    test("2.1: Get existing variable", () => {
      // Create a variable first
      const createResult = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      const created = JSON.parse(createResult.stdout).value;

      // Get the variable
      const result = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", created.id],
        { encoding: "utf-8" },
      );

      expect(result.status).toBe(0);

      const output = JSON.parse(result.stdout);
      // Expect envelope format
      expect(output.type).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      expect(output.value).toBeDefined();

      // Check the actual variable in the value field
      const variable = output.value;
      expect(variable.id).toBe(created.id);
      expect(variable.scope).toBe("uwf/thread/");
      expect(variable.value).toBe(hashA);
      expect(variable.schema).toBe(schemaHash);
    });

    test("2.2: Get non-existent variable", () => {
      const fakeId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
      const result = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", fakeId],
        { encoding: "utf-8" },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Variable not found");
    });
  });

  describe("Test Group 3: Variable Update (Schema Consistent)", () => {
    test("3.1: Update variable with matching schema", async () => {
      // Create a variable
      const createResult = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      const created = JSON.parse(createResult.stdout).value;

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update the variable
      const result = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "update", created.id, hashB],
        { encoding: "utf-8" },
      );

      expect(result.status).toBe(0);

      const output = JSON.parse(result.stdout);
      // Expect envelope format
      expect(output.type).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      expect(output.value).toBeDefined();

      // Check the actual variable in the value field
      const variable = output.value;
      expect(variable.id).toBe(created.id);
      expect(variable.value).toBe(hashB);
      expect(variable.schema).toBe(schemaHash);
      expect(variable.updated).toBeGreaterThan(created.created);
    });
  });

  describe("Test Group 4: Variable Update (Schema Mismatch)", () => {
    test("4.1: Update variable fails with schema mismatch", async () => {
      // Create another schema
      const schema2File = join(tmpdir(), `schema2-${Date.now()}.json`);
      await Bun.write(
        schema2File,
        JSON.stringify({
          type: "object",
          properties: { count: { type: "number" } },
        }),
      );

      const schema2PutResult = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "schema", "put", schema2File],
        { encoding: "utf-8" },
      );
      const schemaHash2 = schema2PutResult.stdout.trim();

      // Create a node with the second schema
      const dataFileC = join(tmpdir(), `data-c-${Date.now()}.json`);
      await Bun.write(dataFileC, JSON.stringify({ count: 42 }));

      const putResultC = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "put", schemaHash2, dataFileC],
        { encoding: "utf-8" },
      );
      const hashC = putResultC.stdout.trim();

      // Create a variable with first schema
      const createResult = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      const created = JSON.parse(createResult.stdout).value;

      // Try to update with different schema
      const result = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "update", created.id, hashC],
        { encoding: "utf-8" },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr.toLowerCase()).toContain("schema mismatch");
    });
  });

  describe("Test Group 5: Variable Deletion", () => {
    test("5.1: Delete existing variable", () => {
      // Create a variable
      const createResult = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      const created = JSON.parse(createResult.stdout).value;

      // Delete the variable
      const result = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "delete", created.id],
        { encoding: "utf-8" },
      );

      expect(result.status).toBe(0);

      const output = JSON.parse(result.stdout);
      // Expect envelope format
      expect(output.type).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      expect(output.value).toBeDefined();

      // Check the actual variable in the value field
      const variable = output.value;
      expect(variable.id).toBe(created.id);

      // Verify it's deleted
      const getResult = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", created.id],
        { encoding: "utf-8" },
      );
      expect(getResult.status).not.toBe(0);
    });

    test("5.3: Delete non-existent variable", () => {
      const fakeId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
      const result = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "delete", fakeId],
        { encoding: "utf-8" },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Variable not found");
    });
  });

  describe("Test Group 6: Variable Listing", () => {
    test("6.1: List variables with scope prefix", () => {
      // Create variables with different scopes
      const createResult1 = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      expect(createResult1.status).toBe(0);
      const var1 = JSON.parse(createResult1.stdout).value;

      const createResult2 = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashB,
        ],
        { encoding: "utf-8" },
      );
      expect(createResult2.status).toBe(0);
      const var2 = JSON.parse(createResult2.stdout).value;

      const createResult3 = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/agent/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      expect(createResult3.status).toBe(0);
      const var3 = JSON.parse(createResult3.stdout).value;

      const createResult4 = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "app/config/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      expect(createResult4.status).toBe(0);

      // List all variables with uwf/ prefix
      const listResult = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "list", "--scope", "uwf/"],
        { encoding: "utf-8" },
      );

      expect(listResult.status).toBe(0);

      const output = JSON.parse(listResult.stdout);
      // Expect envelope format
      expect(output.type).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      expect(output.value).toBeDefined();
      expect(Array.isArray(output.value)).toBe(true);

      // Check the actual variables in the value field
      const variables = output.value;
      expect(variables).toHaveLength(3);
      expect(
        variables.every((v: { scope: string }) => v.scope.startsWith("uwf/")),
      ).toBe(true);

      // Verify ordering by created timestamp
      expect(variables[0].id).toBe(var1.id);
      expect(variables[1].id).toBe(var2.id);
      expect(variables[2].id).toBe(var3.id);
    });

    test("6.2: List all variables when no scope specified", () => {
      // Create variables with different scopes
      const createResult1 = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      expect(createResult1.status).toBe(0);

      const createResult2 = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "app/config/",
          "--value",
          hashB,
        ],
        { encoding: "utf-8" },
      );
      expect(createResult2.status).toBe(0);

      // List all variables without scope filter
      const listResult = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "list"],
        { encoding: "utf-8" },
      );

      expect(listResult.status).toBe(0);

      const output = JSON.parse(listResult.stdout);
      // Expect envelope format
      expect(output.type).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      expect(output.value).toBeDefined();
      expect(Array.isArray(output.value)).toBe(true);

      const variables = output.value;
      expect(variables).toHaveLength(2);
    });

    test("6.3: List returns empty array when no matches", () => {
      // Create a variable
      const createResult = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      expect(createResult.status).toBe(0);

      // List with non-matching scope
      const listResult = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "list",
          "--scope",
          "nonexistent/",
        ],
        { encoding: "utf-8" },
      );

      expect(listResult.status).toBe(0);

      const output = JSON.parse(listResult.stdout);
      expect(output.type).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      expect(output.value).toBeDefined();
      expect(Array.isArray(output.value)).toBe(true);
      expect(output.value).toHaveLength(0);
    });

    test("6.4: List fails with invalid scope format", () => {
      const listResult = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "list", "--scope", "uwf"],
        { encoding: "utf-8" },
      );

      expect(listResult.status).not.toBe(0);
      expect(listResult.stderr).toContain("scope must end with /");
    });
  });

  describe("Test Group 7: Integration Tests", () => {
    test("7.1: Full lifecycle workflow", async () => {
      // Create variable
      const createResult = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      expect(createResult.status).toBe(0);
      const var1 = JSON.parse(createResult.stdout).value;
      expect(var1.value).toBe(hashA);

      // Get variable
      const getResult1 = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", var1.id],
        { encoding: "utf-8" },
      );
      expect(getResult1.status).toBe(0);
      const retrieved1 = JSON.parse(getResult1.stdout).value;
      expect(retrieved1.value).toBe(hashA);

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update variable
      const updateResult = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "update", var1.id, hashB],
        { encoding: "utf-8" },
      );
      expect(updateResult.status).toBe(0);
      const updated = JSON.parse(updateResult.stdout).value;
      expect(updated.value).toBe(hashB);

      // Get updated variable
      const getResult2 = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", var1.id],
        { encoding: "utf-8" },
      );
      expect(getResult2.status).toBe(0);
      const retrieved2 = JSON.parse(getResult2.stdout).value;
      expect(retrieved2.value).toBe(hashB);

      // Delete variable
      const deleteResult = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "delete", var1.id],
        { encoding: "utf-8" },
      );
      expect(deleteResult.status).toBe(0);

      // Verify deletion
      const getResult3 = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", var1.id],
        { encoding: "utf-8" },
      );
      expect(getResult3.status).not.toBe(0);
    });

    test("7.2: Multiple variables with same scope", () => {
      // Create two variables
      const createResult1 = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      const var1 = JSON.parse(createResult1.stdout).value;

      const createResult2 = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashB,
        ],
        { encoding: "utf-8" },
      );
      const var2 = JSON.parse(createResult2.stdout).value;

      // Verify independence
      expect(var1.id).not.toBe(var2.id);

      const getResult1 = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", var1.id],
        { encoding: "utf-8" },
      );
      const retrieved1 = JSON.parse(getResult1.stdout).value;
      expect(retrieved1.value).toBe(hashA);

      const getResult2 = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", var2.id],
        { encoding: "utf-8" },
      );
      const retrieved2 = JSON.parse(getResult2.stdout).value;
      expect(retrieved2.value).toBe(hashB);

      // Delete var1, verify var2 still exists
      spawnSync("bun", [
        cliPath,
        "--store",
        storePath,
        "var",
        "delete",
        var1.id,
      ]);

      const getResult2Final = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", var2.id],
        { encoding: "utf-8" },
      );
      expect(getResult2Final.status).toBe(0);
      const retrieved2Final = JSON.parse(getResult2Final.stdout).value;
      expect(retrieved2Final.value).toBe(hashB);
    });

    test("7.3: Variables with hierarchical scopes", () => {
      const createResult1 = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      const var1 = JSON.parse(createResult1.stdout).value;

      const createResult2 = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/thread/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      const var2 = JSON.parse(createResult2.stdout).value;

      const createResult3 = spawnSync(
        "bun",
        [
          cliPath,
          "--store",
          storePath,
          "var",
          "create",
          "--scope",
          "uwf/workflow/",
          "--value",
          hashA,
        ],
        { encoding: "utf-8" },
      );
      const var3 = JSON.parse(createResult3.stdout).value;

      expect(var1.scope).toBe("uwf/");
      expect(var2.scope).toBe("uwf/thread/");
      expect(var3.scope).toBe("uwf/workflow/");

      // Verify all exist
      const get1 = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", var1.id],
        { encoding: "utf-8" },
      );
      expect(get1.status).toBe(0);

      const get2 = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", var2.id],
        { encoding: "utf-8" },
      );
      expect(get2.status).toBe(0);

      const get3 = spawnSync(
        "bun",
        [cliPath, "--store", storePath, "var", "get", var3.id],
        { encoding: "utf-8" },
      );
      expect(get3.status).toBe(0);
    });
  });
});
