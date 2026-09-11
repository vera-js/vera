/**
 * The stream lab's live half — run `node examples/directives/stream-server.mjs` from the repo
 * root, then open http://localhost:5179/examples/directives/stream-lab.html
 *
 * Three endpoints, zero dependencies:
 * - static files from the repo root (the lab page and the built packages)
 * - `/live` — server-sent events: a JSON price tick every second, and a `story` markup push
 *   every five, on the same connection (named events are the demo)
 * - `/ws`   — a WebSocket that echoes every message back as a state patch, hand-rolled on
 *   node's crypto (a lab does not need the ws package)
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

let viewers = 0;
const STORIES = [
  '<h3 style="margin:0 0 0.3rem">Pushed at %T</h3><p style="margin:0">This panel arrived over the SSE wire as a named <code>story</code> event — and it is live markup, not text.</p>',
  '<h3 style="margin:0 0 0.3rem">Another push, %T</h3><p style="margin:0">Watch the crossfade: <code>animate: true</code> rides the same flip door as everything else.</p>',
];
let storyIndex = 0;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/live') {
    viewers++;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    const tick = setInterval(() => {
      const price = (100 + Math.sin(Date.now() / 3000) * 8 + Math.random() * 2).toFixed(2);
      res.write(`data: {"price": ${price}, "viewers": ${viewers}}\n\n`);
    }, 1000);
    const story = setInterval(() => {
      const html = STORIES[storyIndex++ % STORIES.length].replaceAll('%T', new Date().toLocaleTimeString());
      res.write(`event: story\ndata: ${html}\n\n`);
    }, 5000);
    req.on('close', () => { viewers--; clearInterval(tick); clearInterval(story); });
    return;
  }

  /** Static: repo files, path-safe. */
  const safe = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, safe));
    res.writeHead(200, { 'content-type': TYPES[extname(safe)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

/** The WebSocket handshake + minimal text frames — enough for an echo lab. */
server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
  const accept = createHash('sha1')
    .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);

  const send = (text) => {
    const payload = Buffer.from(text);
    const head = payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.concat([Buffer.from([0x81, 126]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(payload.length); return b; })()]);
    socket.write(Buffer.concat([head, payload]));
  };

  socket.on('data', (chunk) => {
    const opcode = chunk[0] & 0x0f;
    if (opcode === 8) return socket.end();
    if (opcode !== 1) return;
    let offset = 2;
    let length = chunk[1] & 0x7f;
    if (length === 126) { length = chunk.readUInt16BE(2); offset = 4; }
    const mask = chunk.subarray(offset, offset + 4);
    const data = chunk.subarray(offset + 4, offset + 4 + length).map((byte, i) => byte ^ mask[i % 4]);
    let text = Buffer.from(data).toString();
    try {
      const message = JSON.parse(text);
      /** The echo is a STATE PATCH — the page's reflections do the rest. */
      send(JSON.stringify({ lastEcho: message.say ?? text, echoes: (message.n ?? 0) + 1 }));
    } catch {
      send(JSON.stringify({ lastEcho: text }));
    }
  });
  socket.on('error', () => {});
});

server.listen(5179, () => console.log('stream lab: http://localhost:5179/examples/directives/stream-lab.html'));
