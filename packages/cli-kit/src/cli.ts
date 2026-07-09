import { z } from "zod";
import { parseArgv } from "./args.js";
import { createLogger } from "./log.js";
import { envelopeToNdjson, renderFinalOutput } from "./output.js";
import {
  defaultReturnSchemaName,
  defaultYieldSchemaName,
  validateWithSchema,
} from "./schema.js";
import type {
  CliContext,
  CliMiddleware,
  CommandAction,
  CommandBuilder,
  CreateCliOptions,
  FlagDefinition,
  FormatRenderer,
  Handler,
  OutputFormat,
  RunOptions,
  SchemaBinding,
  SchemaMiddleware,
  SchemaMorphism,
} from "./types.js";

interface InternalCommand {
  name: string;
  path: string[];
  description?: string;
  args: Array<{ name: string; description?: string }>;
  flags: Record<string, FlagDefinition>;
  yieldBinding?: SchemaBinding;
  returnBinding?: SchemaBinding;
  action?: CommandAction;
  middleware: CliMiddleware[];
  children: Map<string, InternalCommand>;
}

class CliError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const errorPayloadSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  command: z.string(),
});

function wantsHelp(tokens: string[]): boolean {
  return tokens.some((token) => token === "--help" || token === "-h");
}

function stripHelp(tokens: string[]): string[] {
  return tokens.filter((token) => token !== "--help" && token !== "-h");
}

function resolveOutputFormat(
  flags: {
    format?: OutputFormat;
    _formatExplicit?: boolean;
    json: boolean;
  },
  commandDefaultFormat?: OutputFormat,
): OutputFormat {
  // --json keeps the highest precedence for output formatting: it forces a JSON
  // envelope regardless of any explicit --format value. This preserves the
  // long-standing contract that consumers (e.g. the ocas CLI test harness) rely
  // on, where --format is often a command argument (which template namespace,
  // tree vs flat) rather than the wire output format, and --json is appended to
  // get a machine-parseable envelope on top of it.
  if (flags.json) {
    return "json";
  }
  // An explicit --format from the user wins over a per-command default.
  if (flags._formatExplicit && flags.format !== undefined) {
    return flags.format;
  }
  // Per-command default format (gap #4): applies only when the user gave
  // neither --json nor an explicit --format.
  if (commandDefaultFormat !== undefined) {
    return commandDefaultFormat;
  }
  return "text";
}

function normalizeFormats(
  formatsOrTemplate: string | Record<string, FormatRenderer>,
): Record<string, FormatRenderer> {
  if (typeof formatsOrTemplate === "string") {
    return { text: formatsOrTemplate };
  }
  return formatsOrTemplate;
}

function formatFlagLine(
  name: string,
  definition: FlagDefinition,
  allowRenderFlag: boolean,
): string {
  if (name === "render" && allowRenderFlag) {
    return "  -r, --render";
  }
  const alias = definition.alias;
  if (alias !== undefined) {
    return `  -${alias}, --${name}`;
  }
  return `  --${name}`;
}

