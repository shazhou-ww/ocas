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
  CommandAction,
  CommandBuilder,
  CreateCliOptions,
  FlagDefinition,
  OutputFormat,
  RunOptions,
  SchemaBinding,
} from "./types.js";

interface InternalCommand {
  name: string;
  path: string[];
  description?: string;
  args: string[];
  flags: Record<string, FlagDefinition>;
  yieldBinding?: SchemaBinding;
  returnBinding?: SchemaBinding;
  action?: CommandAction;
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
  return "yaml";
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
): string {
  const lines: string[] = [];
  const path =
    command.name === "$root" ? cliName : `${cliName} ${command.path.join(" ")}`;

  if (command.children.size > 0) {
    const subcommandHint =
      command.name === "$root" ? "<command>" : "<subcommand>";
    lines.push(`Usage: ${path} ${subcommandHint} [options]`);
  } else if (command.args.length > 0) {
    const argList = command.args.map((arg) => `<${arg}>`).join(" ");
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
      lines.push(`  <${arg}>`);
    }
  }

  if (command.children.size > 0) {
    lines.push("");
    lines.push("Commands:");
    for (const child of command.children.values()) {
      lines.push(`  ${child.name}`);
    }
  }

  lines.push("");
  lines.push("Options:");
  lines.push("  -h, --help         Show help");
  lines.push("  --format <yaml|json|text|html>");
  lines.push("  --compact");
  lines.push("  --quiet");
  if (allowRenderFlag) {
    lines.push("  -r, --render");
  }

  for (const [name, definition] of Object.entries(command.flags)) {
    const flagLine = formatFlagLine(name, definition, allowRenderFlag);
    if (definition.type === "string") {
      lines.push(`${flagLine} <value>`);
    } else if (definition.type === "number") {
      lines.push(`${flagLine} <number>`);
    } else {
      lines.push(flagLine);
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
    children: new Map(),
  };
  const allowRenderFlag = Boolean(
    options.plugins?.some((plugin) => plugin.enableRenderFlag),
  );

  function wrap(node: InternalCommand): CommandBuilder {
    return {
      arg(name: string) {
        node.args.push(name);
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
          template,
          ...(config?.name !== undefined ? { name: config.name } : {}),
        };
        return this;
      },
      returns(schema, template, config) {
        node.returnBinding = {
          schema,
          template,
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
    stderr.write(envelopeToNdjson(`@${options.name}/error`, payload));
    return 1;
  }

  async function run(runOptions: RunOptions = {}): Promise<number> {
    const argv = runOptions.argv ?? process.argv.slice(2);
    const stdout = runOptions.stdout ?? process.stdout;
    const stderr = runOptions.stderr ?? process.stderr;

    try {
      if (wantsHelp(argv)) {
        const { command } = resolveCommand(root, stripHelp(argv));
        stdout.write(formatHelp(options.name, command, allowRenderFlag));
        return 0;
      }

      const { command, rest } = resolveCommand(root, argv);
      if (command === root) {
        const token = argv.find((part) => !part.startsWith("-"));
        if (token !== undefined) {
          throw new CliError(`Unknown command: ${token}`, "E_USAGE");
        }
        throw new CliError("No command selected", "E_USAGE");
      }
      if (command.children.size > 0) {
        const nextToken = rest.find((part) => !part.startsWith("-"));
        if (nextToken !== undefined) {
          throw new CliError(
            `Unknown ${command.path.join(" ")} subcommand: ${nextToken}`,
            "E_USAGE",
          );
        }
        throw new CliError("Command is not executable", "E_USAGE");
      }
      if (!command.action) {
        throw new CliError("Command action is missing", "E_USAGE");
      }
      if (!command.returnBinding) {
        throw new CliError(
          "Executable command requires .returns(...)",
          "E_USAGE",
        );
      }

      const parsed = parseArgv(rest, command.flags, allowRenderFlag);
      if (parsed.positionals.length < command.args.length) {
        throw new CliError("Missing positional arguments", "E_USAGE");
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
      command.args.forEach((name, idx) => {
        args[name] = parsed.positionals[idx] as string;
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

      const actionResult = command.action(
        args,
        {
          ...parsed.flags,
          _positionals: parsed.positionals,
        } as typeof parsed.flags,
        ctx,
      );
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
          const validated = validateWithSchema(
            command.yieldBinding.schema,
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

      const validatedFinal = validateWithSchema(
        command.returnBinding.schema,
        finalValue,
      );
      const returnType =
        command.returnBinding.name ??
        defaultReturnSchemaName(options.name, command.path);
      const outputCompact = parsed.flags.json || parsed.flags.compact;
      stdout.write(
        renderFinalOutput(
          outputFormat,
          outputCompact,
          returnType,
          validatedFinal,
          command.returnBinding.template,
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
    return formatHelp(options.name, root, allowRenderFlag);
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
