// WatchLog API as a single Vercel serverless function (also used by server.js for local dev).
import pg from 'pg';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

try { process.loadEnvFile(); } catch {}
const KEY = process.env.TMDB_API_KEY;
const STATUSES = ['Watching', 'Completed', 'On Hold', 'Plan to Watch', 'Dropped'];
const SECURE = process.env.VERCEL ? '; Secure' : '';

// ---------- database (Supabase Postgres via node-postgres) ----------
pg.types.setTypeParser(20, Number); // COUNT(), BIGINT timestamps -> JS numbers
const DB_URL = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').split('?')[0];
const pool = new pg.Pool({ connectionString: DB_URL, max: 3, ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
const q = (sql, args = []) => { let i = 0; return pool.query(sql.replace(/\?/g, () => '$' + ++i), args); }; // keeps the ? placeholders
const all = async (sql, ...args) => (await q(sql, args)).rows;
const one = async (sql, ...a) => (await all(sql, ...a))[0];
const run = async (sql, ...args) => (await q(sql, args)).rows[0]?.id; // use RETURNING id to get new ids
let ready;
const init = () => ready ??= (async () => {
  if (!DB_URL) fail(500, 'DATABASE_URL is not configured');
  await pool.query(`
CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, username TEXT NOT NULL, salt TEXT, hash TEXT, role TEXT DEFAULT 'user', banned INTEGER DEFAULT 0, created BIGINT DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_ci ON users(lower(username));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, created BIGINT);
CREATE TABLE IF NOT EXISTS entries(user_id INTEGER, tmdb_id INTEGER, media_type TEXT, title TEXT, poster TEXT, year TEXT,
  genres TEXT DEFAULT '[]', status TEXT, rating INTEGER, review TEXT DEFAULT '', progress INTEGER DEFAULT 0, updated BIGINT,
  PRIMARY KEY(user_id, tmdb_id, media_type));
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;`); // RLS on, no policies: Supabase's public REST API can't read these tables
})().catch(e => { ready = null; throw e; });

// ---------- TMDB ----------
const cache = new Map();
async function tmdb(p, q = {}) {
  if (!KEY) fail(500, 'TMDB_API_KEY is not configured');
  const u = new URL('https://api.themoviedb.org/3' + p);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  const headers = {};
  if (KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + KEY; else u.searchParams.set('api_key', KEY);
  const ck = u.pathname + u.search, hit = cache.get(ck);
  if (hit && hit.t > Date.now()) return hit.d;
  const r = await fetch(u, { headers });
  if (!r.ok) fail(502, 'TMDB error ' + r.status);
  const d = await r.json();
  cache.set(ck, { d, t: Date.now() + 6e5 });
  return d;
}
const G = {};
const genres = async t => G[t] ??= Object.fromEntries((await tmdb(`/genre/${t}/list`)).genres.map(g => [g.id, g.name]));
const norm = (r, t) => ({
  id: r.id, media_type: t || r.media_type, title: r.title || r.name, poster: r.poster_path,
  year: (r.release_date || r.first_air_date || '').slice(0, 4), score: r.vote_average ? +r.vote_average.toFixed(1) : null,
  genre_ids: r.genre_ids || (r.genres || []).map(g => g.id), overview: r.overview || ''
});
const isMedia = t => t === 'movie' || t === 'tv';

// ---------- auth ----------
const scrypt = promisify(crypto.scrypt);
const hash = async (pw, salt) => (await scrypt(pw, salt, 64)).toString('hex');
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]));
const setSid = (res, v, age) => res.setHeader('Set-Cookie', `sid=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${SECURE}`);
async function startSession(res, uid) {
  const token = crypto.randomBytes(32).toString('hex');
  await run('INSERT INTO sessions VALUES(?,?,?)', token, uid, Date.now());
  setSid(res, token, 2592000);
}
const fail = (status, error) => { throw Object.assign(new Error(error), { status }); };

// ---------- routes ----------
const routes = [];
const R = (m, p, f, auth = false) => routes.push([m, new RegExp('^/api' + p + '$'), f, auth]);

