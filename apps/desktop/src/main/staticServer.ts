import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export interface StaticServer {
  server: http.Server;
  port: number;
  url: string;
  origin: string;
  close: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Resolves candidate directories for packaged or compiled Next.js static export.
 */
export function resolveRendererOutDir(): string | null {
  const candidates = [
    // Packaged resource path
    ...(process.resourcesPath
      ? [
          path.join(process.resourcesPath, 'renderer', 'out'),
          path.join(process.resourcesPath, 'out'),
          path.join(process.resourcesPath, 'app', 'apps', 'renderer', 'out'),
        ]
      : []),
    // Staged packaging directory
    path.resolve(__dirname, '../../../../.packaging/renderer/out'),
    // Monorepo relative from dist/main/
    path.resolve(__dirname, '../../../renderer/out'),
    path.resolve(__dirname, '../../../../apps/renderer/out'),
    // Process cwd
    path.resolve(process.cwd(), 'apps/renderer/out'),
    path.resolve(process.cwd(), 'renderer/out'),
    path.resolve(process.cwd(), 'out'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }

  return null;
}

/**
 * Starts an internal, loopback-only HTTP server to serve static renderer assets.
 * Listens strictly on 127.0.0.1 on an ephemeral port.
 */
export async function startRendererServer(outDir: string): Promise<StaticServer> {
  const normalizedOutDir = path.resolve(outDir);

  const server = http.createServer((req, res) => {
    // Only accept safe read requests
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    try {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(parsedUrl.pathname);

      if (pathname === '/') {
        pathname = '/index.html';
      }

      // Security check: ensure normalized target is strictly within outDir
      let filePath = path.normalize(path.join(normalizedOutDir, pathname));
      if (!filePath.startsWith(normalizedOutDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      // Check directory vs file
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        const potentialIndex = path.join(filePath, 'index.html');
        if (fs.existsSync(potentialIndex)) {
          filePath = potentialIndex;
        }
      } else if (!fs.existsSync(filePath)) {
        if (fs.existsSync(`${filePath}.html`)) {
          filePath = `${filePath}.html`;
        } else {
          // SPA fallback to root index.html
          filePath = path.join(normalizedOutDir, 'index.html');
        }
      }

      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end('Internal Server Error');
      });
      stream.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end('Internal Server Error');
    }
  });

  return new Promise((resolve, reject) => {
    // Listen strictly on loopback (127.0.0.1) on ephemeral port (0)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to obtain server address.'));
        return;
      }
      const port = addr.port;
      const origin = `http://127.0.0.1:${port}`;
      const url = `${origin}/index.html`;

      resolve({
        server,
        port,
        url,
        origin,
        close: () =>
          new Promise<void>((resClose) => {
            server.close(() => resClose());
          }),
      });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}
