import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

console.log('=== ClipOrbit Production Packaging Preparation ===');
console.log('Root directory:', rootDir);

// 0. Verify workspace
console.log('\n[0/5] Checking workspace packages...');
const requiredPackages = [
  'packages/contracts',
  'packages/database',
  'apps/renderer',
  'apps/desktop',
];
for (const pkg of requiredPackages) {
  const pkgJson = path.join(rootDir, pkg, 'package.json');
  if (!fs.existsSync(pkgJson)) {
    console.error(`ERROR: Missing required package: ${pkg}`);
    process.exit(1);
  }
}
console.log('✓ All required workspace packages present.');

// 1. Build Contracts
console.log('\n[1/5] Building Contracts (@cliporbit/contracts)...');
execSync('pnpm --filter @cliporbit/contracts run build', { cwd: rootDir, stdio: 'inherit' });

const contractsDist = path.join(rootDir, 'packages/contracts/dist');
if (!fs.existsSync(contractsDist)) {
  console.error('ERROR: packages/contracts/dist was not created.');
  process.exit(1);
}
console.log('✓ Contracts compiled in packages/contracts/dist');

// 2. Build Database
console.log('\n[2/5] Building Database (@cliporbit/database)...');
execSync('pnpm --filter @cliporbit/database run build', { cwd: rootDir, stdio: 'inherit' });

const databaseDist = path.join(rootDir, 'packages/database/dist');
if (!fs.existsSync(databaseDist)) {
  console.error('ERROR: packages/database/dist was not created.');
  process.exit(1);
}
console.log('✓ Database compiled in packages/database/dist');

// 3. Build Renderer static export
console.log('\n[3/5] Building Renderer static export (Next.js)...');
execSync('pnpm --filter @cliporbit/renderer run build', { cwd: rootDir, stdio: 'inherit' });

const rendererOut = path.join(rootDir, 'apps/renderer/out');
const rendererIndex = path.join(rendererOut, 'index.html');
if (!fs.existsSync(rendererIndex)) {
  console.error('ERROR: apps/renderer/out/index.html was not created.');
  process.exit(1);
}
console.log('✓ Renderer static export verified in apps/renderer/out');

// 4. Build Desktop Electron TypeScript
console.log('\n[4/5] Building Desktop Electron (@cliporbit/desktop)...');
execSync('pnpm --filter @cliporbit/desktop run build', { cwd: rootDir, stdio: 'inherit' });

const desktopDist = path.join(rootDir, 'apps/desktop/dist');
const mainIndex = path.join(desktopDist, 'main/index.js');
const preloadIndex = path.join(desktopDist, 'preload/index.js');
if (!fs.existsSync(mainIndex) || !fs.existsSync(preloadIndex)) {
  console.error('ERROR: Desktop main or preload dist was not created.');
  process.exit(1);
}
console.log('✓ Desktop Electron compiled in apps/desktop/dist');

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 5. Stage production packaging directory (.packaging)
console.log('\n[5/5] Staging production bundle into .packaging...');
const stagingDir = path.join(rootDir, '.packaging');
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

// Copy renderer static export
const stagedRenderer = path.join(stagingDir, 'renderer', 'out');
fs.mkdirSync(path.dirname(stagedRenderer), { recursive: true });
fs.cpSync(rendererOut, stagedRenderer, { recursive: true });
console.log('  ↳ Renderer static assets staged to .packaging/renderer/out');

// Copy Prisma schema and migrations
const stagedPrisma = path.join(stagingDir, 'prisma');
fs.mkdirSync(stagedPrisma, { recursive: true });
fs.copyFileSync(
  path.join(rootDir, 'packages/database/prisma/schema.prisma'),
  path.join(stagedPrisma, 'schema.prisma'),
);
fs.cpSync(
  path.join(rootDir, 'packages/database/prisma/migrations'),
  path.join(stagedPrisma, 'migrations'),
  { recursive: true },
);
console.log('  ↳ Prisma schema and migrations staged to .packaging/prisma');

// Copy compiled desktop dist
const stagedDesktopDist = path.join(stagingDir, 'desktop', 'dist');
fs.mkdirSync(path.dirname(stagedDesktopDist), { recursive: true });
fs.cpSync(desktopDist, stagedDesktopDist, { recursive: true });
console.log('  ↳ Desktop dist staged to .packaging/desktop/dist');

