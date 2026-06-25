# cli-kit 能力补全（#230）— 实现设计

> 来源：sumeru CLI 迁移到 `@ocas/cli-kit` v0.2.1 撞出的 5 个能力缺口。
> 母 issue：#230。本文为收敛后的实现蓝图，5 个缺口一并落地。

## 设计总原则

1. **不破坏现有 12 个测试** —— cli-kit 默认行为（YAML envelope、yields→stderr、returns→stdout、error envelope）保持向后兼容。
2. **结构化优先仍是默认** —— ocas 自身 CLI 的类型化契约不动；新能力是"按需 opt-in"，不改全局缺省世界观。
3. **每个缺口配测试** —— 测试用现有 `createBuffers()` 注入 stdout/stderr 的惯例。

---

## 缺口 1：`--help` / `-h`（P0）

**现状**：`args.ts` 遇到未知 flag 直接 `throw "Unknown option: --help"`；`cli.ts` 已有 `help()` 但只返回顶层一行 usage，且没接进 `run()`。

**目标**：
- `<cli> --help` / `<cli> -h` → 打印顶层帮助（命令列表）+ exit 0
- `<cli> <command> --help` → 打印该命令的用法（args、flags、描述）+ exit 0
- `<cli> <group> --help` → 打印该 group 的子命令列表

**实现**：
- `run()` 在 `resolveCommand` 后、`parseArgv` 前，先扫 `rest`（和顶层 argv）里是否含 `--help`/`-h`。命中则走 `printHelp(command)` 分支，写 stdout，return 0。
- `--help` 必须在 `parseArgv` 抛 "Unknown option" 之前拦截（不进解析器）。
- `help()` 升级：支持传入一个 command 节点，输出：
  ```
  Usage: <cli> <path> [<args>] [options]

  Arguments:
    <argname>

  Commands:           （若有子命令）
    <child>

  Options:
    -h, --help         Show help
    --format <yaml|json|text|html>
    --compact
    --quiet
    <command-specific flags，含 alias 展示 -s, --scene>
  ```
- 顶层 `--help`：列出 root.children 所有命令名。
- 为支持命令描述，`CommandBuilder` 加可选 `.describe(text: string)`（存 `node.description`）。非必填，缺省不显示描述行。

**测试**：
- `cli.run({argv:["--help"]})` → code 0，stdout 含 "Usage" 和命令名。
- `cli.run({argv:["search","--help"]})` → code 0，stdout 含 "search" 用法和其 flags。
- `-h` 等价。

---

## 缺口 2：短 flag 别名 `-s → --scene`（P0）

**现状**：`args.ts:64-70` 把单字符 token（如 `-s`）当成名为 `s` 的独立 flag，无法映射到 `--scene`。

**目标**：`.flag("scene", { type: "string", alias: "s" })` 后，`-s x` 等价 `--scene x`。

**实现**：
- `FlagDefinition` 加 `alias?: string`（单字符）。
- `parseArgv` 构建一张 `aliasMap: Record<string, string>`（单字符 → 完整 flag 名），从 `definitions` 里收集。
- 解析单字符 token 时，先查 `aliasMap`：命中则 `key = aliasMap[char]`，按完整 flag 的 definition 走（含 string 取值、boolean 置真）。
- 与现有 `-r`（render）兼容：`-r` 是内置特例，保留；但若某命令显式 alias 了 `r`，命令级优先（边缘情况，文档注明 `-r` 为 render 保留）。
- `--help` 渲染 flag 时，若有 alias，展示成 `-s, --scene`。

**测试**：
- `.flag("scene",{type:"string",alias:"s"})`，`run(["cmd","-s","lobby"])` → action 里 `flags.scene === "lobby"`。
- boolean alias：`.flag("verbose",{type:"boolean",alias:"v"})`，`-v` → `flags.verbose === true`。

---

## 缺口 3：`--no-<flag>` 布尔取反（P1）

**现状**：`args.ts` 把 `--no-network` 解析成名为 `no-network` 的 flag → Unknown option。

**目标**：对**布尔型** flag，`--no-network` → `network = false`。

**实现**：
- `parseArgv` 解析 `--` token 时，若 `key` 以 `no-` 开头，剥掉前缀得 `baseKey`；查 `definitions[baseKey]`，若存在且 `type === "boolean"`，则 `flags[baseKey] = false`，continue。
- 不存在或非 boolean → 维持原 "Unknown option" 行为（不静默吞）。
- 与 default 交互：boolean flag 可有 `default:true`，`--no-x` 能把它压回 false。

**测试**：
- `.flag("network",{type:"boolean",default:true})`，`run(["cmd","--no-network"])` → `flags.network === false`。
- `run(["cmd"])` → `flags.network === true`（default 生效）。
- `--no-<未定义>` → Unknown option，code 1。

---

## 缺口 4：默认输出格式 per-command（P1，本次重点）

