import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.nyc_output',
  '.git',
]);

const TS_FILE_REGEX = /\.(ts|tsx|mts|cts)$/;
const D_TS_FILE_REGEX = /\.d\.(ts|mts|cts)$/;

/**
 * Recursively check if a directory contains any TypeScript source files.
 * @param {string} dir
 * @returns {boolean}
 */
function hasTypeScriptSourceFiles(dir) {
  if (!fs.existsSync(dir)) return false;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        if (hasTypeScriptSourceFiles(path.join(dir, entry.name))) {
          return true;
        }
      }
    } else if (entry.isFile()) {
      if (TS_FILE_REGEX.test(entry.name) && !D_TS_FILE_REGEX.test(entry.name)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Discover all workspace packages with package.json under specified roots.
 * @returns {Array<{ name: string, dir: string, hasTypecheckScript: boolean }>}
 */
function discoverWorkspacePackages() {
  const workspaceRoots = ['apps', 'packages'];
  const packages = [];

  for (const root of workspaceRoots) {
    const fullRootPath = path.join(rootDir, root);
    if (!fs.existsSync(fullRootPath)) continue;

    const entries = fs.readdirSync(fullRootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgDir = path.join(fullRootPath, entry.name);
      const pkgJsonPath = path.join(pkgDir, 'package.json');

      if (fs.existsSync(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
          packages.push({
            name: pkgJson.name || path.relative(rootDir, pkgDir),
            dir: pkgDir,
            hasTypecheckScript: Boolean(pkgJson.scripts?.typecheck),
          });
        } catch (err) {
          console.warn(`[WARN] Failed to parse ${pkgJsonPath}:`, err.message);
        }
      }
    }
  }

  // Sort deterministically by name
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

function run() {
  console.log('ClipVault — Workspace Type Check Runner\n');

  const packages = discoverWorkspacePackages();
  let hasFailures = false;
  let checkedCount = 0;
  let skippedCount = 0;

  for (const pkg of packages) {
    if (!pkg.hasTypecheckScript) {
      console.log(`[SKIP] ${pkg.name}: No "typecheck" script declared in package.json`);
      skippedCount++;
      continue;
    }

    const hasSources = hasTypeScriptSourceFiles(pkg.dir);
    if (!hasSources) {
      console.log(`[SKIP] ${pkg.name}: No TypeScript source files found (scaffold only)`);
      skippedCount++;
      continue;
    }

    console.log(`[CHECK] ${pkg.name}: Running typecheck...`);
    const result = spawnSync('pnpm', ['run', 'typecheck'], {
      cwd: pkg.dir,
      stdio: 'inherit',
      shell: true,
    });

    if (result.status === 0) {
      console.log(`[PASS] ${pkg.name}: Type check succeeded\n`);
      checkedCount++;
    } else {
      console.error(`[FAIL] ${pkg.name}: Type check failed with exit code ${result.status}\n`);
      hasFailures = true;
      checkedCount++;
    }
  }

  console.log(
    `\nTypecheck summary: ${checkedCount} checked, ${skippedCount} skipped, ${hasFailures ? 'FAILURES DETECTED' : 'all checks passed or safely skipped'}.`,
  );

  if (hasFailures) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run();
