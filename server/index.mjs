// Servidor de producción: sirve la SPA (dist/) y la API /api respaldada por Postgres.
// Autenticación verificada en el servidor (Google ID token o invitado de la tabla
// guests); la sesión es un token firmado con HMAC (SESSION_SECRET). Las llamadas a
// Claude pasan por /api/anthropic con la clave asignada al usuario (cifrada en BD).
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
const MAX_PROXY_BODY = 32 * 1024 * 1024; // límite de request de la API de Anthropic
const ANTHROPIC_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
// Clave maestra para cifrar las API keys en reposo (AES-256-GCM).
const ENC_KEY = process.env.ENCRYPTION_KEY
  ? crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest()
  : null;

if (!process.env.DATABASE_URL) console.warn('⚠️  DATABASE_URL no definido: la API de benchmarks fallará');
if (!SESSION_SECRET) console.warn('⚠️  SESSION_SECRET no definido: no se podrán emitir sesiones');
if (!ENC_KEY) console.warn('⚠️  ENCRYPTION_KEY no definido: no se podrán guardar ni usar claves de Claude');

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

    CREATE TABLE IF NOT EXISTS api_keys (
      id          SERIAL PRIMARY KEY,
      label       TEXT NOT NULL,
      key_enc     TEXT NOT NULL,
      key_hint    TEXT NOT NULL,
      is_default  BOOLEAN NOT NULL DEFAULT false,
      active      BOOLEAN NOT NULL DEFAULT true,
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_default ON api_keys (is_default) WHERE is_default;

    CREATE TABLE IF NOT EXISTS guests (
      email         TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      api_key_id    INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
      active        BOOLEAN NOT NULL DEFAULT true,
      created_by    TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await seedFromEnv();
};

// Importación única desde el entorno: GUEST_USERS → guests, ANTHROPIC_API_KEY → clave por defecto.
const seedFromEnv = async () => {
  const { rows: g } = await pool.query('SELECT count(*)::int AS n FROM guests');
  if (g[0].n === 0 && process.env.GUEST_USERS) {
    const list = process.env.GUEST_USERS.split(',').map((x) => x.trim()).filter(Boolean);
    for (const pair of list) {
      const i = pair.indexOf(':');
      if (i === -1) continue;
      const email = pair.slice(0, i).trim().toLowerCase();
      await pool.query(
        `INSERT INTO guests (email, password_hash, created_by) VALUES ($1, $2, 'GUEST_USERS') ON CONFLICT DO NOTHING`,
        [email, hashPassword(pair.slice(i + 1))]
      );
    }
    console.log(`✅ Invitados importados desde GUEST_USERS: ${list.length}`);
  }
  const envKey = process.env.ANTHROPIC_API_KEY || process.env.API_KEY;
  const { rows: k } = await pool.query('SELECT count(*)::int AS n FROM api_keys');
  if (k[0].n === 0 && envKey && ENC_KEY) {
    await pool.query(
      `INSERT INTO api_keys (label, key_enc, key_hint, is_default, created_by) VALUES ('Principal', $1, $2, true, 'ANTHROPIC_API_KEY')`,
      [encrypt(envKey), keyHint(envKey)]
    );
    console.log('✅ Clave de Claude importada desde ANTHROPIC_API_KEY como predeterminada');
  }
};

// ---- Cifrado de API keys y hash de contraseñas ----
const encrypt = (plain) => {
  if (!ENC_KEY) throw new HttpError(500, 'ENCRYPTION_KEY no configurado en el servidor');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
};

const decrypt = (blob) => {
  if (!ENC_KEY) throw new HttpError(500, 'ENCRYPTION_KEY no configurado en el servidor');
  const [iv, tag, enc] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
};

const keyHint = (key) => `${key.slice(0, 7)}…${key.slice(-4)}`;

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
};