// Stage production package.json (no dependencies so electron-builder skips traversal)
const appPackageJson = {
  name: 'cliporbit',
  productName: 'ClipOrbit',
  version: '0.1.0',
  description: 'Privacy-first, local-first desktop clipboard manager',
  main: 'desktop/dist/main/index.js',
  author: 'ClipOrbit Contributors',
};
fs.writeFileSync(
  path.join(stagingDir, 'package.json'),
  JSON.stringify(appPackageJson, null, 2),
  'utf-8',
);
console.log('  ↳ Application package.json staged');

// Stage standalone runtime modules into .packaging-modules
const stagedModules = path.join(rootDir, '.packaging-modules');
if (fs.existsSync(stagedModules)) {
  fs.rmSync(stagedModules, { recursive: true, force: true });
}
fs.mkdirSync(stagedModules, { recursive: true });

// Copy @cliporbit/contracts
const stagedContracts = path.join(stagedModules, '@cliporbit', 'contracts');
fs.mkdirSync(stagedContracts, { recursive: true });
fs.copyFileSync(
  path.join(rootDir, 'packages/contracts/package.json'),
  path.join(stagedContracts, 'package.json'),
);
fs.cpSync(contractsDist, path.join(stagedContracts, 'dist'), { recursive: true });
console.log('  ↳ @cliporbit/contracts staged to runtime modules');

// Copy @cliporbit/database
const stagedDatabase = path.join(stagedModules, '@cliporbit', 'database');
fs.mkdirSync(stagedDatabase, { recursive: true });
fs.copyFileSync(
  path.join(rootDir, 'packages/database/package.json'),
  path.join(stagedDatabase, 'package.json'),
);
fs.cpSync(databaseDist, path.join(stagedDatabase, 'dist'), { recursive: true });
console.log('  ↳ @cliporbit/database staged to runtime modules');

// Discover and stage full transitive dependency closure for prisma and @prisma/client
const collectedDeps = new Map();

function collectDependenciesFromDir(dir) {
  const nm = path.join(dir, 'node_modules');
  if (!fs.existsSync(nm)) return;
  for (const item of fs.readdirSync(nm)) {
    if (item.startsWith('.')) continue;
    if (item.startsWith('@')) {
      const scopeDir = path.join(nm, item);
      for (const sub of fs.readdirSync(scopeDir)) {
        registerDependency(path.join(scopeDir, sub));
      }
    } else {
      registerDependency(path.join(nm, item));
    }
  }
}

function registerDependency(pkgPath) {
  try {
    const real = fs.realpathSync(pkgPath);
    if (!collectedDeps.has(real) && real.includes('node_modules')) {
      const pkgJsonPath = path.join(real, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        if (pkgJson.name) {
          collectedDeps.set(real, pkgJson.name);
          // Walk up to find parent virtual store directory in .pnpm
          let cur = real;
          while (cur !== path.dirname(cur)) {
            if (path.basename(path.dirname(cur)) === '.pnpm') {
              collectDependenciesFromDir(cur);
              break;
            }
            cur = path.dirname(cur);
          }
        }
      }
    }
  } catch {
    // Ignore packages with missing or unresolvable manifests
  }
}

const prismaPkgPath = path.dirname(
  require.resolve('prisma/package.json', { paths: [path.join(rootDir, 'packages', 'database')] }),
);
const clientPkgPath = path.dirname(
  require.resolve('@prisma/client/package.json', {
    paths: [path.join(rootDir, 'packages', 'database')],
  }),
);

registerDependency(prismaPkgPath);
registerDependency(clientPkgPath);
collectDependenciesFromDir(path.dirname(path.dirname(prismaPkgPath)));
collectDependenciesFromDir(path.dirname(path.dirname(clientPkgPath)));

console.log(`  ↳ Staging ${collectedDeps.size} runtime packages for Prisma engine and CLI...`);
for (const [sourcePath, pkgName] of collectedDeps.entries()) {
  const targetDir = path.join(stagedModules, pkgName);
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourcePath, targetDir, { recursive: true, dereference: true });
}
console.log('  ↳ All Prisma runtime and CLI dependencies staged');

// Stage .prisma client generated code and query engine dylib
const dotPrismaSource = path.join(path.dirname(path.dirname(clientPkgPath)), '.prisma');
if (fs.existsSync(dotPrismaSource)) {
  fs.cpSync(dotPrismaSource, path.join(stagedModules, '.prisma'), {
    recursive: true,
    dereference: true,
  });
  console.log('  ↳ .prisma client engines staged to runtime modules');
}

console.log('\n=== ClipOrbit Packaging Preparation Complete! ===');
console.log('All static assets, database migrations, and runtime node_modules staged.');
