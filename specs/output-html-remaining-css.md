---
scenario: "Shared CSS adds stats-grid, history, and list-card rules for remaining templates"
feature: render
tags: [output, html, template, beautify, css]
---

## Given

- A store with bootstrap + `registerOutputTemplates` completed

## When

- The shared OUTPUT_CSS string is checked (via any schema's static template)

## Then

- CSS includes `.ocas-stats-grid` with:
  - `display: grid; grid-template-columns: repeat(2, 1fr)` (2-column grid)
  - Appropriate gap between grid items
- CSS includes `.ocas-stat-value` with:
  - `font-size: var(--ocas-metric-size)` (1.75rem per design tokens)
  - `font-weight: 600` (bold)
  - `font-variant-numeric: tabular-nums` (aligned numbers)
- CSS includes `.ocas-stat-label` with:
  - `color: var(--ocas-text-muted)` (gray label)
- CSS includes `.ocas-success` class for semantic green highlighting
- CSS includes `.ocas-zero` class for muted zero values
- All new CSS rules use `ocas-` namespace prefix
- All new CSS rules reference CSS custom properties (design tokens), not hardcoded colors
