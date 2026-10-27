// Servidor de producción: sirve la SPA (dist/) y la API /api respaldada por Postgres.
// Autenticación verificada en el servidor (Google ID token o invitado de GUEST_USERS);
// la sesión es un token firmado con HMAC (SESSION_SECRET).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env.DIST_DIR || path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT) || 80;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_DOMAIN = (process.env.ALLOWED_DOMAIN || 'zebradigital.marketing').toLowerCase();
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSION_DAYS = 30;
const MAX_BODY = 25 * 1024 * 1024;

if (!process.env.DATABASE_URL) console.warn('⚠️  DATABASE_URL no definido: la API de benchmarks fallará');
if (!SESSION_SECRET) console.warn('⚠️  SESSION_SECRET no definido: no se podrán emitir sesiones');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

const migrate = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS benchmarks (
      id          TEXT PRIMARY KEY,
      owner       TEXT NOT NULL,
      provider    TEXT NOT NULL DEFAULT 'google',
      title       TEXT NOT NULL,
      context     TEXT NOT NULL DEFAULT '',
      result      JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS benchmarks_owner_idx ON benchmarks (owner);
    CREATE INDEX IF NOT EXISTS benchmarks_created_idx ON benchmarks (created_at DESC);
  `);
};

// ---- Sesión firmada ----
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');

const issueToken = (session) => {
  const body = b64url(JSON.stringify(session));
  return `${body}.${sign(body)}`;
};

const readToken = (req) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [body, sig] = token.split('.');
  if (!body || !sig || !SESSION_SECRET) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!s.exp || s.exp * 1000 <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
};

const isInternal = (s) => s.provider === 'google' && s.email.endsWith('@' + ALLOWED_DOMAIN);

// ---- Invitados (GUEST_USERS="correo:clave,correo2:clave2"), solo en servidor ----
const guests = (process.env.GUEST_USERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((pair) => {
    const i = pair.indexOf(':');
    return i === -1 ? null : { email: pair.slice(0, i).trim().toLowerCase(), password: pair.slice(i + 1) };
  })
  .filter(Boolean);

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

// ---- Utilidades HTTP ----
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sendJson = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Payload demasiado grande'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch {
        reject(new HttpError(400, 'JSON inválido'));
      }
    });
    req.on('error', reject);
  });

const requireSession = (req) => {
  const s = readToken(req);
  if (!s) throw new HttpError(401, 'Sesión inválida o expirada');
  return s;
};

const deriveTitle = (context) => {
  const firstLine = (context || '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '';
  const clean = firstLine.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Benchmark sin título';
  return clean.length > 70 ? clean.slice(0, 70) + '…' : clean;
};

const toRecord = (row) => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at.toISOString(),
  context: row.context,
  result: row.result,
  owner: row.owner,
});

// Fila resumida para el listado (sin el reporte completo).
const toSummary = (row) => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at.toISOString(),
  owner: row.owner,
  competitors: Number(row.competitors) || 0,
  cost: row.cost || null,
});

const findOwned = async (id, session) => {
  const { rows } = await pool.query('SELECT owner FROM benchmarks WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(404, 'Benchmark no encontrado');
  if (rows[0].owner !== session.email && !isInternal(session)) throw new HttpError(403, 'Sin permiso');
};

// ---- Rutas API ----
const api = async (req, res, pathname) => {
  const method = req.method;

  if (pathname === '/api/auth/google' && method === 'POST') {
    const { credential } = await readBody(req);
    if (!credential) throw new HttpError(400, 'Falta credential');
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!r.ok) throw new HttpError(401, 'No pudimos validar tu identidad de Google. Inténtalo de nuevo.');
    const p = await r.json();
    if (GOOGLE_CLIENT_ID && p.aud !== GOOGLE_CLIENT_ID) throw new HttpError(401, 'Token de Google para otra aplicación.');
    const email = String(p.email || '').toLowerCase();
    if (!email.endsWith('@' + ALLOWED_DOMAIN) && String(p.hd || '').toLowerCase() !== ALLOWED_DOMAIN) {
      throw new HttpError(403, `Acceso restringido: usa tu cuenta @${ALLOWED_DOMAIN}.`);
    }
    if (String(p.email_verified) !== 'true') throw new HttpError(403, 'Tu correo de Google no está verificado.');
    const session = {
      email,
      name: String(p.name || email),
      picture: String(p.picture || ''),
      exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
      provider: 'google',
    };
    return sendJson(res, 200, { session, token: issueToken(session) });
  }

  if (pathname === '/api/auth/guest' && method === 'POST') {
    const { email, password } = await readBody(req);
    const e = String(email || '').trim().toLowerCase();
    if (!e || !password) throw new HttpError(400, 'Ingresa correo y contraseña.');
    if (!guests.length) throw new HttpError(403, 'El acceso de invitado no está configurado.');
    const match = guests.find((g) => g.email === e && safeEqual(g.password, String(password)));
    if (!match) throw new HttpError(401, 'Correo o contraseña de invitado incorrectos.');
    const session = { email: e, name: e, picture: '', exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400, provider: 'guest' };
    return sendJson(res, 200, { session, token: issueToken(session) });
  }

  if (pathname === '/api/benchmarks' && method === 'GET') {
    const s = requireSession(req);
    const all = isInternal(s);
    const { rows } = await pool.query(
      `SELECT id, title, created_at, owner,
              COALESCE(jsonb_array_length(result->'competitors'), 0) AS competitors,
              result->'cost' AS cost
         FROM benchmarks
        ${all ? '' : 'WHERE owner = $1'}
        ORDER BY created_at DESC`,
      all ? [] : [s.email]
    );
    return sendJson(res, 200, rows.map(toSummary));
  }

  if (pathname === '/api/benchmarks' && method === 'POST') {
    const s = requireSession(req);
    const body = await readBody(req);
    if (!body.result || typeof body.result !== 'object') throw new HttpError(400, 'Falta result');
    const context = String(body.context || '');
    // Un id provisto (migración desde localStorage) se respeta para no duplicar.
    const id =
      typeof body.id === 'string' && /^[\w-]{1,80}$/.test(body.id)
        ? body.id
        : `bm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const createdAt = body.createdAt || body.result.generatedAt || new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO benchmarks (id, owner, provider, title, context, result, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [id, s.email, s.provider, String(body.title || deriveTitle(context)), context, body.result, createdAt]
    );
    if (!rows.length) {
      const existing = await pool.query('SELECT * FROM benchmarks WHERE id = $1', [id]);
      return sendJson(res, 200, toRecord(existing.rows[0]));
    }
    return sendJson(res, 201, toRecord(rows[0]));
  }

  const m = pathname.match(/^\/api\/benchmarks\/([\w-]{1,80})$/);
  if (m) {
    const s = requireSession(req);
    const id = m[1];
    if (method === 'GET') {
      const { rows } = await pool.query('SELECT * FROM benchmarks WHERE id = $1', [id]);
      if (!rows.length) throw new HttpError(404, 'Benchmark no encontrado');
      if (rows[0].owner !== s.email && !isInternal(s)) throw new HttpError(403, 'Sin permiso');
      return sendJson(res, 200, toRecord(rows[0]));
    }
    if (method === 'PUT') {
      await findOwned(id, s);
      const { result } = await readBody(req);
      if (!result || typeof result !== 'object') throw new HttpError(400, 'Falta result');
      await pool.query('UPDATE benchmarks SET result = $2, updated_at = now() WHERE id = $1', [id, result]);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      await findOwned(id, s);
      await pool.query('DELETE FROM benchmarks WHERE id = $1', [id]);
      return sendJson(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'Ruta no encontrada');
};

// ---- Archivos estáticos (SPA) ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const serveStatic = (req, res, pathname) => {
  let file = path.join(DIST, path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html'); // SPA fallback
  }
  const ext = path.extname(file).toLowerCase();
  const isIndex = file.endsWith('index.html');
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': isIndex ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000, immutable',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
};

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('healthy\n');
  }
  if (pathname.startsWith('/api/')) {
    try {
      await api(req, res, pathname);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      sendJson(res, status, { error: status === 500 ? 'Error interno del servidor' : err.message });
    }
    return;
  }
  serveStatic(req, res, pathname);
});

migrate()
  .then(() => console.log('✅ Base de datos lista'))
  .catch((err) => console.error('❌ No se pudo preparar la base de datos:', err.message));

server.listen(PORT, () => console.log(`🚀 Servidor escuchando en :${PORT}`));
