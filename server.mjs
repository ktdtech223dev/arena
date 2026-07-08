// Production server for RANGE (Railway / any container host).
// 1. Serves the built dist/ over the platform PORT, bound to 0.0.0.0.
// 2. Exposes a tiny progress API backed by a PERSISTENT VOLUME so player
//    progress (settings, crosshairs, best times, unlocks) survives redeploys
//    and is available when RANGE is embedded in N Games.
//
//   GET  /api/health                      -> { ok, dataDir, players }
//   GET  /api/progress?player=<id>        -> stored JSON blob (or {})
//   POST /api/progress?player=<id>  {json} -> { ok:true }   (body <= 256 KB)
//
// Player id: N Games passes ?player=<id> (per-account). Standalone, the client
// generates a local id. Ids are sanitized to a safe filename (no path escape).
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sirv from 'sirv';

const port = Number(process.env.PORT) || 3000;
const host = '0.0.0.0';

// ---- data dir (Railway volume mounts at /data; fall back to ./data locally) ---
function resolveDataDir() {
  const preferred = process.env.DATA_DIR || '/data';
  try {
    mkdirSync(path.join(preferred, 'progress'), { recursive: true });
    return preferred;
  } catch {
    const local = path.join(process.cwd(), 'data');
    mkdirSync(path.join(local, 'progress'), { recursive: true });
    return local;
  }
}
const DATA_DIR = resolveDataDir();
const PROGRESS_DIR = path.join(DATA_DIR, 'progress');
console.log(`[RANGE] data dir: ${DATA_DIR}`);

const MAX_BODY = 256 * 1024; // 256 KB per save

function safeId(raw) {
  const id = String(raw || 'local').slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '');
  return id || 'local';
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  if (url.pathname === '/api/health') {
    let players = 0;
    try { players = (await fs.readdir(PROGRESS_DIR)).filter((f) => f.endsWith('.json')).length; } catch {}
    return sendJson(res, 200, { ok: true, dataDir: DATA_DIR, players });
  }

  if (url.pathname === '/api/progress') {
    const id = safeId(url.searchParams.get('player'));
    const file = path.join(PROGRESS_DIR, `${id}.json`);

    if (req.method === 'GET') {
      try {
        const raw = await fs.readFile(file, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
        return res.end(raw);
      } catch {
        return sendJson(res, 200, {}); // no save yet
      }
    }

    if (req.method === 'POST') {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { res.writeHead(413); res.end('too large'); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', async () => {
        if (res.writableEnded) return;
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(text); // validate it's JSON
          const tmp = `${file}.tmp`;
          await fs.writeFile(tmp, JSON.stringify(data));
          await fs.rename(tmp, file); // atomic replace
          return sendJson(res, 200, { ok: true });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: 'invalid JSON' });
        }
      });
      return;
    }
  }

  return sendJson(res, 404, { ok: false, error: 'not found' });
}

// ---- static SPA ----
const serve = sirv('dist', {
  single: true,
  gzip: true,
  brotli: true,
  setHeaders(res, pathname) {
    if (pathname.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (pathname === '/' || pathname.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
});

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      console.error('[RANGE] api error:', err);
      if (!res.writableEnded) sendJson(res, 500, { ok: false, error: 'server error' });
    });
    return;
  }
  serve(req, res, () => { res.statusCode = 404; res.end('Not found'); });
}).listen(port, host, () => {
  console.log(`[RANGE] serving dist/ on http://${host}:${port}`);
});