const checkPassword = (password, stored) => {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
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

// Los invitados se revalidan en cada llamada: borrar o desactivar uno corta su acceso al instante.
const requireSession = async (req) => {
  const s = readToken(req);
  if (!s) throw new HttpError(401, 'Sesión inválida o expirada');
  if (s.provider === 'guest') {
    const { rows } = await pool.query('SELECT active FROM guests WHERE email = $1', [s.email]);
    if (!rows.length || !rows[0].active) throw new HttpError(401, 'Tu acceso de invitado fue revocado');
  }
  return s;
};

const requireInternal = async (req) => {
  const s = await requireSession(req);
  if (!isInternal(s)) throw new HttpError(403, 'Solo el personal de Zebra puede administrar');
  return s;
};

// Clave de Claude para la sesión: la asignada al invitado (si está activa) o la predeterminada.
const resolveApiKey = async (s) => {
  if (s.provider === 'guest') {
    const { rows } = await pool.query(
      `SELECT k.id, k.key_enc FROM guests g JOIN api_keys k ON k.id = g.api_key_id
        WHERE g.email = $1 AND k.active`,
      [s.email]
    );
    if (rows.length) return rows[0];
  }
  const { rows } = await pool.query('SELECT id, key_enc FROM api_keys WHERE is_default AND active');
  if (!rows.length) throw new HttpError(503, 'No hay una clave de Claude configurada. Pide a un administrador que agregue una.');
  return rows[0];
};

// ---- Proxy a la API de Anthropic ----
const HOP_HEADERS = ['anthropic-version', 'anthropic-beta', 'content-type', 'accept'];

const proxyAnthropic = async (req, res, pathname) => {
  const s = await requireSession(req);
  const sub = pathname.slice('/api/anthropic'.length);
  if (req.method !== 'POST' || !/^\/v1\/messages(\/count_tokens)?$/.test(sub)) {
    throw new HttpError(404, 'Ruta de Anthropic no permitida');
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_PROXY_BODY) throw new HttpError(413, 'La solicitud supera el límite de 32 MB de Claude');
    chunks.push(c);
  }
  const key = await resolveApiKey(s);
  const headers = { 'x-api-key': decrypt(key.key_enc) };
  for (const h of HOP_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];
  const upstream = await fetch(ANTHROPIC_URL + sub, { method: 'POST', headers, body: Buffer.concat(chunks) });
  pool.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [key.id]).catch(() => {});
  const out = {};
  for (const [k, v] of upstream.headers) {
    if (k === 'content-type' || k === 'request-id' || k.startsWith('anthropic-') || k === 'retry-after') out[k] = v;
  }
  res.writeHead(upstream.status, out);
  if (upstream.body) for await (const c of upstream.body) res.write(c);
  res.end();
};

