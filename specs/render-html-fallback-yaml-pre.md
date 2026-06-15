---
scenario: "[SUPERSEDED by #179] Nodes without HTML templates fell back to YAML in <pre><code>"
feature: render
tags: [render, html, fallback, superseded]
---

## Given

- This spec described the pre-#179 behavior where HTML fallback wrapped YAML in `<pre><code>` tags
- **Superseded by:** `render-html-fallback-structured-object.md` and related structured HTML fallback specs

## When

- N/A — this behavior is replaced by structured HTML rendering (issue #179)

## Then

- The old `<pre><code>` YAML wrapping is no longer used for HTML fallback
- See `render-html-fallback-structured-*.md` specs for the new behavior
