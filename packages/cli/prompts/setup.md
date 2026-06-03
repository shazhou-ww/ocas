# OCAS Skill Setup

You are being asked to install or update the OCAS (Object Content Addressable Store) skill
so that you know how to use the `ocas` CLI.

## Steps

1. **Check if OCAS CLI is installed:**
   ```bash
   ocas --help
   ```
   If not installed: `bun add -g @ocas/cli`

2. **Clean up old versions of the skill** (if any exist):
   - Look for any existing OCAS/ocas skill files in your skill directories
     (e.g. `~/.hermes/skills/ocas/SKILL.md` or similar paths).
   - If a skill exists, read its `version` from the YAML frontmatter.
   - If the version matches the current CLI version (`ocas --version`), you're done — no update needed.
   - If the version is older, **delete the old skill file** before proceeding.

3. **Get the usage skill content:**
   ```bash
   ocas prompt usage
   ```

4. **Create a SKILL.md file** in your skill directory (e.g. `~/.hermes/skills/ocas/SKILL.md`).
   The output of `ocas prompt usage` is the skill body WITHOUT frontmatter.
   You must prepend the following YAML frontmatter:

   ```yaml
   ---
   name: ocas
   description: "Use when storing, retrieving, or managing typed JSON data with OCAS (Object Content Addressable Store). Covers CLI usage, variable management, templates, rendering, and pipe composition."
   version: <VERSION>
   author: OCAS
   license: MIT
   metadata:
     hermes:
       tags: [cas, storage, cli, json, schema, content-addressing]
   ---
   ```

   Replace `<VERSION>` with the installed CLI version (from `ocas --version`).

5. **Verify** the skill is loadable by your agent framework.

## Notes

- The skill content is bundled with the CLI and versioned with it — always use
  `ocas prompt usage` to get the content matching your installed version.
- Do NOT hand-edit the skill body. If the CLI is updated, re-run `ocas prompt setup`
  and follow the steps again.
- When upgrading, always delete the old skill first to avoid stale instructions.