function formatHelp(
  cliName: string,
  command: InternalCommand,
  allowRenderFlag: boolean,
  version?: string,
): string {
  const lines: string[] = [];
  const path =
    command.name === "$root" ? cliName : `${cliName} ${command.path.join(" ")}`;

  if (command.children.size > 0) {
    const subcommandHint =
      command.name === "$root" ? "<command>" : "<subcommand>";
    lines.push(`Usage: ${path} ${subcommandHint} [options]`);
  } else if (command.args.length > 0) {
    const argList = command.args.map((a) => `<${a.name}>`).join(" ");
    lines.push(`Usage: ${path} ${argList} [options]`);
  } else {
    lines.push(`Usage: ${path} [options]`);
  }

  if (command.description !== undefined) {
    lines.push("");
    lines.push(command.description);
  }

  if (command.args.length > 0) {
    lines.push("");
    lines.push("Arguments:");
    for (const arg of command.args) {
      const desc = arg.description ? `  ${arg.description}` : "";
      lines.push(`  <${arg.name}>${desc}`);
    }
  }

  if (command.children.size > 0) {
    lines.push("");
    lines.push("Commands:");
    const maxLen = Math.max(
      ...Array.from(command.children.values()).map((c) => c.name.length),
    );
    for (const child of command.children.values()) {
      const desc = child.description ?? "";
      const pad = " ".repeat(Math.max(2, maxLen - child.name.length + 2));
      lines.push(
        desc.length > 0 ? `  ${child.name}${pad}${desc}` : `  ${child.name}`,
      );
    }
  }

  lines.push("");
  lines.push("Options:");
  lines.push("  -h, --help         Show help");
  if (version !== undefined && command.name === "$root") {
    lines.push("  -v, --version      Show version");
  }
  // Only show --format when the command has a return binding
  if (command.returnBinding) {
    const declaredFormats = command.returnBinding.formats
      ? Object.keys(command.returnBinding.formats)
      : [];
    const supportedFormats = [
      ...new Set(["text", ...declaredFormats, "json", "yaml"]),
    ].sort();
    lines.push(`  --format <${supportedFormats.join("|")}>`);
  }
  if (allowRenderFlag) {
    lines.push("  -r, --render");
  }

  for (const [name, definition] of Object.entries(command.flags)) {
    const flagLine = formatFlagLine(name, definition, allowRenderFlag);
    const desc = definition.description ?? "";
    const suffix = desc.length > 0 ? `  ${desc}` : "";
    if (definition.type === "string") {
      lines.push(`${flagLine} <value>${suffix}`);
    } else if (definition.type === "number") {
      lines.push(`${flagLine} <number>${suffix}`);
    } else {
      lines.push(`${flagLine}${suffix}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function createCLI(options: CreateCliOptions): CommandBuilder & {
  run: (options?: RunOptions) => Promise<number>;
  help: () => string;
} {
  const root: InternalCommand = {
    name: "$root",
    path: [],
    args: [],
    flags: {},
    middleware: [],
    children: new Map(),
  };
  // The render flag (`-r`/`--render`) is enabled when a deprecated plugin
  // declares `enableRenderFlag`, OR when any global middleware is registered
  // (middleware is the new mechanism that consumes the flag). This keeps the
  // flag implicit for middleware-based consumers while preserving the legacy
  // plugin contract.
  const allowRenderFlag =
    Boolean(options.plugins?.some((plugin) => plugin.enableRenderFlag)) ||
    (options.middleware?.length ?? 0) > 0;
  const globalMiddleware = options.middleware ?? [];

  function wrap(node: InternalCommand): CommandBuilder {
    return {
      arg(name: string, description?: string) {
        node.args.push(
          description !== undefined ? { name, description } : { name },
        );
        return this;
      },
      describe(text: string) {
        node.description = text;
        return this;
      },
      flag(name: string, definition: FlagDefinition) {
        node.flags[name] = definition;
        return this;
      },
      yields(schema, template, config) {
        node.yieldBinding = {
          schema,
          formats: { text: template },
          ...(config?.name !== undefined ? { name: config.name } : {}),
        };
        return this;
      },
      returns(schema, formatsOrTemplate, config) {
        node.returnBinding = {
          schema,
          formats: normalizeFormats(formatsOrTemplate),
          ...(config?.name !== undefined ? { name: config.name } : {}),
          ...(config?.defaultFormat !== undefined
            ? { defaultFormat: config.defaultFormat }
            : {}),
        };
        return this;
      },
      command(name: string) {
        let child = node.children.get(name);
        if (!child) {
          child = {
            name,
            path: [...node.path, name],
            args: [],
            flags: {},
            middleware: [],
            children: new Map(),
          };
          node.children.set(name, child);
        }
        return wrap(child);
      },
      action(fn: CommandAction) {
        node.action = fn;
        return this;
      },
      use(middleware: CliMiddleware) {
        node.middleware.push(middleware);
        return this;
      },
    };
  }

  function emitError(
    stderr: { write: (text: string) => void },
    commandPath: string[],
    message: string,
    code?: string,
  ): number {
    const command = commandPath.join(" ");
    const payload = validateWithSchema(errorPayloadSchema, {
      message,
      ...(code !== undefined ? { code } : {}),
      command,
    });
    stderr.write(`Error: ${message}\n`);
    return 1;
  }

  async function run(runOptions: RunOptions = {}): Promise<number> {
    const argv = runOptions.argv ?? process.argv.slice(2);
    const stdout = runOptions.stdout ?? process.stdout;
    const stderr = runOptions.stderr ?? process.stderr;

    try {
      if (wantsHelp(argv)) {
        const { command } = resolveCommand(root, stripHelp(argv));
        stdout.write(
          formatHelp(options.name, command, allowRenderFlag, options.version),
        );
        return 0;
      }

      const { command, rest } = resolveCommand(root, argv);
      if (command === root) {
        const token = argv.find((part) => !part.startsWith("-"));
        if (token !== undefined) {
          throw new CliError(`Unknown command: ${token}`, "E_USAGE");
        }
        // No command given — show help
        stdout.write(
          `${formatHelp(options.name, root, allowRenderFlag, options.version)}\n`,
        );
        return 0;
      }
      if (command.children.size > 0) {
        const nextToken = rest.find((part) => !part.startsWith("-"));
        if (nextToken !== undefined) {
          throw new CliError(
            `Unknown ${command.path.join(" ")} subcommand: ${nextToken}`,
            "E_USAGE",
          );
        }
        // Group command without subcommand — show help
        stdout.write(
          `${formatHelp(options.name, command, allowRenderFlag, options.version)}\n`,
        );
        return 0;
      }
      if (!command.action) {
        throw new CliError("Command action is missing", "E_USAGE");
      }
      // Capture the narrowed action so the middleware base handler (a closure)
      // can invoke it without TypeScript widening it back to `| undefined`.
      const action = command.action;
      if (!command.returnBinding) {
        throw new CliError(
          "Executable command requires .returns(...)",
          "E_USAGE",
        );
      }

      const parsed = parseArgv(rest, command.flags, allowRenderFlag);
      if (parsed.positionals.length < command.args.length) {
        stdout.write(
          `${formatHelp(options.name, command, allowRenderFlag, options.version)}\n`,
        );
        return 1;
      }

      const outputFormat = resolveOutputFormat(
        parsed.flags,
        command.returnBinding.defaultFormat,
      );
      // NOTE: do NOT write `outputFormat` back into `parsed.flags.format`.
      // `outputFormat` is the resolved *wire* format used only for rendering the
      // final envelope below. The action must continue to see the user's raw
      // `--format` value (or undefined), because consumers like the ocas CLI use
      // `--format html|text` as a command argument (template namespace selection,
      // tree vs flat) independently of the output encoding. Overwriting it with
      // the wire format (e.g. "json" when --json is passed) would hide the user's
      // intent from the action. `_formatExplicit` is an internal parse marker and
      // is stripped before the flags reach the action.
      delete parsed.flags._formatExplicit;

      const args: Record<string, string> = {};
      command.args.forEach((argDef, idx) => {
        args[argDef.name] = parsed.positionals[idx] as string;
      });

      const logger = createLogger(options.name, options.homeDir);
      const ctx: CliContext = {
        command: command.path.join(" "),
        error: (message: string, code?: string): never => {
          throw new CliError(message, code);
        },
        log: logger,
        stdout: (text: string) => stdout.write(text),
        stderr: (text: string) => stderr.write(text),
      };

      const actionFlags = {
        ...parsed.flags,
        _positionals: parsed.positionals,
      } as typeof parsed.flags;

      // Compose the middleware chain around the action. The base handler
      // bridges the Handler signature `(ctx, flags)` to the action signature
      // `(args, flags, ctx)`, closing over `args`. Per-command middleware
      // (added via `.use()`) is applied innermost-first; global middleware
      // (from `CreateCliOptions.middleware`) is applied outermost, so it runs
      // first on entry and last on exit. Middleware may transform the return
      // value or return `undefined` to bypass the envelope output below.
      const baseHandler: Handler = async (handlerCtx, flags) =>
        action(args, flags, handlerCtx);
      const composed = composeMiddleware(
        command.middleware,
        globalMiddleware,
        baseHandler,
      );
      const { handler, yieldMorphism, returnMorphism } = composed;

      const actionResult = await handler(ctx, actionFlags);
      let finalValue: unknown;
      if (isAsyncGenerator(actionResult)) {
        const iterator = actionResult[Symbol.asyncIterator]();
        while (true) {
          const next = await iterator.next();
          if (next.done) {
            finalValue = next.value;
            break;
          }
          if (!command.yieldBinding) {
            throw new CliError(
              "Command yielded but no .yields(...) schema was declared",
            );
          }
          const effectiveYieldSchema = yieldMorphism(
            command.yieldBinding.schema,
          );
          const validated = validateWithSchema(
            effectiveYieldSchema,
            next.value,
          );
          if (!parsed.flags.quiet) {
            const type =
              command.yieldBinding.name ??
              defaultYieldSchemaName(options.name, command.path);
            stderr.write(envelopeToNdjson(type, validated));
          }
        }
      } else {
        finalValue = await actionResult;
      }

      if (finalValue === undefined) {
        return 0;
      }

      const returnType =
        command.returnBinding.name ??
        defaultReturnSchemaName(options.name, command.path);
      const outputCompact = parsed.flags.json || parsed.flags.compact;

      // For text format with a function renderer, pass the raw action result
      // (schema parse strips non-index array properties like _total/_offset)
      const renderer = command.returnBinding.formats[outputFormat];
      const outputValue =
        typeof renderer === "function"
          ? finalValue
          : validateWithSchema(
              returnMorphism(command.returnBinding.schema),
              finalValue,
            );

      stdout.write(
        renderFinalOutput(
          outputFormat,
          outputCompact,
          returnType,
          outputValue,
          command.returnBinding.formats,
        ),
      );
      return 0;
    } catch (error) {
      if (error instanceof CliError) {
        const path = tryResolvePath(root, argv);
        return emitError(stderr, path, error.message, error.code);
      }
      if (error instanceof Error) {
        const path = tryResolvePath(root, argv);
        return emitError(stderr, path, error.message);
      }
      const path = tryResolvePath(root, argv);
      return emitError(stderr, path, String(error));
    }
  }

  function help(): string {
    return formatHelp(options.name, root, allowRenderFlag, options.version);
  }

  return Object.assign(wrap(root), { run, help });
}

function isAsyncGenerator(
  value: unknown,
): value is AsyncGenerator<unknown, unknown, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]: unknown })[
      Symbol.asyncIterator
    ] === "function"
  );
}

/**
 * Normalize a CliMiddleware (which may be a bare function or a full
 * SchemaMiddleware pair) into the pair form. Bare functions become
 * `{ run: fn }` with identity schema legs.
 */
function normalizeMiddleware(mw: CliMiddleware): SchemaMiddleware {
  return typeof mw === "function" ? { run: mw } : mw;
}

/**
 * Compose middleware into a single handler plus folded schema morphisms.
 * Per-command middleware is applied innermost-first (array index 0 ends up
 * closest to the action); global middleware is applied last so it is outermost
 * (first to run on entry, last on exit). The resulting handler is
 * `globalN(...global1(perCommandN(...perCommand1(base))))`.
 *
 * Schema morphisms fold in the same order as value flow on exit: per-command
 * (index 0 → N) then global (index 0 → N). This ensures the effective schema
 * matches the transformed value at validation time.
 */
function composeMiddleware(
  perCommand: CliMiddleware[],
  global: CliMiddleware[],
  base: Handler,
): {
  handler: Handler;
  yieldMorphism: SchemaMorphism;
  returnMorphism: SchemaMorphism;
} {
  let handler = base;
  let yieldMorphism: SchemaMorphism = (s) => s;
  let returnMorphism: SchemaMorphism = (s) => s;

  const apply = (mw: CliMiddleware) => {
    const pair = normalizeMiddleware(mw);
    handler = pair.run(handler);
    if (pair.mapYield) {
      const prev = yieldMorphism;
      const map = pair.mapYield;
      yieldMorphism = (s) => map(prev(s));
    }
    if (pair.mapReturn) {
      const prev = returnMorphism;
      const map = pair.mapReturn;
      returnMorphism = (s) => map(prev(s));
    }
  };

  for (const mw of perCommand) apply(mw);
  for (const mw of global) apply(mw);

  return { handler, yieldMorphism, returnMorphism };
}

function resolveCommand(
  root: InternalCommand,
  argv: string[],
): { command: InternalCommand; rest: string[] } {
  let current = root;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index] as string;
    if (token.startsWith("-")) break;
    const next = current.children.get(token);
    if (!next) break;
    current = next;
    index++;
  }
  return { command: current, rest: argv.slice(index) };
}

function tryResolvePath(root: InternalCommand, argv: string[]): string[] {
  try {
    return resolveCommand(root, argv).command.path;
  } catch {
    return [];
  }
}
