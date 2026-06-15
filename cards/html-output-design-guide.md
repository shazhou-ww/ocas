---
id: html-output-design-guide
title: "HTML Output Template Design Guide — Tokens, Patterns, and Conventions"
sources:
  - packages/core/src/output-templates.ts
  - packages/core/src/render.ts
tags: [design, html, templates, css]
created: 2026-06-15
updated: 2026-06-15
---

# HTML Output Template Design Guide

Defines the visual language for all `@ocas/output/*` HTML templates. Every output
template MUST follow these tokens and patterns to ensure a consistent look.

## Design Tokens (CSS Custom Properties)

```css
:root {
  /* Typography */
  --ocas-font: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --ocas-mono: ui-monospace, 'SF Mono', 'Cascadia Code', monospace;

  /* Page */
  --ocas-bg: #fafafa;

  /* Card */
  --ocas-card-bg: #fff;
  --ocas-card-border: #e5e7eb;
  --ocas-card-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --ocas-card-radius: 8px;

  /* Text */
  --ocas-text: #1f2937;
  --ocas-text-muted: #6b7280;

  /* Semantic Colors */
  --ocas-green: #16a34a;
  --ocas-red: #dc2626;
  --ocas-yellow: #d97706;

  /* Hash/Code Styling */
  --ocas-hash-bg: #f3f4f6;
  --ocas-hash-text: #374151;

  /* Stats */
  --ocas-metric-size: 1.75rem;
}
```

## Compose Template (Document Shell)

The compose template wraps all output in a centered page with a title:

- `<div class="ocas-page">` — `max-width: 48rem; margin: 0 auto;`
- Title: `<span class="ocas-logo">OCAS</span> Render Output`
  - Logo: monospace white-on-dark badge (`background: #1f2937; color: #fff; border-radius: 4px`)
- CSS variables injected via `<style>` in `<head>` from type_statics

## Component Patterns

### Card Container

Every output type wraps in a card:

```html
<div class="ocas-card">
  <div class="ocas-card-header">Human-Readable Title</div>
  <!-- content -->
</div>
```

Card header uses **human-readable labels**, not CLI command names:
- `gc` → "Garbage Collection"
- `put` → "Stored"
- `get` → "Node Detail"
- `verify` → "Verify"
- `var-list` → "Variables · N entries"
- `list` → "Nodes · @type/name · N entries"
- `export` → "Export Summary"
- `import` → "Import Summary"
- `var-history` → "Variable History"

### Hash Display

All 13-char CAS hashes use:

```html
<code class="ocas-hash">9S7JEYS3FKSDH</code>
```

Monospace, gray background pill, `word-break: break-all`.

### Stats Grid (gc, export, import)

2×2 or 2×N grid with large numbers + muted labels:

```html
<div class="ocas-stats-grid">
  <div class="ocas-stat">
    <span class="ocas-stat-value">32</span>
    <span class="ocas-stat-label">total nodes</span>
  </div>
</div>
```

- Use human labels: "total nodes" not "total", "variables" not "vars"
- `collected: 0` → add `ocas-success` class (green = good)
- Stats `font-variant-numeric: tabular-nums` for alignment

### Status Badge (verify)

```html
<span class="ocas-badge ocas-badge-ok">✓ ok</span>
<span class="ocas-badge ocas-badge-error">✗ corrupted</span>
<span class="ocas-badge ocas-badge-warn">⚠ invalid</span>
```

Pill-shaped: `border-radius: 9999px`, colored background.

### Table (list, var-list, template-list, tag, untag)

```html
<table class="ocas-table">
  <thead><tr><th>column</th></tr></thead>
  <tbody><tr><td>value</td></tr></tbody>
</table>
```

- Header: uppercase, small, muted, `letter-spacing: 0.05em`
- Name columns: `class="ocas-col-name"` (font-weight: 500)
- Time columns: `class="ocas-col-time"` (muted, tabular-nums)
- Last row: no bottom border
- Empty value: `—` in muted color

### Key-Value (get, var-set, var-get, var-delete, template-set)

```html
<dl class="ocas-dl">
  <dt>label</dt>
  <dd>value</dd>
</dl>
```

CSS Grid: `grid-template-columns: auto 1fr`, labels muted.

### Tag Pills

```html
<span class="ocas-tag">env:prod</span>
```

Blue (`#eff6ff` bg, `#2563eb` text), small, pill-shaped.

### Var History

Meta (name + schema) as `<dl>`, then `<ol start="0">`:
- Index 0: `← current` label
- Older entries: reduced opacity (`0.7`)

## Readability Conventions

1. **Human-readable labels** — "total nodes" not "total", "Garbage Collection" not "gc"
2. **Count in header** — tables show "Variables · 3 entries", not just "Variables"
3. **Time formatting** — display as `YYYY-MM-DD HH:MM`, not raw epoch
4. **Empty values** — show `—` (em dash) in muted color, never blank
5. **Current marker** — var-history index 0 gets `← current`
6. **Semantic color** — green for success/zero-collected, red for error, yellow for warning
7. **Hash consistency** — all hashes always use `<code class="ocas-hash">`, never bare text

## CSS Class Namespace

All classes prefixed with `ocas-` to avoid conflicts. Key classes:

| Class | Purpose |
|-------|---------|
| `.ocas-page` | Centered page container |
| `.ocas-page-title` | Title with logo |
| `.ocas-logo` | OCAS logo badge |
| `.ocas-card` | Card container |
| `.ocas-card-header` | Card section title |
| `.ocas-hash` | Hash/code display |
| `.ocas-table` | Data table |
| `.ocas-col-name` | Name column (bold) |
| `.ocas-col-time` | Timestamp column (muted) |
| `.ocas-dl` | Key-value grid |
| `.ocas-stats-grid` | Stats 2×N grid |
| `.ocas-stat` | Single stat block |
| `.ocas-stat-value` | Large metric number |
| `.ocas-stat-label` | Metric label |
| `.ocas-badge` | Status pill badge |
| `.ocas-badge-ok/error/warn` | Badge color variants |
| `.ocas-tag` | Tag/label pill |
| `.ocas-success` | Green highlight |
| `.ocas-zero` | Muted zero value |