// Verifica una clave nueva contra Anthropic antes de guardarla.
const validateAnthropicKey = async (key) => {
  const r = await fetch(`${ANTHROPIC_URL}/v1/models?limit=1`, {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  });
  if (r.status === 401 || r.status === 403) throw new HttpError(400, 'Anthropic rechazó la clave: revisa que sea correcta y esté activa.');
  if (!r.ok) throw new HttpError(502, `No se pudo verificar la clave con Anthropic (HTTP ${r.status}).`);
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

// ---- Administración (solo personal interno) ----
const toKey = (r) => ({
  id: r.id,
  label: r.label,
  hint: r.key_hint,
  isDefault: r.is_default,
  active: r.active,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
  lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
  guests: Number(r.guests) || 0,
});

const toGuest = (r) => ({
  email: r.email,
  apiKeyId: r.api_key_id,
  active: r.active,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
});

const listKeys = async () => {
  const { rows } = await pool.query(
    `SELECT k.*, (SELECT count(*) FROM guests g WHERE g.api_key_id = k.id) AS guests
       FROM api_keys k ORDER BY k.is_default DESC, k.created_at`
  );
  return rows.map(toKey);
};

const parseKeyId = async (value) => {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  const { rows } = await pool.query('SELECT id FROM api_keys WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(400, 'La clave seleccionada no existe');
  return id;
};

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const adminApi = async (req, res, pathname, method) => {
  const s = await requireInternal(req);

  if (pathname === '/api/admin/keys' && method === 'GET') return sendJson(res, 200, await listKeys());

  if (pathname === '/api/admin/keys' && method === 'POST') {
    const { label, key } = await readBody(req);
    const k = String(key || '').trim();
    const l = String(label || '').trim();
    if (!l) throw new HttpError(400, 'Ponle un nombre a la clave');
    if (!k.startsWith('sk-ant-')) throw new HttpError(400, 'No parece una clave de Anthropic (empieza con sk-ant-)');
    await validateAnthropicKey(k);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM api_keys WHERE is_default');
    await pool.query(
      'INSERT INTO api_keys (label, key_enc, key_hint, is_default, created_by) VALUES ($1, $2, $3, $4, $5)',
      [l, encrypt(k), keyHint(k), rows[0].n === 0, s.email]
    );
    return sendJson(res, 201, await listKeys());
  }

  const km = pathname.match(/^\/api\/admin\/keys\/(\d+)$/);
  if (km) {
    const id = Number(km[1]);
    const { rows: found } = await pool.query('SELECT * FROM api_keys WHERE id = $1', [id]);
    if (!found.length) throw new HttpError(404, 'Clave no encontrada');

    if (method === 'PATCH') {
      const body = await readBody(req);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (typeof body.label === 'string' && body.label.trim()) {
          await client.query('UPDATE api_keys SET label = $2 WHERE id = $1', [id, body.label.trim()]);
        }
        if (typeof body.active === 'boolean') {
          if (!body.active && found[0].is_default) throw new HttpError(400, 'No puedes desactivar la clave predeterminada; elige otra como predeterminada primero');
          await client.query('UPDATE api_keys SET active = $2 WHERE id = $1', [id, body.active]);
        }
        if (body.isDefault === true) {
          await client.query('UPDATE api_keys SET is_default = false WHERE is_default');
          await client.query('UPDATE api_keys SET is_default = true, active = true WHERE id = $1', [id]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return sendJson(res, 200, await listKeys());
    }

    if (method === 'DELETE') {
      // ?reassignTo=<id> mueve a sus invitados a otra clave; sin él quedan con la predeterminada.
      const reassignTo = await parseKeyId(new URL(req.url, 'http://x').searchParams.get('reassignTo'));
      if (reassignTo === id) throw new HttpError(400, 'Elige una clave distinta para reasignar');
      if (found[0].is_default) {
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM api_keys');
        if (rows[0].n > 1) throw new HttpError(400, 'Es la clave predeterminada: marca otra como predeterminada antes de borrarla');
      }
      await pool.query('UPDATE guests SET api_key_id = $2 WHERE api_key_id = $1', [id, reassignTo]);
      await pool.query('DELETE FROM api_keys WHERE id = $1', [id]);
      return sendJson(res, 200, await listKeys());
    }
  }

  if (pathname === '/api/admin/guests' && method === 'GET') {
    const { rows } = await pool.query('SELECT * FROM guests ORDER BY created_at DESC');
    return sendJson(res, 200, rows.map(toGuest));
  }

  if (pathname === '/api/admin/guests' && method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!validEmail(email)) throw new HttpError(400, 'Correo inválido');
    if (email.endsWith('@' + ALLOWED_DOMAIN)) throw new HttpError(400, `Las cuentas @${ALLOWED_DOMAIN} entran con Google, no como invitado`);
    if (password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
    const apiKeyId = await parseKeyId(body.apiKeyId);
    const { rowCount } = await pool.query(
      `INSERT INTO guests (email, password_hash, api_key_id, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [email, hashPassword(password), apiKeyId, s.email]
    );
    if (!rowCount) throw new HttpError(409, 'Ya existe un invitado con ese correo');
    return sendJson(res, 201, { ok: true });
  }

  const gm = pathname.match(/^\/api\/admin\/guests\/([^/]+)$/);
  if (gm) {
    const email = decodeURIComponent(gm[1]).toLowerCase();
    const { rows: found } = await pool.query('SELECT email FROM guests WHERE email = $1', [email]);
    if (!found.length) throw new HttpError(404, 'Invitado no encontrado');

    if (method === 'PATCH') {
      const body = await readBody(req);
      if ('apiKeyId' in body) {
        await pool.query('UPDATE guests SET api_key_id = $2 WHERE email = $1', [email, await parseKeyId(body.apiKeyId)]);
      }
      if (typeof body.active === 'boolean') {
        await pool.query('UPDATE guests SET active = $2 WHERE email = $1', [email, body.active]);
      }
      if (typeof body.password === 'string' && body.password) {
        if (body.password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
        await pool.query('UPDATE guests SET password_hash = $2 WHERE email = $1', [email, hashPassword(body.password)]);
      }
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'DELETE') {
      await pool.query('DELETE FROM guests WHERE email = $1', [email]);
      return sendJson(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'Ruta no encontrada');
};

// ---- Rutas API ----
const api = async (req, res, pathname) => {
  const method = req.method;

  if (pathname.startsWith('/api/anthropic/')) return proxyAnthropic(req, res, pathname);
  if (pathname.startsWith('/api/admin/')) return adminApi(req, res, pathname, method);

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
    const { rows } = await pool.query('SELECT password_hash, active FROM guests WHERE email = $1', [e]);
    if (!rows.length || !checkPassword(password, rows[0].password_hash)) {
      throw new HttpError(401, 'Correo o contraseña de invitado incorrectos.');
    }
    if (!rows[0].active) throw new HttpError(403, 'Tu acceso de invitado está desactivado.');
    const session = { email: e, name: e, picture: '', exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400, provider: 'guest' };
    return sendJson(res, 200, { session, token: issueToken(session) });
  }

  if (pathname === '/api/benchmarks' && method === 'GET') {
    const s = await requireSession(req);
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
    const s = await requireSession(req);
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
    const s = await requireSession(req);
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
      if (res.headersSent) res.end();
      else sendJson(res, status, { error: status === 500 ? 'Error interno del servidor' : err.message });
    }
    return;
  }
  serveStatic(req, res, pathname);
});

migrate()
  .then(() => console.log('✅ Base de datos lista'))
  .catch((err) => console.error('❌ No se pudo preparar la base de datos:', err.message));

// Las investigaciones con búsqueda web pueden tardar varios minutos.
server.requestTimeout = 15 * 60 * 1000;
server.listen(PORT, () => console.log(`🚀 Servidor escuchando en :${PORT}`));
