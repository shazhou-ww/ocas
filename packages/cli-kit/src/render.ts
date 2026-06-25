import type { CliMiddleware, CliPlugin } from "./types.js";

function lookupPath(value: unknown, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = value;
  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      if (part === "value" && parts.length === 1) {
        return current;
      }
      return "";
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function renderTemplate(template: string, value: unknown): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
    const resolved = lookupPath(value, key);
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

/**
 * A render function used by {@link renderMiddleware}. It receives the store
 * (opened lazily by the middleware only when rendering is needed) and the
 * action's return value. It returns the rendered string, or `undefined` to
 * signal that this value should not be rendered — in which case the
 * middleware passes the original result through untouched. This skip signal is
 * what lets a single global render middleware coexist with commands whose
 * return values are not renderable (e.g. a boolean from `has`).
 */
export type RenderFn = (
  store: unknown,
  value: unknown,
) => Promise<string | undefined>;

/**
 * Middleware that renders the action's return value when `--render` is set.
 *
 * `openStore` is called lazily — only when `flags.render` is true and the
 * action returned a non-`undefined` value — so commands that do not opt into
 * rendering pay no cost. `renderFn` decides whether the value is renderable;
 * returning `undefined` skips rendering and lets the normal envelope output
 * proceed. This keeps `cli-kit` free of any `@ocas/core` dependency: the
 * caller supplies both the store opener and the render function.
 */
export function renderMiddleware(
  openStore: () => unknown,
  renderFn: RenderFn,
): CliMiddleware {
  return (inner) => async (ctx, flags) => {
    const result = await inner(ctx, flags);
    if (flags.render === true && result !== undefined) {
      const store = await openStore();
      const rendered = await renderFn(store, result);
      if (rendered !== undefined) {
        ctx.stdout(`${rendered}\n`);
        return undefined;
      }
    }
    return result;
  };
}

/**
 * @deprecated Use {@link renderMiddleware} instead. This plugin only declares
 * the `enableRenderFlag` capability; it does not provide render behavior.
 */
export function ocasRenderPlugin(openStore: () => unknown): CliPlugin {
  return {
    name: "ocas-render",
    enableRenderFlag: true,
    openStore,
  };
}
