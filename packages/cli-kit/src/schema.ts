import type { z } from "zod";

export function defaultReturnSchemaName(
  cliName: string,
  commandPath: readonly string[],
): string {
  return `@${cliName}/${commandPath.join("/")}`;
}

export function defaultYieldSchemaName(
  cliName: string,
  commandPath: readonly string[],
): string {
  return `${defaultReturnSchemaName(cliName, commandPath)}/yield`;
}

export function validateWithSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}
