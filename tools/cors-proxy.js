'use strict';
/* PixelTriks CORS proxy — forwards AI Bridge requests that browsers block.
   Node stdlib only, no dependencies.

   Run:   node tools/cors-proxy.js  [port]      (default 8787)
   Use:   prefix the AI Bridge URL with  http://localhost:8787/?url=
          e.g.  http://localhost:8787/?url=https://api.pixellab.ai/v2/generate-image-pixflux

   Forwards: method, body, Content-Type, Authorization, Accept.
   Adds permissive CORS headers to the response. Local use only —
   do not expose this port to the internet. */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.argv[2]) || 8787;
const FORWARD_HEADERS = ['content-type', 'authorization', 'accept', 'x-api-key'];

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Api-Key');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  let target;
  try {
    const u = new URL(req.url, 'http://localhost');
    target = new URL(u.searchParams.get('url') || '');
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('bad protocol');
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Usage: /?url=https://api.example.com/endpoint');
    return;
  }

  const headers = {};
  for (const h of FORWARD_HEADERS) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }

  const lib = target.protocol === 'https:' ? https : http;
  const upstream = lib.request(target, { method: req.method, headers }, up => {
    res.writeHead(up.statusCode || 502, {
      'Content-Type': up.headers['content-type'] || 'application/octet-stream'
    });
    up.pipe(res);
  });
  upstream.on('error', err => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Upstream error: ' + err.message);
  });
  req.pipe(upstream);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('PixelTriks proxy listening on http://localhost:' + PORT);
  console.log('In the AI Bridge, prefix URLs with: http://localhost:' + PORT + '/?url=');
});
