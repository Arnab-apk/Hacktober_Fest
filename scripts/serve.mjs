import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skippy_paradox/frontend/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/workspace-api/')) {
    const proxy = http.request({ hostname: '127.0.0.1', port: req.url.startsWith('/workspace-api/') ? 4100 : 8100, path: req.url, method: req.method,
      headers: { ...req.headers, 'x-forwarded-host': req.headers.host } }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
    proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('API unavailable'); });
    req.on('aborted', () => proxy.destroy());
    res.on('close', () => proxy.destroy());
    req.pipe(proxy); return;
  }
  let filename;
  try { filename = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
  catch { res.writeHead(400); res.end(); return; }
  if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.join(root, 'index.html');
  if (!fs.existsSync(filename)) { res.writeHead(503); res.end('Run npm run build first.'); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(filename).pipe(res);
});
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/collab-ws/')) { socket.destroy(); return; }
  const proxy = http.request({ hostname: '127.0.0.1', port: 4100, path: req.url.replace('/collab-ws', ''), headers: req.headers });
  proxy.on('upgrade', (response, upstream, upstreamHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` + Object.entries(response.headers).map(([k, v]) => `${k}: ${v}\r\n`).join('') + '\r\n');
    if (head.length) upstream.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    socket.pipe(upstream).pipe(socket);
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  });
  proxy.on('error', () => socket.destroy()); proxy.end();
});
server.listen(3100, '0.0.0.0', () => console.log('Skippy IDE ready at http://localhost:3100'));
