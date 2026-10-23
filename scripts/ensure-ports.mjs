#!/usr/bin/env node

/**
 * DevDesk - Port Availability & Force-Kill Utility
 *
 * Inspects required development ports (default: 3000 for Frontend, 5001 for Backend).
 * If any port is occupied by a lingering, stale, or conflicting process,
 * it force-kills the process and its process tree, ensuring the ports are immediately available.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Parse ports from command line arguments or use default DevDesk ports
const args = process.argv.slice(2);
const targetPorts =
  args.length > 0
    ? args.map((p) => parseInt(p, 10)).filter((p) => !isNaN(p) && p > 0)
    : [3000, 5001];

console.log(`[DevDesk] Inspecting required ports: ${targetPorts.join(', ')}...`);

function getParentPid(pid) {
  try {
    if (process.platform === 'win32') return null;
    const ppidStr = execSync(`ps -p ${pid} -o ppid=`, { encoding: 'utf-8' }).trim();
    const ppid = parseInt(ppidStr, 10);
    return !isNaN(ppid) && ppid > 1 ? ppid : null;
  } catch {
    return null;
  }
}

function getSelfAndAncestorPids() {
  const pids = new Set();
  pids.add(process.pid);
  let current = process.ppid;
  while (current && current > 1) {
    pids.add(current);
    const parent = getParentPid(current);
    if (!parent || pids.has(parent)) break;
    current = parent;
  }
  return pids;
}

const protectedPids = getSelfAndAncestorPids();

function getPidsListeningOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
      const pids = new Set();
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[1].endsWith(`:${port}`) && parts[3] === 'LISTENING') {
          const pid = parseInt(parts[4], 10);
          if (!isNaN(pid) && pid > 0) pids.add(pid);
        }
      }
      return Array.from(pids);
    } else {
      const output = execSync(`lsof -t -nP -iTCP:${port} -sTCP:LISTEN`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return output
        .split('\n')
        .map((p) => parseInt(p.trim(), 10))
        .filter((p) => !isNaN(p) && p > 0);
    }
  } catch {
    return [];
  }
}

function getProcessInfo(pid) {
  try {
    if (process.platform === 'win32') {
      return `PID ${pid}`;
    }
    const cmd = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf-8' }).trim();
    return cmd || `PID ${pid}`;
  } catch {
    return `PID ${pid}`;
  }
}

function forceKillPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    return true;
  } catch {
    try {
      if (process.platform !== 'win32') {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }
}

function cleanNextDevStaleFiles() {
  const nextDevLog = path.join(rootDir, 'frontend', '.next', 'dev', 'logs', 'next-development.log');
  if (fs.existsSync(nextDevLog)) {
    try {
      fs.unlinkSync(nextDevLog);
    } catch {
      /* ignore */
    }
  }
}

function killStaleFrontendProcesses() {
  try {
    if (process.platform === 'win32') return;
    const output = execSync("pgrep -f 'next-server' || true", { encoding: 'utf-8' }).trim();
    if (output) {
      for (const line of output.split('\n')) {
        const pid = parseInt(line.trim(), 10);
        if (!isNaN(pid) && pid > 1 && !protectedPids.has(pid)) {
          const info = getProcessInfo(pid);
          if (info.includes('next-server') || info.includes('DevDesk')) {
            console.log(`  ⚠ Terminating lingering Next.js daemon (PID: ${pid})...`);
            forceKillPid(pid);
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
}

let anyKilled = false;

// If checking port 3000, ensure any orphaned next-server daemons are cleared
if (targetPorts.includes(3000)) {
  killStaleFrontendProcesses();
  cleanNextDevStaleFiles();
}

for (const port of targetPorts) {
  const pids = getPidsListeningOnPort(port);
  if (pids.length === 0) {
    console.log(`  ✔ Port ${port} is available.`);
    continue;
  }

  for (const pid of pids) {
    if (protectedPids.has(pid)) {
      continue;
    }

    anyKilled = true;
    const info = getProcessInfo(pid);
    const ppid = getParentPid(pid);
    console.log(`  ⚠ Port ${port} is occupied by ${info} (PID: ${pid}). Force killing...`);

    // Force kill child listener
    forceKillPid(pid);

    // If parent process is an orphaned runner (e.g., node next dev), kill it as well
    if (ppid && !protectedPids.has(ppid)) {
      const parentInfo = getProcessInfo(ppid);
      if (
        parentInfo.includes('next') ||
        parentInfo.includes('tsx') ||
        parentInfo.includes('DevDesk') ||
        parentInfo.includes('pnpm') ||
        parentInfo.includes('npm')
      ) {
        console.log(`    ↳ Also killing parent runner process: ${parentInfo} (PID: ${ppid})...`);
        forceKillPid(ppid);
      }
    }
  }

  // Verify port is released
  let released = false;
  for (let i = 0; i < 15; i++) {
    execSync('sleep 0.1', { stdio: 'ignore' });
    const remaining = getPidsListeningOnPort(port).filter((p) => !protectedPids.has(p));
    if (remaining.length === 0) {
      released = true;
      break;
    }
  }

  if (released) {
    console.log(`  ✔ Port ${port} successfully freed.`);
  } else {
    console.warn(`  ⚠ Port ${port} may still have lingering connections.`);
  }
}

if (anyKilled) {
  console.log('[DevDesk] All conflicting processes terminated. Ports are ready.\n');
} else {
  console.log('[DevDesk] All required ports are free.\n');
}

process.exit(0);
