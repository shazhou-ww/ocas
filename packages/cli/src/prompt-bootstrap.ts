import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Walk up from __dirname to find the nearest @ocas/cli package.json
function _findCliVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "@ocas/cli") {
        return pkg.version ?? "0.0.0";
      }
    } catch {
      // not found, keep walking
    }
    dir = dirname(dir);
  }
  return "0.0.0";
}

const CLI_VERSION = _findCliVersion();

export function cmdPromptBootstrap(): string {
  return `# ocas Bootstrap

Set up or upgrade ocas (Object Content Addressable Store) — from zero to running your first command.

## Scenario A: Fresh Install

### Step 0 — Environment pre-flight check

Run ALL checks below BEFORE installing anything. If any check fails, fix it first — do NOT skip ahead.

\`\`\`bash
# 1. Node.js
node --version   # need v20+
# FIX: install via nvm (https://github.com/nvm-sh/nvm) or your OS package manager

# 2. Package manager — pnpm (preferred) or npm
pnpm --version || npm --version
# FIX for pnpm: corepack enable pnpm   (Node 20+)
#   or: npm install -g pnpm
# If pnpm is not an option, npm works too — adjust install commands below

# 3. Global bin directory is in PATH
# For pnpm:
pnpm bin -g       # prints the global bin directory
# For npm:
npm prefix -g     # global prefix; bin is <prefix>/bin
# The directory printed above MUST be in your PATH.
# Test: echo \\$PATH | tr ':' '\\n'
# FIX: add the missing directory to your shell's startup file
#   (e.g. ~/.bashrc, ~/.zshrc, ~/.profile, or fish config):
#   export PATH="<global-bin-dir>:$PATH"
\`\`\`

**All checks must pass before continuing.** If you had to modify PATH, verify the change persists by opening a new shell or sourcing your shell config.

### Step 1 — Install @ocas/cli

\`\`\`bash
# Using pnpm (preferred)
pnpm add -g @ocas/cli

# Using npm
npm install -g @ocas/cli
\`\`\`

**After installing, verify that \`ocas\` is available in PATH:**

\`\`\`bash
ocas --version   # should print ${CLI_VERSION}
\`\`\`

If the command is not found, the global bin directory is not in the current shell's PATH. **You must fix this before continuing:**

1. Find where the binary was installed:
   \`\`\`bash
   find ~/.local /usr/local -name ocas -type f 2>/dev/null
   npm prefix -g    # global prefix — bin is <prefix>/bin
   \`\`\`
2. Add the directory to PATH permanently by appending to the user's shell config (e.g. \`~/.bashrc\`, \`~/.zshrc\`, \`~/.profile\`, or fish config):
   \`\`\`bash
   export PATH="<global-bin-dir>:$PATH"
   \`\`\`
3. Source the updated config or open a new shell, then re-verify the command works.

### Step 2 — Verify version

\`\`\`bash
ocas --version   # should print ${CLI_VERSION}
\`\`\`

### Step 3 — Install the ocas skill

Run the usage prompt and save it as a skill so your agent knows how to use ocas:

\`\`\`bash
ocas prompt usage
\`\`\`

The output is the skill body **without** frontmatter. Save it as a skill in your agent framework with the following YAML frontmatter prepended:

\`\`\`yaml
---
name: ocas
description: "Use when storing, retrieving, or managing typed JSON data with OCAS (Object Content Addressable Store). Covers CLI usage, variable management, templates, rendering, and pipe composition."
version: ${CLI_VERSION}
author: OCAS
license: MIT
metadata:
  hermes:
    tags: [cas, storage, cli, json, schema, content-addressing]
---
\`\`\`

Replace the \`version\` field with the installed CLI version (from \`ocas --version\`).

**⚠ After saving the skill, start a new session** so the agent loads the updated skill content. Skills saved in the current session are not active until the next session.

### Step 4 — End-to-end verify

\`\`\`bash
# Store a string value
ocas put @ocas/string '"hello world"'

# Get it back using the returned hash
ocas get <hash>
\`\`\`

If \`ocas get\` returns \`"hello world"\`, the setup is working.

## Scenario B: Upgrade from Previous Version

### Step 1 — Update to latest

\`\`\`bash
# Using pnpm
pnpm add -g @ocas/cli@latest

# Using npm
npm install -g @ocas/cli@latest
\`\`\`

### Step 2 — Verify version

\`\`\`bash
ocas --version   # should print ${CLI_VERSION}
\`\`\`

### Step 3 — Regenerate skill

Skill content is bundled with the CLI — always regenerate after upgrading:

\`\`\`bash
ocas prompt usage   # → update skill "ocas"
\`\`\`

Update the \`version\` field in the skill frontmatter to match the new CLI version.

**⚠ After updating the skill, start a new session** to load the new skill content.

### Step 4 — Verify

\`\`\`bash
ocas put @ocas/string '"upgrade test"'
ocas get <hash>
\`\`\`

## Available prompts

\`\`\`bash
ocas prompt list       # list available prompt names
ocas prompt usage      # CLI usage guide (skill body)
ocas prompt bootstrap  # this guide
\`\`\`
`;
}