**现状**：全局默认 `format: "yaml"`（`args.ts:14`）。sumeru 多数命令想要 plain text。

**决策（主人拍板）**：**不改全局默认**（保住 ocas 类型化契约），改为**命令可声明自己的默认格式**。

**实现**：
- `.returns(schema, template, options)` 的 options 加 `defaultFormat?: OutputFormat`。
- 存入 `returnBinding.defaultFormat`。
- `run()` 里决定 `outputFormat` 时，优先级（**已按真实消费者契约修正**）：
  1. `--json`（最高 —— 强制 JSON envelope，向后兼容铁律，见下方「关键修正」）
  2. 用户显式 `--format X`
  3. 命令的 `returnBinding.defaultFormat`（新）
  4. 全局默认 `yaml`（兜底）
- **关键**：怎么判断用户是否"显式"传了 `--format`？现在 `parseArgv` 给 format 灌了默认 "yaml"，无法区分"用户传了 yaml" vs "没传"。
  - 方案：`parseArgv` 不再给 format 预置默认值，改为**只在用户显式传入时**才设 `flags.format`；是否显式用一个 `flags._formatExplicit: boolean` 标记。
  - `run()` 内 `resolveOutputFormat()` 按上述优先级算出 `outputFormat`（局部变量），只喂给 `renderFinalOutput`。
  - **关键修正（实现期发现的回归，务必遵守）**：
    1. **`--json` 必须保持最高优先级**。真实消费者 ocas CLI 把 `--format html|text|tree` 当作*命令参数*（template namespace 选择、tree vs flat 遍历），再追加 `--json` 拿机器可解析的 envelope。最初设计把"显式 --format > --json"导致 `--format tree --json` 输出 YAML（tree 非标准格式→兜底 YAML），打挂 10 个 cli 包测试。修正为 `--json > 显式--format > defaultFormat > yaml`。
    2. **绝不把 `outputFormat` 回写进 `parsed.flags.format`**。`outputFormat` 是渲染用的 wire format；action 必须看到用户**原始**的 `--format` 值（或 undefined）。回写会把 `--json` 时的 `"json"` 灌进 flags，让 cli 包 action 读不到用户传的 `html`（用于判断 `--static`/namespace），再次打挂 6 个测试。`_formatExplicit` 是内部标记，传给 action 前 `delete` 掉。

**测试**：
- `.returns(schema, tmpl, {defaultFormat:"text"})`，`run(["cmd"])`（不传 --format）→ stdout 是 text 渲染（无 YAML envelope）。
- 同命令 `run(["cmd","--format","yaml"])` → 用户显式 yaml 胜出，输出 envelope。
- 同命令 `run(["cmd","--json"])` → `--json` 最高优先级，输出 JSON envelope。
- action 内读 `flags.format` → 看到用户**原始**传入值（没传则 undefined），**不是** resolve 后的 wire format。
- 未声明 defaultFormat 的命令 `run(["cmd"])` → 仍默认 yaml（向后兼容，现有测试不破）。

---

## 缺口 5：`ctx.stdout` / `ctx.stderr` 直写通道（P2）

**现状**：`ctx.log.info()` 只 appendFile 到 `~/.<cli>/logs/`，终端不可见。长跑进程（server）需要 stderr 诊断输出。

**目标**：给 action 一个直接写 console 的通道，不经类型 envelope。

**实现**：
- `CliContext` 加：
  - `stdout: (text: string) => void` —— 直写 run 的 stdout
  - `stderr: (text: string) => void` —— 直写 run 的 stderr
- `run()` 构建 ctx 时，把当前 `stdout`/`stderr`（RunOptions 注入或 process.std*）的 `write` 闭包进去。
- `log` 维持现状（写文件不变，向后兼容）。
- 文档注明：结构化日志走 `ctx.log`（文件），即时诊断走 `ctx.stderr`。

**测试**：
- action 内 `ctx.stderr("hello\n")` → `run` 的 stderr buffer 含 "hello"。
- action 内 `ctx.stdout(...)` 同理。
- 不影响 returns 的正常 stdout 渲染（两者可共存，注意顺序）。

---

## 不做（明确划界）

- **不引入第三方解析库**（commander/yargs）—— 保持 cli-kit 零依赖、自解析。
- **不改 yields→stderr / returns→stdout 的通道语义**。
- **不动 log 写文件的既有行为**（只是新增直写通道）。

## 验收

1. `npx vitest run packages/cli-kit` 全绿（含新增测试，旧 12 个不破）。
2. `pnpm run build` 干净。
3. `pnpm run check`（Biome）无 error。
4. 加 changeset（`@ocas/cli-kit` minor —— 全是新增能力，无 breaking）。
5. 更新 `packages/cli-kit/README.md` 文档：alias、--no-、defaultFormat、ctx.stderr、--help 用法。
