import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const root = process.argv[2];
const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.ttf': 'font/ttf' };
http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/' || !extname(p)) p = '/index.html';
  try {
    const data = await readFile(join(root, p === '/' ? 'index.html' : p));
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(data);
  } catch {
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(await readFile(join(root, 'index.html')));
  }
}).listen(Number(process.argv[3] ?? 8099), () => console.log('serving'));
