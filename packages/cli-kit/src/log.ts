import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliLogger {
  debug: (tag: string, msg: string) => void;
  info: (tag: string, msg: string) => void;
  warn: (tag: string, msg: string) => void;
}

const TAG_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export function assertValidLogTag(tag: string): void {
  if (!TAG_RE.test(tag)) {
    throw new Error(`invalid log tag: ${tag}`);
  }
}

export function createLogger(cliName: string, homeDir?: string): CliLogger {
  const baseHome = homeDir ?? homedir();

  function write(level: string, tag: string, msg: string): void {
    assertValidLogTag(tag);
    const day = new Date().toISOString().slice(0, 10);
    const dir = join(baseHome, `.${cliName}`, "logs");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${day}.jsonl`);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      level,
      tag,
      msg,
    });
    appendFileSync(file, `${line}\n`, "utf-8");
  }

  return {
    debug: (tag: string, msg: string) => write("debug", tag, msg),
    info: (tag: string, msg: string) => write("info", tag, msg),
    warn: (tag: string, msg: string) => write("warn", tag, msg),
  };
}
