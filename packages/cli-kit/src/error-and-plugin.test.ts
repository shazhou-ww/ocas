import { describe, expect, test } from "vitest";
import { z } from "zod";

import { createCLI, ocasRenderPlugin, renderMiddleware } from "./index.js";

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

describe("error envelope and render plugin", () => {
  test("ctx.error emits @<cli>/error and exits non-zero", async () => {
    const cli = createCLI({ name: "ocas", version: "1.0.0" });
    cli
      .command("boom")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async (_args, _flags, ctx) => ctx.error("msg", "E_CODE"));

    const io = createBuffers();
    const code = await cli.run({ argv: ["boom"], ...io.out });

    expect(code).toBe(1);
    const stderr = io.read().stderr.trim();
    expect(stderr).toBe("Error: msg");
  });

  test("thrown exceptions are normalized into error envelope", async () => {
    const cli = createCLI({ name: "ocas", version: "1.0.0" });
    cli
      .command("explode")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => {
        throw new Error("kaboom");
      });

    const io = createBuffers();
    const code = await cli.run({ argv: ["explode"], ...io.out });

    expect(code).toBe(1);
    const stderr = io.read().stderr.trim();
    expect(stderr).toContain("Error: kaboom");
  });

  test("render flag is rejected without middleware or plugin", async () => {
    const withoutAnything = createCLI({ name: "ocas", version: "1.0.0" });
    withoutAnything
      .command("noop")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    expect(withoutAnything.help()).not.toContain("--render");
    const io1 = createBuffers();
    const code1 = await withoutAnything.run({
      argv: ["noop", "--render"],
      ...io1.out,
    });
    expect(code1).toBe(1);
    expect(io1.read().stderr).toContain("Unknown option");
  });

  test("renderMiddleware enables the flag and renders the return value", async () => {
    let openedStore = false;
    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [
        renderMiddleware(
          () => {
            openedStore = true;
            return { opened: true };
          },
          async () => "RENDERED",
        ),
      ],
    });
    let seenRenderFlag = false;
    cli
      .command("noop")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async (_args, flags) => {
        seenRenderFlag = flags.render === true;
        return { ok: true };
      });

    // The middleware is what enables the -r/--render flag now.
    expect(cli.help()).toContain("--render");
    const io = createBuffers();
    const code = await cli.run({ argv: ["noop", "--render"], ...io.out });
    expect(code).toBe(0);
    expect(seenRenderFlag).toBe(true);
    // The store opener ran (lazily, only because --render was set).
    expect(openedStore).toBe(true);
    // The render fn output replaced the envelope.
    expect(io.read().stdout).toBe("RENDERED\n");
    expect(io.read().stdout).not.toContain('"type"');
  });

  test("renderMiddleware skips non-renderable results (no --render, no store open)", async () => {
    let openedStore = false;
    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [
        renderMiddleware(
          () => {
            openedStore = true;
            return { opened: true };
          },
          async () => "RENDERED",
        ),
      ],
    });
    cli
      .command("noop")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    const io = createBuffers();
    const code = await cli.run({ argv: ["noop"], ...io.out });
    expect(code).toBe(0);
    // Without --render the store opener must not run.
    expect(openedStore).toBe(false);
    // Normal envelope output is untouched (default YAML format).
    expect(io.read().stdout).toContain("@ocas/noop");
  });

  test("renderMiddleware renderFn returning undefined bypasses render (passthrough)", async () => {
    let openedStore = false;
    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [
        renderMiddleware(
          () => {
            openedStore = true;
            return { opened: true };
          },
          // A render fn that declines to render (e.g. the value is not a hash)
          // signals this by returning undefined.
          async () => undefined,
        ),
      ],
    });
    cli
      .command("has")
      .returns(z.boolean(), "{{value}}")
      .action(async () => true);

    const io = createBuffers();
    const code = await cli.run({
      argv: ["has", "--render", "--format", "text"],
      ...io.out,
    });
    expect(code).toBe(0);
    // Store was opened (the middleware only knows after asking the render fn),
    // but the render fn declined, so the normal text output is produced.
    expect(openedStore).toBe(true);
    expect(io.read().stdout.trim()).toBe("true");
  });

  test("deprecated ocasRenderPlugin still enables the render flag (backward compat)", async () => {
    const withPlugin = createCLI({
      name: "ocas",
      version: "1.0.0",
      plugins: [ocasRenderPlugin(() => ({ open: true }))],
    });
    let seenRenderFlag = false;
    withPlugin
      .command("noop")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async (_args, flags) => {
        seenRenderFlag = flags.render === true;
        return { ok: true };
      });

    expect(withPlugin.help()).toContain("--render");
    const io2 = createBuffers();
    const code2 = await withPlugin.run({
      argv: ["noop", "--render"],
      ...io2.out,
    });
    expect(code2).toBe(0);
    expect(seenRenderFlag).toBe(true);
  });
});
