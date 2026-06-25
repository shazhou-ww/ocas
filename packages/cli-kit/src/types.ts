import type { z } from "zod";

export type FlagType = "string" | "number" | "boolean";
export type OutputFormat = "yaml" | "json" | "text" | "html";

export interface FlagDefinition {
  type: FlagType;
  default?: string | number | boolean;
  alias?: string;
}

export interface ParsedFlags extends Record<string, unknown> {
  format?: OutputFormat;
  _formatExplicit?: boolean;
  compact: boolean;
  quiet: boolean;
  json: boolean;
  render?: boolean;
}

export interface CliContext {
  command: string;
  error: (message: string, code?: string) => never;
  log: {
    debug: (tag: string, msg: string) => void;
    info: (tag: string, msg: string) => void;
    warn: (tag: string, msg: string) => void;
  };
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export type CommandAction = (
  args: Record<string, string>,
  flags: ParsedFlags,
  ctx: CliContext,
) => Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>;

/**
 * Base handler invoked by the composed middleware chain. It receives the
 * resolved `flags` (the same object the action sees, including `_positionals`)
 * so middleware can inspect user intent (e.g. `flags.render`). The `args` are
 * closed over by the base handler created in `run()`.
 */
export type Handler = (ctx: CliContext, flags: ParsedFlags) => Promise<unknown>;

/**
 * Middleware is a function decorator: `(handler) => wrapped_handler`.
 * Composition is plain function composition with no `next()` — middleware
 * always wraps, so there is no "forgot to call next" footgun. Per-command
 * middleware (added via `.use()`) is applied innermost-first; global
 * middleware (from `CreateCliOptions.middleware`) is applied outermost.
 */
export type CliMiddleware = (handler: Handler) => Handler;

export interface CommandBuilder {
  arg(name: string): CommandBuilder;
  describe(text: string): CommandBuilder;
  flag(name: string, definition: FlagDefinition): CommandBuilder;
  yields(
    schema: z.ZodType<unknown>,
    template: string,
    options?: { name?: string },
  ): CommandBuilder;
  returns(
    schema: z.ZodType<unknown>,
    template: string,
    options?: { name?: string; defaultFormat?: OutputFormat },
  ): CommandBuilder;
  command(name: string): CommandBuilder;
  action(fn: CommandAction): CommandBuilder;
  /** Attach per-command middleware. May be chained; earlier calls are innermost. */
  use(middleware: CliMiddleware): CommandBuilder;
}

/**
 * @deprecated Kept for backward compatibility. `CliPlugin` only *declares*
 * capabilities (e.g. `enableRenderFlag`) without providing behavior. New code
 * should use `CliMiddleware` (via `CreateCliOptions.middleware` or
 * `CommandBuilder.use()`) to supply behavior directly.
 */
export interface CliPlugin {
  name: string;
  enableRenderFlag?: boolean;
  openStore?: () => unknown;
}

export interface CreateCliOptions {
  name: string;
  version: string;
  /** @deprecated Use `middleware` instead. */
  plugins?: CliPlugin[];
  /** Global middleware, applied (outermost) to every command. */
  middleware?: CliMiddleware[];
  homeDir?: string;
}

export interface RunOptions {
  argv?: string[];
  stdout?: { write: (text: string) => void };
  stderr?: { write: (text: string) => void };
}

export interface SchemaBinding {
  schema: z.ZodType<unknown>;
  template: string;
  name?: string;
  defaultFormat?: OutputFormat;
}
