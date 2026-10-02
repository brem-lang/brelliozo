// Lead submission proxy: keeps the affiliate API key server-side.
// Run with: node --env-file=.env server/submit-lead.mjs   (Node >= 20.6, no dependencies)
import http from 'node:http';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  SUPABASE_URL,
  AFFILIATE_API_KEY,
  PORT = '3001',
  HOST = '127.0.0.1',
  // Optional comma-separated list of hosts autologin_url may point to (e.g. "app.example.com").
  ALLOWED_REDIRECT_HOSTS = '',
  // Local development only: also serve the static site so the form can be tested at http://localhost:PORT/
  SERVE_STATIC = '',
} = process.env;

const SITE_ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.ico': 'image/x-icon',
};

function serveStatic(urlPath, res) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { rel = ''; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = nodePath.resolve(SITE_ROOT, '.' + rel);
  const parts = nodePath.relative(SITE_ROOT, file).split(nodePath.sep);
  // Block traversal, dotfiles (.env, .git) and server-side folders.
  if (!file.startsWith(SITE_ROOT + nodePath.sep) || parts.some((p) => p.startsWith('.')) ||
      ['server', 'deploy'].includes(parts[0]) || !MIME[nodePath.extname(file).toLowerCase()]) {
    res.writeHead(404); return res.end('Not found');
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[nodePath.extname(file).toLowerCase()] });
    res.end(buf);
  });
}

if (!SUPABASE_URL || !AFFILIATE_API_KEY) {
  console.error('Missing SUPABASE_URL or AFFILIATE_API_KEY in environment.');
  process.exit(1);
}

const UPSTREAM = `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/submit-lead-nullypto`;
const COUNTRY_CODE = 'IT';
const FUNNEL = 'brelliozo';
const MAX_BODY_BYTES = 4096;
const UPSTREAM_TIMEOUT_MS = 10000;
const RATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };
const allowedHosts = ALLOWED_REDIRECT_HOSTS.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

const GENERIC_ERROR = 'Registrazione momentaneamente non disponibile. Riprova più tardi.';

const NAME_RE = /^[\p{L}\p{M}' .-]{1,50}$/u;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const PHONE_RE = /^\+[1-9]\d{7,14}$/;
const CLICK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

// --- simple in-memory per-IP rate limiter ---
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT.max;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) {
    if (times.every((t) => now - t >= RATE_LIMIT.windowMs)) hits.delete(ip);
  }
}, RATE_LIMIT.windowMs).unref();

// This service binds to localhost, so these headers can only come from nginx.
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  const real = req.headers['x-real-ip'];
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return String(cf || real || fwd || req.socket.remoteAddress || '').slice(0, 45);
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too_large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}

function validate(input) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const data = {
    firstname: str(input.firstname),
    lastname: str(input.lastname),
    email: str(input.email).toLowerCase(),
    mobile: str(input.mobile),
    click_id: str(input.click_id),
  };
  const errors = {};
  if (!NAME_RE.test(data.firstname)) errors.firstname = 'Inserisci un nome valido.';
  if (!NAME_RE.test(data.lastname)) errors.lastname = 'Inserisci un cognome valido.';
  if (!EMAIL_RE.test(data.email)) errors.email = 'Inserisci un indirizzo e-mail valido.';
  if (!PHONE_RE.test(data.mobile)) errors.mobile = 'Inserisci un numero di telefono valido.';
  if (input.terms !== true) errors.terms = 'Devi accettare i Termini e Condizioni.';
  if (data.click_id && !CLICK_ID_RE.test(data.click_id)) data.click_id = '';
  return { data, errors };
}

function safeRedirect(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (allowedHosts.length && !allowedHosts.includes(u.hostname.toLowerCase())) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || '').split('?')[0];
  if (path !== '/api/submit-lead') {
    if (SERVE_STATIC === '1' && req.method === 'GET') return serveStatic(path, res);
    return send(res, 404, { success: false });
  }
  if (req.method !== 'POST') return send(res, 405, { success: false });
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, { success: false, message: GENERIC_ERROR });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return send(res, 429, { success: false, message: 'Troppi tentativi. Riprova tra qualche minuto.' });
  }

  let input;
  try {
    input = await readJson(req);
  } catch {
    return send(res, 400, { success: false, message: GENERIC_ERROR });
  }
  if (!input || typeof input !== 'object') return send(res, 400, { success: false, message: GENERIC_ERROR });

  // Honeypot: bots fill hidden fields. Pretend success without forwarding.
  if (typeof input.website === 'string' && input.website.trim() !== '') {
    return send(res, 200, { success: true });
  }

  const { data, errors } = validate(input);
  if (Object.keys(errors).length) return send(res, 422, { success: false, errors });

  const payload = {
    firstname: data.firstname,
    lastname: data.lastname,
    email: data.email,
    mobile: data.mobile,
    country_code: COUNTRY_CODE,
    ip_address: ip,
    funnel: FUNNEL,
  };
  if (data.click_id) payload.click_id = data.click_id;

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Api-Key': AFFILIATE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const result = await upstream.json().catch(() => null);

    if (!upstream.ok || !result || result.success !== true) {
      // Log only non-sensitive diagnostics (no key, no PII).
      console.warn(`[submit-lead] upstream rejected: status=${upstream.status} request_id=${result?.request_id ?? 'n/a'}`);
      return send(res, 502, { success: false, message: GENERIC_ERROR });
    }

    const redirect = safeRedirect(result.autologin_url);
    if (!redirect) {
      console.warn(`[submit-lead] invalid autologin_url for lead_id=${result.lead_id ?? 'n/a'}`);
      return send(res, 502, { success: false, message: GENERIC_ERROR });
    }

    return send(res, 200, { success: true, autologin_url: redirect });
  } catch (err) {
    console.error(`[submit-lead] upstream error: ${err.name}`);
    return send(res, 504, { success: false, message: GENERIC_ERROR });
  }
});

server.listen(Number(PORT), HOST, () => {
  console.log(`[submit-lead] listening on http://${HOST}:${PORT}`);
});
