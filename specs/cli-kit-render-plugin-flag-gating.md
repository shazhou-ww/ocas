---
scenario: "Render plugin controls availability of -r/--render standard flag"
feature: cli-kit
tags: [cli-kit, plugin, render, flags]
---

## Given

- A CLI is created without `ocasRenderPlugin`

## When

- Help output is generated or args are parsed for the command

## Then

- `-r` and `--render` are not registered as valid flags
- Passing `-r` or `--render` is rejected as unknown option

## Given

- A CLI is created with `plugins: [ocasRenderPlugin(() => openStore())]`

## When

- Help output is generated or args are parsed for the command

## Then

- `-r` and `--render` are registered as valid flags
- The render mode path can use plugin-provided store access