R('POST', '/register', async c => {
  const { username = '', password = '' } = c.body;
  if (!/^[\w.-]{3,24}$/.test(username)) fail(400, 'Username must be 3-24 letters, numbers, . _ -');
  if (password.length < 8) fail(400, 'Password must be at least 8 characters');
  if (await one('SELECT 1 x FROM users WHERE lower(username)=lower(?)', username)) fail(409, 'Username already taken');
  const salt = crypto.randomBytes(16).toString('hex');
  const role = (await one('SELECT COUNT(*) n FROM users')).n ? 'user' : 'admin'; // first account becomes admin
  const id = await run('INSERT INTO users(username,salt,hash,role,created) VALUES(?,?,?,?,?) RETURNING id', username, salt, await hash(password, salt), role, Date.now());
  await startSession(c.res, id);
  return { user: { id, username, role } };
});
R('POST', '/login', async c => {
  const u = await one('SELECT * FROM users WHERE lower(username)=lower(?)', String(c.body.username || ''));
  const ok = u && crypto.timingSafeEqual(Buffer.from(u.hash, 'hex'), Buffer.from(await hash(String(c.body.password || ''), u.salt), 'hex'));
  if (!ok) fail(401, 'Invalid username or password');
  if (u.banned) fail(403, 'This account has been suspended');
  await startSession(c.res, u.id);
  return { user: { id: u.id, username: u.username, role: u.role } };
});
R('POST', '/logout', async c => {
  if (c.sid) await run('DELETE FROM sessions WHERE token=?', c.sid);
  setSid(c.res, '', 0);
  return { ok: true };
});
R('GET', '/me', async c => ({ user: c.user || null }));

R('GET', '/trending', async () => (await tmdb('/trending/all/week')).results.filter(r => isMedia(r.media_type)).map(r => norm(r)));
R('GET', '/search', async c => {
  const q = c.url.searchParams.get('q')?.trim();
  if (!q) return [];
  return (await tmdb('/search/multi', { query: q, include_adult: 'false' })).results.filter(r => isMedia(r.media_type)).map(r => norm(r));
});
R('GET', '/title/(movie|tv)/(\\d+)', async c => {
  const [t, id] = c.m;
  const d = await tmdb(`/${t}/${id}`), n = norm(d, t);
  return { ...n, backdrop: d.backdrop_path, genres: (d.genres || []).map(g => g.name), tagline: d.tagline || '',
    runtime: d.runtime || (d.episode_run_time || [])[0] || null, episodes: d.number_of_episodes || null, seasons: d.number_of_seasons || null };
});
R('GET', '/reviews/(movie|tv)/(\\d+)', async c =>
  all(`SELECT u.username, e.rating, e.review, e.updated FROM entries e JOIN users u ON u.id=e.user_id
    WHERE e.media_type=? AND e.tmdb_id=? AND e.review<>'' ORDER BY e.updated DESC LIMIT 20`, c.m[0], +c.m[1]));

const LIST = 'SELECT tmdb_id AS id, media_type, title, poster, year, genres, status, rating, review, progress, updated FROM entries WHERE user_id=?';
const parse = e => ({ ...e, genres: JSON.parse(e.genres) });
R('GET', '/list', async c => (await all(LIST + ' ORDER BY updated DESC', c.user.id)).map(parse), true);
R('PUT', '/entry', async c => {
  const b = c.body, t = b.media_type, id = +b.id;
  if (!isMedia(t) || !id || !b.title) fail(400, 'Invalid title');
  if (!STATUSES.includes(b.status)) fail(400, 'Invalid status');
  const rating = b.rating == null || b.rating === '' ? null : Math.round(+b.rating);
  if (rating !== null && !(rating >= 1 && rating <= 10)) fail(400, 'Rating must be 1-10');
  const g = await genres(t), names = (b.genre_ids || []).map(i => g[i]).filter(Boolean);
  await run(`INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,tmdb_id,media_type) DO UPDATE SET status=excluded.status, rating=excluded.rating,
    review=excluded.review, progress=excluded.progress, updated=excluded.updated`,
    c.user.id, id, t, String(b.title).slice(0, 200), b.poster || null, String(b.year || ''), JSON.stringify(names),
    b.status, rating, String(b.review || '').slice(0, 5000), Math.max(0, Math.round(+b.progress || 0)), Date.now());
  return { ok: true };
}, true);
R('DELETE', '/entry/(movie|tv)/(\\d+)', async c => {
  await run('DELETE FROM entries WHERE user_id=? AND media_type=? AND tmdb_id=?', c.user.id, c.m[0], +c.m[1]);
  return { ok: true };
}, true);

