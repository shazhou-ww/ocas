import { describe, expect, test } from "vitest";
import { z } from "zod";

import type { CliMiddleware, SchemaMiddleware } from "./index.js";
import { createCLI } from "./index.js";

function createBuffers() {
  let stdout = "";
  let stderr = "";
  return {
    out: {
      stdout: { write: (text: string) => (stdout += text) },
      stderr: { write: (text: string) => (stderr += text) },
    },
    read: () => ({ stdout, stderr }) as { stdout: string; stderr: string },
  };
}

/** A middleware that records its execution phase relative to the action. */
function trace(phase: string, log: string[]): CliMiddleware {
  return (inner) => async (ctx, flags) => {
    log.push(`pre:${phase}`);
    const result = await inner(ctx, flags);
    log.push(`post:${phase}`);
    return result;
  };
}

describe("middleware system", () => {
  test("global middleware applies to every command", async () => {
    const seen: string[] = [];
    const globalMw: CliMiddleware = (inner) => async (ctx, flags) => {
      seen.push(`global:${ctx.command}`);
      return inner(ctx, flags);
    };
    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [globalMw],
    });
    cli
      .command("a")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));
    cli
      .command("b")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    const ioA = createBuffers();
    await cli.run({ argv: ["a"], ...ioA.out });
    const ioB = createBuffers();
    await cli.run({ argv: ["b"], ...ioB.out });

    expect(seen).toEqual(["global:a", "global:b"]);
  });

  test("per-command middleware via .use() only affects that command", async () => {
    const seen: string[] = [];
    const perCommandMw: CliMiddleware = (inner) => async (ctx, flags) => {
      seen.push(`per:${ctx.command}`);
      return inner(ctx, flags);
    };
    const cli = createCLI({ name: "ocas", version: "1.0.0" });
    cli
      .command("with-mw")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .use(perCommandMw)
      .action(async () => ({ ok: true }));
    cli
      .command("without-mw")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    const io1 = createBuffers();
    await cli.run({ argv: ["with-mw"], ...io1.out });
    const io2 = createBuffers();
    await cli.run({ argv: ["without-mw"], ...io2.out });

    expect(seen).toEqual(["per:with-mw"]);
  });

  test("composition order: outermost wraps innermost (pre outer-first, post outer-last)", async () => {
    const log: string[] = [];
    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      // global middleware is applied outermost (runs first on entry).
      middleware: [trace("global", log)],
    });
    cli
      .command("cmd")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      // Per-command .use() order: earlier calls are innermost.
      .use(trace("inner", log))
      .use(trace("middle", log))
      .action(async () => {
        log.push("action");
        return { ok: true };
      });

    const io = createBuffers();
    const code = await cli.run({ argv: ["cmd"], ...io.out });
    expect(code).toBe(0);
    // Entry order: global (outermost) → middle → inner → action.
    // Exit order: action → inner → middle → global.
    expect(log).toEqual([
      "pre:global",
      "pre:middle",
      "pre:inner",
      "action",
      "post:inner",
      "post:middle",
      "post:global",
    ]);
  });

  test("middleware can transform the return value", async () => {
    const upper: CliMiddleware = (inner) => async (ctx, flags) => {
      const result = await inner(ctx, flags);
      return typeof result === "string" ? result.toUpperCase() : result;
    };
    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [upper],
    });
    cli
      .command("echo")
      .returns(z.string(), "{{value}}")
      .action(async () => "hello");

    const io = createBuffers();
    const code = await cli.run({
      argv: ["echo", "--format", "text"],
      ...io.out,
    });
    expect(code).toBe(0);
    // The middleware upper-cased the action's return value before the
    // envelope renderer saw it.
    expect(io.read().stdout.trim()).toBe("HELLO");
  });

  test("middleware that returns undefined bypasses the envelope output", async () => {
    const bypass: CliMiddleware = (inner) => async (ctx, flags) => {
      await inner(ctx, flags);
      // Returning undefined tells run() to skip envelope rendering entirely.
      return undefined;
    };
    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [bypass],
    });
    cli
      .command("silent")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    const io = createBuffers();
    const code = await cli.run({ argv: ["silent"], ...io.out });
    expect(code).toBe(0);
    // Nothing was written because the middleware swallowed the result.
    expect(io.read().stdout).toBe("");
    expect(io.read().stderr).toBe("");
  });

  test("middleware can write to ctx and still bypass envelope", async () => {
    const custom: CliMiddleware = (inner) => async (ctx, flags) => {
      await inner(ctx, flags);
      ctx.stdout("custom-output\n");
      return undefined;
    };
    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [custom],
    });
    cli
      .command("custom")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    const io = createBuffers();
    const code = await cli.run({ argv: ["custom"], ...io.out });
    expect(code).toBe(0);
    expect(io.read().stdout).toBe("custom-output\n");
  });

  test("middleware receives the parsed flags (incl. render when enabled)", async () => {
    let observedRender: unknown = "unset";
    const inspector: CliMiddleware = (inner) => async (ctx, flags) => {
      observedRender = flags.render;
      return inner(ctx, flags);
    };
    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [inspector],
    });
    cli
      .command("noop")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    const io = createBuffers();
    await cli.run({ argv: ["noop", "--render"], ...io.out });
    // middleware presence enables the render flag.
    expect(observedRender).toBe(true);
  });
});

