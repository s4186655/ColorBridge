// server.js — tiny static file server for the ColorBridge website.
//
// Fixed port (5500) on purpose: extension/manifest.json's second
// content_scripts block only runs accountSync.js on http://localhost:5500/*,
// so that content script can read this site's localStorage session and tell
// the extension when a "pro" account is signed in. If you change the port,
// update that manifest entry to match.
//
// Deliberately its OWN env var (not PORT): the root start.js runs this file
// in the same process as backend/server.js, whose dotenv load sets
// process.env.PORT=8787 — reusing that name here would make this server try
// to bind 8787 too and crash with EADDRINUSE.
//
// No dependencies — Node's built-in http/fs modules only.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.WEBSITE_PORT || 5500;
const ROOT = __dirname;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`ColorBridge website running at http://localhost:${PORT}`);
});
