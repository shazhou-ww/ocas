import type { z } from "zod";

export type FlagType = "string" | "number" | "boolean";
export type OutputFormat = "yaml" | "json" | "text" | "html";

export interface FlagDefinition {
  type: FlagType;
  default?: string | number | boolean;
  alias?: string;
  description?: string;
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
 * A schema morphism — transforms a zod schema. Used by the schema leg of
 * middleware to keep the envelope's type tag honest when the value leg
 * transforms the payload (e.g. redact removes a field → mapReturn must
 * omit that field from the schema too). Defaults to identity when omitted.
 */
export type SchemaMorphism = (schema: z.ZodType<unknown>) => z.ZodType<unknown>;

/**
 * Full middleware pair: a **value leg** (`run`) plus optional **schema legs**
 * (`mapYield`, `mapReturn`). The value leg wraps the handler exactly like a
 * bare `CliMiddleware` function. The schema legs transform the yield/return
 * schemas so that validation and envelope type tags reflect the *effective*
 * schema after middleware transformation — not the static binding schema.
 *
 * Coherence (functor law): if middleware `f` transforms value `v` to `f(v)`,
 * then `mapReturn(schema)` must produce a schema that `f(v)` inhabits.
 * Side-effect middleware (logging, timing) project to identity — they don't
 * transform the value, so they omit the schema legs entirely.
 *
 * See: [ocas#238](https://git.shazhou.work/shazhou/ocas/issues/238)
 */
export interface SchemaMiddleware {
  /** Value leg — wraps the handler (same as bare CliMiddleware function). */
  run: (handler: Handler) => Handler;
  /** Schema leg for yield values. Default: identity. */
  mapYield?: SchemaMorphism;
  /** Schema leg for return values. Default: identity. */
  mapReturn?: SchemaMorphism;
}

/**
 * Middleware is a function decorator: `(handler) => wrapped_handler`.
 * Composition is plain function composition with no `next()` — middleware
 * always wraps, so there is no "forgot to call next" footgun. Per-command
 * middleware (added via `.use()`) is applied innermost-first; global
 * middleware (from `CreateCliOptions.middleware`) is applied outermost.
 *
 * Accepts either a bare function (sugar for `{ run: fn }` — schema legs
 * default to identity, fully backward compatible) or a full
 * {@link SchemaMiddleware} pair with explicit schema morphisms.
 */
export type CliMiddleware = ((handler: Handler) => Handler) | SchemaMiddleware;

export interface CommandBuilder {
  arg(name: string, description?: string): CommandBuilder;
  describe(text: string): CommandBuilder;
  flag(name: string, definition: FlagDefinition): CommandBuilder;
  yields(
    schema: z.ZodType<unknown>,
    template: string,
    options?: { name?: string },
  ): CommandBuilder;
  returns(
    schema: z.ZodType<unknown>,
    formatsOrTemplate: string | Record<string, FormatRenderer>,
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

export type FormatRenderer = string | ((value: unknown) => string);

export interface SchemaBinding {
  schema: z.ZodType<unknown>;
  formats: Record<string, FormatRenderer>;
  name?: string;
  defaultFormat?: OutputFormat;
}
