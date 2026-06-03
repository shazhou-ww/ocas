import { describe, expect, test } from "vitest";
import type { Variable } from "./variable.js";

describe("Variable Type", () => {
  test("Variable type uses (name, schema) composite key", () => {
    const variable: Variable = {
      name: "config",
      schema: "ABC123DEF4567",
      value: "XYZ789GHI0123",
      created: 1234567890000,
      updated: 1234567890000,
      tags: { env: "prod" },
      labels: ["critical"],
    };

    expect(variable.name).toBe("config");
    expect(variable.schema).toBe("ABC123DEF4567");
    // id and scope should not exist
    expect((variable as unknown as { id?: unknown }).id).toBeUndefined();
    expect((variable as unknown as { scope?: unknown }).scope).toBeUndefined();
  });
});