describe("schema functor (middleware schema legs)", () => {
  test("mapReturn redact: middleware removes a field, schema follows", async () => {
    const redact: SchemaMiddleware = {
      run: (inner) => async (ctx, flags) => {
        const result = await inner(ctx, flags);
        if (result && typeof result === "object" && "secret" in result) {
          const { secret: _, ...rest } = result as Record<string, unknown>;
          return rest;
        }
        return result;
      },
      mapReturn: (schema) => {
        if (schema instanceof z.ZodObject) {
          return schema.omit({ secret: true });
        }
        return schema;
      },
    };

    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [redact],
    });
    cli
      .command("user")
      .returns(z.object({ name: z.string(), secret: z.string() }), "{{name}}")
      .action(async () => ({ name: "alice", secret: "hunter2" }));

    const io = createBuffers();
    const code = await cli.run({
      argv: ["user", "--format", "json"],
      ...io.out,
    });
    expect(code).toBe(0);
    const output = JSON.parse(io.read().stdout.trim());
    expect(output.value).toEqual({ name: "alice" });
    expect(output.value).not.toHaveProperty("secret");
  });

  test("mapReturn enrich: middleware adds a field, schema follows", async () => {
    const enrich: SchemaMiddleware = {
      run: (inner) => async (ctx, flags) => {
        const result = await inner(ctx, flags);
        if (result && typeof result === "object") {
          return { ...result, score: 100 };
        }
        return result;
      },
      mapReturn: (schema) => {
        if (schema instanceof z.ZodObject) {
          return schema.extend({ score: z.number() });
        }
        return schema;
      },
    };

    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [enrich],
    });
    cli
      .command("item")
      .returns(z.object({ name: z.string() }), "{{name}}")
      .action(async () => ({ name: "widget" }));

    const io = createBuffers();
    const code = await cli.run({
      argv: ["item", "--format", "json"],
      ...io.out,
    });
    expect(code).toBe(0);
    const output = JSON.parse(io.read().stdout.trim());
    expect(output.value).toEqual({ name: "widget", score: 100 });
  });

  test("composed schema morphisms: redact then enrich (functor law)", async () => {
    const redact: SchemaMiddleware = {
      run: (inner) => async (ctx, flags) => {
        const result = await inner(ctx, flags);
        if (result && typeof result === "object" && "secret" in result) {
          const { secret: _, ...rest } = result as Record<string, unknown>;
          return rest;
        }
        return result;
      },
      mapReturn: (schema) => {
        if (schema instanceof z.ZodObject) {
          return schema.omit({ secret: true });
        }
        return schema;
      },
    };

    const enrich: SchemaMiddleware = {
      run: (inner) => async (ctx, flags) => {
        const result = await inner(ctx, flags);
        if (result && typeof result === "object") {
          return { ...result, score: 100 };
        }
        return result;
      },
      mapReturn: (schema) => {
        if (schema instanceof z.ZodObject) {
          return schema.extend({ score: z.number() });
        }
        return schema;
      },
    };

    const cli = createCLI({ name: "ocas", version: "1.0.0" });
    cli
      .command("user")
      .returns(z.object({ name: z.string(), secret: z.string() }), "{{name}}")
      // .use() applies innermost-first: redact (inner) then enrich (outer).
      // Exit value flow: base → redact → enrich → output.
      // Schema fold: redact.mapReturn then enrich.mapReturn (matches value flow).
      .use(redact)
      .use(enrich)
      .action(async () => ({ name: "alice", secret: "hunter2" }));

    const io = createBuffers();
    const code = await cli.run({
      argv: ["user", "--format", "json"],
      ...io.out,
    });
    expect(code).toBe(0);
    const output = JSON.parse(io.read().stdout.trim());
    // redact removed secret, enrich added score
    expect(output.value).toEqual({ name: "alice", score: 100 });
    expect(output.value).not.toHaveProperty("secret");
  });

  test("mapYield: middleware transforms yield values, schema follows", async () => {
    const enrichYield: SchemaMiddleware = {
      run: (inner) => async (ctx, flags) => {
        const result = await inner(ctx, flags);
        if (
          result &&
          typeof result === "object" &&
          Symbol.asyncIterator in result
        ) {
          const gen = result as AsyncGenerator<unknown, unknown, unknown>;
          return (async function* enriched() {
            while (true) {
              const next = await gen.next();
              if (next.done) return next.value;
              yield { ...(next.value as object), extra: "added" };
            }
          })();
        }
        return result;
      },
      mapYield: (schema) => {
        if (schema instanceof z.ZodObject) {
          return schema.extend({ extra: z.string() });
        }
        return schema;
      },
    };

    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [enrichYield],
    });
    cli
      .command("stream")
      .yields(z.object({ id: z.number() }), "{{id}}")
      .returns(z.unknown(), "")
      .action(async function* () {
        yield { id: 1 };
        yield { id: 2 };
      });

    const io = createBuffers();
    const code = await cli.run({ argv: ["stream"], ...io.out });
    expect(code).toBe(0);
    const lines = io.read().stderr.trim().split("\n");
    expect(lines).toHaveLength(2);
    const [l1, l2] = lines as [string, string];
    const v1 = JSON.parse(l1);
    const v2 = JSON.parse(l2);
    expect(v1.value).toEqual({ id: 1, extra: "added" });
    expect(v2.value).toEqual({ id: 2, extra: "added" });
  });

  test("bare function middleware: schema unchanged (backward compat)", async () => {
    const passthrough: CliMiddleware = (inner) => async (ctx, flags) => {
      const result = await inner(ctx, flags);
      return result;
    };

    const cli = createCLI({
      name: "ocas",
      version: "1.0.0",
      middleware: [passthrough],
    });
    cli
      .command("noop")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    const io = createBuffers();
    const code = await cli.run({
      argv: ["noop", "--format", "json"],
      ...io.out,
    });
    expect(code).toBe(0);
    const output = JSON.parse(io.read().stdout.trim());
    expect(output.value).toEqual({ ok: true });
  });
});