R('GET', '/stats', async c => {
  const rows = (await all(LIST, c.user.id)).map(parse);
  const count = (arr, f) => arr.reduce((o, x) => { for (const k of [].concat(f(x))) o[k] = (o[k] || 0) + 1; return o; }, {});
  const rated = rows.filter(r => r.rating);
  return {
    total: rows.length, byStatus: count(rows, r => r.status), byType: count(rows, r => r.media_type),
    avgRating: rated.length ? +(rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(2) : null,
    ratingDist: count(rated, r => r.rating),
    topGenres: Object.entries(count(rows, r => r.genres)).sort((a, b) => b[1] - a[1]).slice(0, 8),
    episodesWatched: rows.filter(r => r.media_type === 'tv').reduce((s, r) => s + r.progress, 0)
  };
}, true);

R('GET', '/recommendations', async c => {
  const rows = (await all(LIST, c.user.id)).map(parse);
  const tracked = new Set(rows.map(r => r.media_type + r.id));
  const w = {};
  for (const e of rows) {
    const wt = e.status === 'Dropped' ? -1 : e.rating ? (e.rating - 5) / 2 : e.status === 'Completed' ? 1 : 0.5;
    for (const n of e.genres) w[n] = (w[n] || 0) + wt;
  }
  const top = Object.entries(w).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
  if (!top.length) return { basedOn: [], items: (await tmdb('/trending/all/week')).results.filter(r => isMedia(r.media_type)).map(r => norm(r)) };
  const lists = await Promise.all(['movie', 'tv'].map(async t => {
    const g = await genres(t);
    const ids = top.map(n => Object.keys(g).find(k => g[k] === n)).filter(Boolean);
    if (!ids.length) return [];
    const d = await tmdb(`/discover/${t}`, { with_genres: ids.join('|'), sort_by: 'popularity.desc', 'vote_count.gte': 300, 'vote_average.gte': 6.8 });
    return d.results.map(r => ({ ...norm(r, t), why: ids.filter(i => r.genre_ids.includes(+i)).map(i => g[i]) }));
  }));
  const items = [];
  for (let i = 0; i < 20; i++) for (const l of lists) if (l[i] && !tracked.has(l[i].media_type + l[i].id)) items.push(l[i]);
  return { basedOn: top, items };
}, true);

// ---------- admin ----------
const DAY = 864e5, dkey = t => new Date(t).toISOString().slice(5, 10);
R('GET', '/admin/overview', async () => {
  const wk = Date.now() - 7 * DAY, since = Date.now() - 13 * DAY;
  const days = Array.from({ length: 14 }, (_, i) => dkey(Date.now() - (13 - i) * DAY));
  const bucket = rows => { const m = Object.fromEntries(days.map(d => [d, 0])); rows.forEach(r => { const k = dkey(r.t); if (k in m) m[k]++; }); return days.map(d => m[d]); };
  const gc = {}; (await all('SELECT genres FROM entries')).forEach(r => JSON.parse(r.genres).forEach(g => gc[g] = (gc[g] || 0) + 1));
  const [users, newUsers, active, entries, reviews, avg, signups, activity, status, top, recent] = await Promise.all([
    one('SELECT COUNT(*) n FROM users'), one('SELECT COUNT(*) n FROM users WHERE created>?', wk),
    one('SELECT COUNT(DISTINCT user_id) n FROM entries WHERE updated>?', wk), one('SELECT COUNT(*) n FROM entries'),
    one("SELECT COUNT(*) n FROM entries WHERE review<>''"), one('SELECT ROUND(AVG(rating)::numeric,2)::float a FROM entries'),
    all('SELECT created t FROM users WHERE created>?', since), all('SELECT updated t FROM entries WHERE updated>?', since),
    all('SELECT status k, COUNT(*) n FROM entries GROUP BY status'),
    all('SELECT MIN(title) AS title, media_type, COUNT(*) n, ROUND(AVG(rating)::numeric,1)::float avg FROM entries GROUP BY media_type, tmdb_id ORDER BY n DESC, avg DESC NULLS LAST LIMIT 8'),
    all('SELECT u.username, e.title, e.status, e.rating, e.updated FROM entries e JOIN users u ON u.id=e.user_id ORDER BY e.updated DESC LIMIT 8')]);
  return {
    cards: { users: users.n, newUsers: newUsers.n, active: active.n, entries: entries.n, reviews: reviews.n, avg: avg.a },
    days, signups: bucket(signups), activity: bucket(activity), status, top, recent,
    genres: Object.entries(gc).sort((a, b) => b[1] - a[1]).slice(0, 8)
  };
}, 'admin');
R('GET', '/admin/users', async () => all(`SELECT u.id, u.username, u.role, u.banned, u.created,
  (SELECT COUNT(*) FROM entries WHERE user_id=u.id) entries, (SELECT MAX(updated) FROM entries WHERE user_id=u.id) AS "last" FROM users u ORDER BY u.id`), 'admin');
R('POST', '/admin/users/(\\d+)/(promote|demote|ban|unban|delete)', async c => {
  const id = +c.m[0], a = c.m[1];
  if (id === c.user.id) fail(400, "You can't change your own account");
  if (!await one('SELECT 1 x FROM users WHERE id=?', id)) fail(404, 'User not found');
  if (a === 'delete') { for (const t of ['entries', 'sessions']) await run(`DELETE FROM ${t} WHERE user_id=?`, id); await run('DELETE FROM users WHERE id=?', id); }
  else {
    const [col, val] = { promote: ['role', 'admin'], demote: ['role', 'user'], ban: ['banned', 1], unban: ['banned', 0] }[a];
    await run(`UPDATE users SET ${col}=? WHERE id=?`, val, id);
    if (a === 'ban') await run('DELETE FROM sessions WHERE user_id=?', id);
  }
  return { ok: true };
}, 'admin');
R('GET', '/admin/reviews', async () => all(`SELECT e.user_id uid, u.username, e.tmdb_id id, e.media_type, e.title, e.rating, e.review, e.updated
  FROM entries e JOIN users u ON u.id=e.user_id WHERE e.review<>'' ORDER BY e.updated DESC LIMIT 500`), 'admin');
R('DELETE', '/admin/review/(\\d+)/(movie|tv)/(\\d+)', async c => {
  await run("UPDATE entries SET review='' WHERE user_id=? AND media_type=? AND tmdb_id=?", +c.m[0], c.m[1], +c.m[2]);
  return { ok: true };
}, 'admin');

// ---------- entry point ----------
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const send = (s, o) => { res.statusCode = s; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  try {
    if (url.pathname === '/api/health') { // shows which setting is missing; details only when DEBUG_ERRORS is set
      let db = 'ok';
      try { await init(); } catch (e) { db = process.env.DEBUG_ERRORS ? e.message : 'failed (set DEBUG_ERRORS=1 to see why)'; }
      return send(200, { tmdbKey: !!KEY, databaseUrl: !!DB_URL, db });
    }
    await init();
    const sid = cookies(req).sid;
    const user = sid ? await one('SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.banned=0', sid) : null;
    for (const [m, re, fn, auth] of routes) {
      const match = req.method === m && url.pathname.match(re);
      if (!match) continue;
      if (auth && !user) return send(401, { error: 'Please log in' });
      if (auth === 'admin' && user.role !== 'admin') return send(403, { error: 'Admins only' });
      let body = req.body ?? {};
      if (typeof body === 'string') { try { body = body ? JSON.parse(body) : {}; } catch { fail(400, 'Bad JSON'); } }
      return send(200, await fn({ req, res, url, body, user, sid, m: match.slice(1) }));
    }
    return send(404, { error: 'Not found' });
  } catch (e) { send(e.status || 500, { error: e.status ? e.message : process.env.VERCEL && !process.env.DEBUG_ERRORS ? 'Server error' : 'Server error: ' + e.message }); if (!e.status) console.error(e); }
}
