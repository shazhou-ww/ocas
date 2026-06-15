---
scenario: "OUTPUT_CSS includes design-guide-compliant table styles with design tokens"
feature: render
tags: [output, html, template, css, table, beautify]
---

## Given

- The `OUTPUT_CSS` constant in `output-templates.ts` is the shared CSS for all output HTML templates
- The design guide (`cards/html-output-design-guide.md`) specifies table styling conventions

## When

- `registerOutputTemplates(store)` registers shared CSS via static templates
- A table-type output envelope is rendered as HTML

## Then

- `OUTPUT_CSS` includes styles for `.ocas-table`:
  - `border-collapse: collapse; width: 100%`
  - `th`: uppercase, small font-size, muted color (`var(--ocas-text-muted)`), `letter-spacing: 0.05em`
  - `td`: left-aligned, padded (`0.4rem 0.75rem`), bottom border using `var(--ocas-card-border)`
  - Last row (`tr:last-child td`): no bottom border
- Includes `.ocas-col-name` style: `font-weight: 500`
- Includes `.ocas-col-time` style: `color: var(--ocas-text-muted); font-variant-numeric: tabular-nums`
- All color values use CSS custom properties from design tokens (not hardcoded hex)
- The rendered HTML document contains a `<style>` block with these rules injected via static templates
