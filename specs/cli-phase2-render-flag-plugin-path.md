---
scenario: "-r/--render in ocas CLI routes through ocasRenderPlugin after migration"
feature: render
tags: [cli, cli-kit, render, plugin, phase-2]
---

## Given

- The ocas CLI is created with `createCLI(...)` and registers `ocasRenderPlugin(...)`
- A command returns an `@ocas/output/*` envelope whose type has a render template

## When

- The command is run with `-r` (or `--render`)

## Then

- The render flag is handled by cli-kit/plugin integration instead of ad-hoc render branching
- Output is rendered using the ocas template pipeline for the envelope type
- The render result respects `--format` selection (`text` or `html`)
- Without the render flag, the same command returns the normal structured envelope output
