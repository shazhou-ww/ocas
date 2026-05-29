#!/usr/bin/env node

/**
 * Publish all non-private packages in the monorepo to npm.
 *
 * Usage:
 *   node scripts/publish-all.mjs [--dry-run] [--tag <name>]
 *
 * Resolves workspace dependencies and publishes in correct order.
 * Uses --ignore-scripts to bypass prepublishOnly guardrails.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const PACKAGES_DIR = 'packages';

/**
 * @typedef {{
 *   name: string;
 *   version: string;
 *   private?: boolean;
 *   dependencies?: Record<string, string>;
 *   devDependencies?: Record<string, string>;
 * }} PackageJson
 */

/**
 * @typedef {{
 *   path: string;
 *   name: string;
 *   version: string;
 *   pkg: PackageJson;
 * }} Package
 */

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const tagIndex = args.indexOf('--tag');
  const tag = tagIndex !== -1 ? args[tagIndex + 1] : undefined;

  console.log('🔍 Scanning packages...');
  const packages = await scanPackages();

  console.log(`📦 Found ${packages.length} publishable package(s)`);

  const order = resolvePublishOrder(packages);
  console.log(`📋 Publish order: ${order.map(p => p.name).join(' → ')}`);

  for (const pkg of order) {
    await publishPackage(pkg, { dryRun, tag });
  }

  console.log('✅ All packages processed');
}

/**
 * Scan packages directory for non-private packages
 * @returns {Promise<Package[]>}
 */
async function scanPackages() {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pkgPath = join(PACKAGES_DIR, entry.name, 'package.json');
    let content;
    try {
      content = await readFile(pkgPath, 'utf-8');
    } catch {
      continue; // no package.json
    }

    const pkg = JSON.parse(content);
    if (pkg.private) continue;

    packages.push({
      path: join(PACKAGES_DIR, entry.name),
      name: pkg.name,
      version: pkg.version,
      pkg,
    });
  }

  return packages;
}

/**
 * Resolve publish order based on workspace dependencies
 * @param {Package[]} packages
 * @returns {Package[]}
 */
function resolvePublishOrder(packages) {
  const pkgMap = new Map(packages.map(p => [p.name, p]));
  const order = [];
  const visited = new Set();

  function visit(pkg) {
    if (visited.has(pkg.name)) return;
    visited.add(pkg.name);

    // Visit dependencies first
    const deps = { ...pkg.pkg.dependencies, ...pkg.pkg.devDependencies };
    for (const [depName, depVersion] of Object.entries(deps)) {
      if (depVersion?.startsWith('workspace:')) {
        const depPkg = pkgMap.get(depName);
        if (depPkg) visit(depPkg);
      }
    }

    order.push(pkg);
  }

  for (const pkg of packages) {
    visit(pkg);
  }

  return order;
}

/**
 * Publish a single package
 * @param {Package} pkg
 * @param {{ dryRun: boolean; tag?: string }} options
 */
async function publishPackage(pkg, { dryRun, tag }) {
  console.log(`\n📤 ${dryRun ? '[DRY RUN] ' : ''}Publishing ${pkg.name}@${pkg.version}`);

  const pkgJsonPath = join(pkg.path, 'package.json');
  const originalContent = await readFile(pkgJsonPath, 'utf-8');
  const originalPkg = JSON.parse(originalContent);

  try {
    // Replace workspace: protocol with actual versions
    const modified = await replaceWorkspaceDeps(pkg.path, originalPkg);

    // Publish
    const tagArg = tag ? `--tag ${tag}` : '';
    const cmd = `npm publish --access public --ignore-scripts ${tagArg}`.trim();

    if (dryRun) {
      console.log(`  Would run: ${cmd}`);
      console.log(`  Modified dependencies:`, modified);
    } else {
      try {
        execSync(cmd, { cwd: pkg.path, stdio: 'inherit' });
        console.log(`  ✅ Published ${pkg.name}@${pkg.version}`);
      } catch (error) {
        console.error(`  ❌ Failed to publish ${pkg.name}:`, error.message);
        throw error;
      }
    }
  } finally {
    // Restore original package.json
    await writeFile(pkgJsonPath, originalContent);
  }
}

/**
 * Replace workspace: dependencies with actual versions
 * @param {string} pkgPath
 * @param {PackageJson} pkg
 * @returns {Promise<Record<string, string>>}
 */
async function replaceWorkspaceDeps(pkgPath, pkg) {
  const modified = {};

  for (const depType of ['dependencies', 'devDependencies']) {
    const deps = pkg[depType];
    if (!deps) continue;

    for (const [depName, depVersion] of Object.entries(deps)) {
      if (typeof depVersion === 'string' && depVersion.startsWith('workspace:')) {
        // Find the actual version from the workspace package
        const depPkgPath = join(PACKAGES_DIR, depName.split('/').pop(), 'package.json');
        let actualVersion;
        try {
          const depContent = await readFile(depPkgPath, 'utf-8');
          const depPkg = JSON.parse(depContent);
          actualVersion = depPkg.version;
        } catch {
          // If can't find, use the version hint after workspace:
          actualVersion = depVersion.replace(/^workspace:/, '');
        }

        deps[depName] = actualVersion;
        modified[depName] = actualVersion;
      }
    }
  }

  // Write modified package.json
  const pkgJsonPath = join(pkgPath, 'package.json');
  await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');

  return modified;
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
