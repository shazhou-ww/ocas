import { describe, expect, test } from "vitest";
import { z } from "zod";

import { createCLI } from "./index.js";

function createBuffers() {
  let stdout = "";
  let stderr = "";
  return {
    out: {
      stdout: { write: (text: string) => (stdout += text) },
      stderr: { write: (text: string) => (stderr += text) },
    },
    read: () => ({ stdout, stderr }),
  };
}

describe("command builder", () => {
  test("parses args/flags and validates yields/returns", async () => {
    const seen: {
      args?: Record<string, string>;
      flags?: Record<string, unknown>;
    } = {};
    const cli = createCLI({ name: "gangmu", version: "1.0.0" });

    cli
      .command("search")
      .arg("query")
      .flag("limit", { type: "number", default: 5 })
      .yields(
        z.object({ card: z.string(), score: z.number() }),
        "{{card}}:{{score}}",
      )
      .returns(
        z.object({ query: z.string(), count: z.number() }),
        "{{query}} {{count}}",
      )
      .action(async function* (args, flags) {
        seen.args = args;
        seen.flags = flags;
        yield { card: "alpha", score: 0.9 };
        return { query: args.query, count: Number(flags.limit) };
      });

    const io = createBuffers();
    const code = await cli.run({
      argv: [
        "search",
        "needle",
        "--limit",
        "2",
        "--format",
        "json",
        "--compact",
      ],
      ...io.out,
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(seen.args).toEqual({ query: "needle" });
    expect(seen.flags).toMatchObject({
      limit: 2,
      format: "json",
      compact: true,
      quiet: false,
    });

    expect(JSON.parse(stderr.trim())).toEqual({
      type: "@gangmu/search/yield",
      value: { card: "alpha", score: 0.9 },
    });

    expect(stdout).toBe(
      '{"type":"@gangmu/search","value":{"query":"needle","count":2}}\n',
    );
  });

  test("requires returns schema for executable leaf command", async () => {
    const cli = createCLI({ name: "gangmu", version: "1.0.0" });
    cli.command("leaf").action(async () => ({ ok: true }));

    const io = createBuffers();
    const code = await cli.run({ argv: ["leaf"], ...io.out });

    expect(code).toBe(1);
    expect(io.read().stderr.trim()).toContain("returns");
  });

  test("group command without subcommand shows help", async () => {
    const cli = createCLI({ name: "gangmu", version: "1.0.0" });
    cli
      .command("group")
      .command("child")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    const io = createBuffers();
    const code = await cli.run({ argv: ["group"], ...io.out });

    expect(code).toBe(0);
    expect(io.read().stdout).toContain("child");
  });
});

describe("multi-format returns API", () => {
  test("string shorthand is equivalent to { text: template }", async () => {
    const cli = createCLI({ name: "gangmu", version: "1.0.0" });
    cli
      .command("a")
      .returns(z.object({ name: z.string() }), "{{name}}")
      .action(async () => ({ name: "alice" }));
    cli
      .command("b")
      .returns(z.object({ name: z.string() }), { text: "{{name}}" })
      .action(async () => ({ name: "bob" }));

    const ioA = createBuffers();
    await cli.run({ argv: ["a"], ...ioA.out });
    const ioB = createBuffers();
    await cli.run({ argv: ["b"], ...ioB.out });

    expect(ioA.read().stdout).toBe("alice\n");
    expect(ioB.read().stdout).toBe("bob\n");
  });

  test("function formatter for text format", async () => {
    const cli = createCLI({ name: "gangmu", version: "1.0.0" });
    cli
      .command("custom")
      .returns(z.object({ name: z.string() }), {
        text: (v) => `custom ${(v as { name: string }).name}`,
      })
      .action(async () => ({ name: "alice" }));

    const io = createBuffers();
    await cli.run({ argv: ["custom"], ...io.out });

    expect(io.read().stdout).toBe("custom alice");
  });

  test("mixed template and function formatters", async () => {
    const cli = createCLI({ name: "gangmu", version: "1.0.0" });
    cli
      .command("mixed")
      .returns(z.object({ name: z.string() }), {
        text: "{{name}}",
        json: (v) => `${JSON.stringify(v)}\n`,
      })
      .action(async () => ({ name: "alice" }));

    const textIo = createBuffers();
    await cli.run({ argv: ["mixed"], ...textIo.out });
    expect(textIo.read().stdout).toBe("alice\n");

    const jsonIo = createBuffers();
    await cli.run({ argv: ["mixed", "--format", "json"], ...jsonIo.out });
    expect(jsonIo.read().stdout).toBe('{"name":"alice"}\n');
  });

  test("undeclared format falls through to auto-serialization", async () => {
    const cli = createCLI({ name: "gangmu", version: "1.0.0" });
    cli
      .command("text-only")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    const yamlIo = createBuffers();
    await cli.run({ argv: ["text-only", "--format", "yaml"], ...yamlIo.out });
    expect(yamlIo.read().stdout).toContain('type: "@gangmu/text-only"');
    expect(yamlIo.read().stdout).toContain("ok: true");

    const jsonIo = createBuffers();
    await cli.run({
      argv: ["text-only", "--format", "json", "--compact"],
      ...jsonIo.out,
    });
    expect(jsonIo.read().stdout).toBe(
      '{"type":"@gangmu/text-only","value":{"ok":true}}\n',
    );
  });

  test("default output format is text when no flag or defaultFormat", async () => {
    const cli = createCLI({ name: "gangmu", version: "1.0.0" });
    cli
      .command("def")
      .returns(z.object({ msg: z.string() }), "msg={{msg}}")
      .action(async () => ({ msg: "hi" }));

    const io = createBuffers();
    await cli.run({ argv: ["def"], ...io.out });

    expect(io.read().stdout).toBe("msg=hi\n");
  });
});
