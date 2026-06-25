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

describe("cli-kit capability gaps (#230)", () => {
  describe("gap 1: --help / -h", () => {
    test("top-level --help lists commands and exits 0", async () => {
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("search")
        .describe("Search cards")
        .returns(z.object({ ok: z.boolean() }), "{{ok}}")
        .action(async () => ({ ok: true }));

      const io = createBuffers();
      const code = await cli.run({ argv: ["--help"], ...io.out });
      const { stdout } = io.read();

      expect(code).toBe(0);
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("search");
      expect(stdout).toContain("-h, --help");
    });

    test("command --help shows usage and flags", async () => {
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("search")
        .arg("query")
        .describe("Search cards")
        .flag("limit", { type: "number", default: 5 })
        .flag("scene", { type: "string", alias: "s" })
        .returns(z.object({ ok: z.boolean() }), "{{ok}}")
        .action(async () => ({ ok: true }));

      const io = createBuffers();
      const code = await cli.run({ argv: ["search", "--help"], ...io.out });
      const { stdout } = io.read();

      expect(code).toBe(0);
      expect(stdout).toContain("ocas search");
      expect(stdout).toContain("<query>");
      expect(stdout).toContain("-s, --scene");
      expect(stdout).toContain("--limit");
    });

    test("-h is equivalent to --help", async () => {
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("search")
        .returns(z.object({ ok: z.boolean() }), "{{ok}}")
        .action(async () => ({ ok: true }));

      const io = createBuffers();
      const code = await cli.run({ argv: ["search", "-h"], ...io.out });

      expect(code).toBe(0);
      expect(io.read().stdout).toContain("ocas search");
    });

    test("group --help lists subcommands", async () => {
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("var")
        .command("set")
        .returns(z.object({ ok: z.boolean() }), "{{ok}}")
        .action(async () => ({ ok: true }));

      const io = createBuffers();
      const code = await cli.run({ argv: ["var", "--help"], ...io.out });
      const { stdout } = io.read();

      expect(code).toBe(0);
      expect(stdout).toContain("ocas var");
      expect(stdout).toContain("set");
    });
  });

  describe("gap 2: short flag aliases", () => {
    test("-s maps to --scene string flag", async () => {
      const seen: { scene?: string } = {};
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("go")
        .flag("scene", { type: "string", alias: "s" })
        .returns(z.object({ ok: z.boolean() }), "{{ok}}")
        .action(async (_args, flags) => {
          seen.scene = flags.scene as string;
          return { ok: true };
        });

      const io = createBuffers();
      const code = await cli.run({ argv: ["go", "-s", "lobby"], ...io.out });

      expect(code).toBe(0);
      expect(seen.scene).toBe("lobby");
    });

    test("-v maps to boolean verbose flag", async () => {
      const seen: { verbose?: boolean } = {};
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("go")
        .flag("verbose", { type: "boolean", alias: "v" })
        .returns(z.object({ ok: z.boolean() }), "{{ok}}")
        .action(async (_args, flags) => {
          seen.verbose = flags.verbose as boolean;
          return { ok: true };
        });

      const io = createBuffers();
      const code = await cli.run({ argv: ["go", "-v"], ...io.out });

      expect(code).toBe(0);
      expect(seen.verbose).toBe(true);
    });
  });

  describe("gap 3: --no-<flag> boolean negation", () => {
    test("--no-network sets boolean flag to false", async () => {
      const seen: { network?: boolean } = {};
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("start")
        .flag("network", { type: "boolean", default: true })
        .returns(z.object({ ok: z.boolean() }), "{{ok}}")
        .action(async (_args, flags) => {
          seen.network = flags.network as boolean;
          return { ok: true };
        });

      const io = createBuffers();
      const code = await cli.run({
        argv: ["start", "--no-network"],
        ...io.out,
      });

      expect(code).toBe(0);
      expect(seen.network).toBe(false);
    });

    test("boolean flag default remains true without --no-", async () => {
      const seen: { network?: boolean } = {};
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("start")
        .flag("network", { type: "boolean", default: true })
        .returns(z.object({ ok: z.boolean() }), "{{ok}}")
        .action(async (_args, flags) => {
          seen.network = flags.network as boolean;
          return { ok: true };
        });

      const io = createBuffers();
      await cli.run({ argv: ["start"], ...io.out });

      expect(seen.network).toBe(true);
    });

    test("--no-<undefined> is unknown option", async () => {
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("start")
        .returns(z.object({ ok: z.boolean() }), "{{ok}}")
        .action(async () => ({ ok: true }));

      const io = createBuffers();
      const code = await cli.run({ argv: ["start", "--no-foo"], ...io.out });

      expect(code).toBe(1);
      expect(io.read().stderr).toContain("Unknown option");
    });
  });

  describe("gap 4: per-command defaultFormat", () => {
    test("defaultFormat text renders plain text without envelope", async () => {
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("plain")
        .returns(z.object({ msg: z.string() }), "{{msg}}", {
          defaultFormat: "text",
        })
        .action(async () => ({ msg: "hello" }));

      const io = createBuffers();
      const code = await cli.run({ argv: ["plain"], ...io.out });

      expect(code).toBe(0);
      expect(io.read().stdout.trim()).toBe("hello");
    });

    test("explicit --format yaml overrides defaultFormat text", async () => {
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("plain")
        .returns(z.object({ msg: z.string() }), "{{msg}}", {
          defaultFormat: "text",
        })
        .action(async () => ({ msg: "hello" }));

      const io = createBuffers();
      await cli.run({ argv: ["plain", "--format", "yaml"], ...io.out });

      expect(io.read().stdout).toContain("type:");
      expect(io.read().stdout).toContain("value:");
    });

    test("commands without defaultFormat still default to yaml", async () => {
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("yaml")
        .returns(z.object({ ok: z.boolean() }), "{{ok}}")
        .action(async () => ({ ok: true }));

      const io = createBuffers();
      await cli.run({ argv: ["yaml"], ...io.out });

      expect(io.read().stdout).toContain('type: "@ocas/yaml"');
    });

    test("action sees the user's raw --format, not the resolved wire format", async () => {
      // Contract: flags.format exposes the user's RAW --format value (or
      // undefined when omitted), NOT the resolved output format. Consumers like
      // the ocas CLI rely on this to use --format html|text as a command
      // argument (template namespace selection) independently of the output
      // encoding. The resolved format only governs how the envelope is rendered.
      const seen: { format?: string } = {};
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("plain")
        .returns(z.object({ ok: z.boolean() }), "{{ok}}", {
          defaultFormat: "text",
        })
        .action(async (_args, flags) => {
          seen.format = flags.format as string;
          return { ok: true };
        });

      // No --format passed: action sees undefined even though defaultFormat
      // resolves rendering to "text".
      const io = createBuffers();
      await cli.run({ argv: ["plain"], ...io.out });
      expect(seen.format).toBeUndefined();
      expect(io.read().stdout.trim()).toBe("true");

      // Explicit --format html: action sees the raw "html" verbatim.
      const io2 = createBuffers();
      await cli.run({ argv: ["plain", "--format", "html"], ...io2.out });
      expect(seen.format).toBe("html");
    });
  });

  describe("gap 5: ctx.stdout / ctx.stderr", () => {
    test("ctx.stderr writes directly to stderr", async () => {
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("diag")
        .returns(z.object({ ok: z.boolean() }), "{{ok}}")
        .action(async (_args, _flags, ctx) => {
          ctx.stderr("hello\n");
          return { ok: true };
        });

      const io = createBuffers();
      const code = await cli.run({
        argv: ["diag", "--format", "text"],
        ...io.out,
      });

      expect(code).toBe(0);
      expect(io.read().stderr).toBe("hello\n");
    });

    test("ctx.stdout writes directly to stdout alongside returns", async () => {
      const cli = createCLI({ name: "ocas", version: "1.0.0" });
      cli
        .command("diag")
        .returns(z.object({ ok: z.boolean() }), "{{ok}}", {
          defaultFormat: "text",
        })
        .action(async (_args, _flags, ctx) => {
          ctx.stdout("prefix: ");
          return { ok: true };
        });

      const io = createBuffers();
      await cli.run({ argv: ["diag"], ...io.out });

      expect(io.read().stdout).toBe("prefix: true\n");
    });
  });
});
