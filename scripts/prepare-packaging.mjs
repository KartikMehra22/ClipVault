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

// Copy contracts dist
const stagedContractsDist = path.join(stagingDir, 'packages', 'contracts', 'dist');
fs.mkdirSync(path.dirname(stagedContractsDist), { recursive: true });
fs.cpSync(contractsDist, stagedContractsDist, { recursive: true });

// Copy database dist
const stagedDbDist = path.join(stagingDir, 'packages', 'database', 'dist');
fs.mkdirSync(path.dirname(stagedDbDist), { recursive: true });
fs.cpSync(databaseDist, stagedDbDist, { recursive: true });
console.log('  ↳ Contracts and Database libraries staged');

console.log('\n=== ClipOrbit Packaging Preparation Complete! ===');
console.log('All static assets, database migrations, and compiled binaries staged in .packaging/');
