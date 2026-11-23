/* ============================================================
   VAGEL — static dev server (Node, tanpa dependency)
   Jalankan: npm start   →   http://0.0.0.0:8080
   Kenapa bukan `python3 -m http.server`?
     · MIME .webmanifest benar (application/manifest+json)
     · header cache diatur (sw.js & html selalu fresh)
     · async, jadi banyak request paralel nggak saling nunggu
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  // mic wajib diizinkan, termasuk saat app ditampilkan di dalam iframe preview
  'Permissions-Policy': 'microphone=(self *), camera=()',
  'Access-Control-Allow-Origin': '*',
};

function send(res, code, body, extra = {}) {
  res.writeHead(code, { ...BASE_HEADERS, ...extra });
  res.end(body);
}

function notFound(res) {
  send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed', {
      'Content-Type': 'text/plain; charset=utf-8',
      Allow: 'GET, HEAD',
    });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  if (pathname.endsWith('/')) pathname += 'index.html';

  // cegah path traversal
  const filePath = path.join(ROOT, path.normalize(pathname));
  if (!filePath.startsWith(ROOT)) return notFound(res);

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return notFound(res);

    const ext = path.extname(filePath).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    const base = path.basename(filePath);
    const noStore = base === 'sw.js' || ext === '.html';

    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': noStore ? 'no-store, must-revalidate' : 'public, max-age=3600',
    });

    if (req.method === 'HEAD') return res.end();

    fs.createReadStream(filePath)
      .on('error', () => res.destroy())
      .pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} sudah dipakai. Matikan proses lain dulu, atau: PORT=8081 npm start`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`VAGEL voice lab → http://${HOST}:${PORT}`);
});

/* matikan dengan rapi */
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} diterima, server ditutup.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}
