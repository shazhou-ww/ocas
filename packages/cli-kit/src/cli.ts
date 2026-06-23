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
  RunOptions,
  SchemaBinding,
} from "./types.js";

interface InternalCommand {
  name: string;
  path: string[];
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
        // Explicitly consume the generator so we can handle yield and final return separately.
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

      const validatedFinal = validateWithSchema(
        command.returnBinding.schema,
        finalValue,
      );
      const returnType =
        command.returnBinding.name ??
        defaultReturnSchemaName(options.name, command.path);
      stdout.write(
        renderFinalOutput(
          parsed.flags.format,
          parsed.flags.compact,
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
    const rows = [
      `Usage: ${options.name} <command> [options]`,
      "",
      "Standard flags:",
      "  --format <yaml|json|text|html>",
      "  --compact",
      "  --quiet",
      ...(allowRenderFlag ? ["  -r, --render"] : []),
    ];
    return rows.join("\n");
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
