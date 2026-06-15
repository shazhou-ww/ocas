---
id: bundle-tar-format
title: "Bundle Export/Import with Minimal Tar and Topological Import"
sources:
  - packages/core/src/bundle.ts
tags: [core, bundle]
created: 2026-06-15
updated: 2026-06-15
---

# Bundle Export/Import

## Custom Minimal Tar

The bundle format uses a custom minimal POSIX tar packer/unpacker — no external dependencies. This keeps @ocas/core dependency-free.

## Export

Uses the four-phase closure computation to collect all needed nodes, variables, and tags, then packs them into a tar archive with a predictable directory structure.

## Topological Import

Import uses a convergence loop: in each iteration, it imports nodes whose type is already present in the store (or self-referencing). This naturally handles the dependency order:
1. Meta-schema (self-referencing) → imported first
2. Schema nodes (type = meta-schema) → imported second
3. Data nodes (type = various schemas) → imported last

No explicit topological sort needed — the convergence loop discovers the order automatically.
