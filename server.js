// Local dev server: serves /public and forwards /api/* to the same handler Vercel runs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from './api/index.js';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'DELETE') { let raw = ''; for await (const c of req) raw += c; req.body = raw; }
    return handler(req, res);
  }
  const file = path.join(PUB, pathname === '/' ? 'index.html' : path.normalize(pathname));
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log(`WatchLog running at http://localhost:${process.env.PORT || 3000}`));
