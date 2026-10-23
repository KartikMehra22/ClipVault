import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

console.log('=== DevDesk Packaging Preparation ===');
console.log('Root directory:', rootDir);

// 0. Install workspace dependencies
console.log('\n[0/5] Syncing workspace dependencies...');
execSync('pnpm install -y --config.confirmModulesPurge=false', { cwd: rootDir, stdio: 'inherit' });

// 1. Build Frontend static export
console.log('\n[1/5] Building Frontend static export (Next.js)...');
execSync('pnpm --filter frontend run build', { cwd: rootDir, stdio: 'inherit' });

const frontendOut = path.join(rootDir, 'frontend/out');
if (!fs.existsSync(frontendOut)) {
  console.error('ERROR: frontend/out was not created.');
  process.exit(1);
}
console.log('✓ Frontend static export verified in frontend/out');

// 2. Build Backend TypeScript
console.log('\n[2/5] Building Backend (TypeScript)...');
execSync('pnpm --filter backend run build', { cwd: rootDir, stdio: 'inherit' });

const backendDist = path.join(rootDir, 'backend/dist');
if (!fs.existsSync(backendDist)) {
  console.error('ERROR: backend/dist was not created.');
  process.exit(1);
}
console.log('✓ Backend compiled in backend/dist');

// 3. Build Desktop Electron TypeScript
console.log('\n[3/5] Building Desktop (TypeScript)...');
execSync('pnpm --filter desktop run build', { cwd: rootDir, stdio: 'inherit' });

const desktopDist = path.join(rootDir, 'desktop/dist');
if (!fs.existsSync(desktopDist)) {
  console.error('ERROR: desktop/dist was not created.');
  process.exit(1);
}
console.log('✓ Desktop compiled in desktop/dist');

// 4. Deploy standalone Backend to .packaging/backend
console.log('\n[4/5] Preparing standalone production backend...');
const backendDeployDir = path.join(rootDir, '.packaging/backend');
if (fs.existsSync(backendDeployDir)) {
  fs.rmSync(backendDeployDir, { recursive: true, force: true });
}
fs.mkdirSync(backendDeployDir, { recursive: true });

execSync(
  `pnpm --filter=backend deploy "${backendDeployDir}" --prod --legacy --node-linker=hoisted`,
  {
    cwd: rootDir,
    stdio: 'inherit',
  },
);

// Copy compiled backend dist files into deploy dir
const deployDistDir = path.join(backendDeployDir, 'dist');
fs.cpSync(backendDist, deployDistDir, { recursive: true });
console.log('✓ Standalone production backend deployed to .packaging/backend');

// 5. Ensure application icon
console.log('\n[5/5] Checking macOS application icon...');
const iconPath = path.join(rootDir, 'desktop/build-resources/icon.icns');
if (!fs.existsSync(iconPath)) {
  console.log('Generating icon.icns from favicon.ico...');
  const tempIconset = '/tmp/devdesk_icon.iconset';
  const tempPng = '/tmp/devdesk_icon_256.png';
  fs.mkdirSync(tempIconset, { recursive: true });
  execSync(
    `sips -s format png "${path.join(rootDir, 'frontend/src/app/favicon.ico')}" --out "${tempPng}"`,
    { stdio: 'ignore' },
  );
  execSync(`sips -z 16 16 "${tempPng}" --out "${tempIconset}/icon_16x16.png"`, { stdio: 'ignore' });
  execSync(`sips -z 32 32 "${tempPng}" --out "${tempIconset}/icon_16x16@2x.png"`, {
    stdio: 'ignore',
  });
  execSync(`sips -z 32 32 "${tempPng}" --out "${tempIconset}/icon_32x32.png"`, { stdio: 'ignore' });
  execSync(`sips -z 64 64 "${tempPng}" --out "${tempIconset}/icon_32x32@2x.png"`, {
    stdio: 'ignore',
  });
  execSync(`sips -z 128 128 "${tempPng}" --out "${tempIconset}/icon_128x128.png"`, {
    stdio: 'ignore',
  });
  execSync(`sips -z 256 256 "${tempPng}" --out "${tempIconset}/icon_128x128@2x.png"`, {
    stdio: 'ignore',
  });
  execSync(`sips -z 256 256 "${tempPng}" --out "${tempIconset}/icon_256x256.png"`, {
    stdio: 'ignore',
  });
  execSync(`iconutil -c icns "${tempIconset}" -o "${iconPath}"`, { stdio: 'ignore' });
  fs.rmSync(tempIconset, { recursive: true, force: true });
  fs.rmSync(tempPng, { force: true });
}
console.log('✓ macOS icon verified at desktop/build-resources/icon.icns');

console.log('\n=== Preparation Complete! Ready for electron-builder ===');
