// Tabletop RPG scheduler — API + static file server.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { sendMail } = require('./mail');
const { verifyGoogleToken, GOOGLE_CLIENT_ID } = require('./google-auth');

const app = express();
const PORT = process.env.PORT || 3000;
// Links in emails always use this, never the request's Host header (which a client can forge).
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SESSION_DAYS = 30;
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// ---------------------------------------------------------------- helpers
const q = {
  get: (sql, ...a) => db.prepare(sql).get(...a),
  all: (sql, ...a) => db.prepare(sql).all(...a),
  run: (sql, ...a) => db.prepare(sql).run(...a),
};
const now = () => Date.now();
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const httpError = (status, message) => Object.assign(new Error(message), { status });
const wrap = fn => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };

// Password hashing: scrypt (memory-hard KDF built into Node) with a random 16-byte salt.
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT).toString('hex');
  return { hash, salt };
}
function verifyPassword(password, salt, expected) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(p => p.trim().split('=')).filter(p => p[0])
    .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.set('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}
function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  q.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    sha256(token), userId, now() + SESSION_DAYS * 864e5);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}

function publicUser(u) { return u && { id: u.id, username: u.username }; }

function notify(userId, type, payload) {
  q.run('INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)', userId, type, JSON.stringify(payload));
}

function getGame(id) {
  const g = q.get('SELECT * FROM games WHERE id = ?', Number(id));
  if (!g) throw httpError(404, 'Game not found');
  return g;
}
const isMember = (gameId, userId) => !!q.get('SELECT 1 FROM game_members WHERE game_id = ? AND user_id = ?', gameId, userId);
const isKicked = (gameId, userId) => !!q.get('SELECT 1 FROM game_kicked WHERE game_id = ? AND user_id = ?', gameId, userId);
function requireMember(game, user) {
  if (!isMember(game.id, user.id)) throw httpError(403, 'You are not a member of this game');
}
function requireGM(game, user) {
  if (game.gm_id !== user.id) throw httpError(403, 'Only the GM can do that');
}
function addMember(gameId, userId) {
  q.run('INSERT OR IGNORE INTO game_members (game_id, user_id) VALUES (?, ?)', gameId, userId);
  markRead(userId, 'game', gameId); // the board's history before you joined isn't "unread"
}

// ---- unread messages
// Remember the newest message the user has seen in a thread (called whenever they load it).
function markRead(userId, kind, threadId) {
  const max = q.get('SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE kind = ? AND thread_id = ?', kind, threadId).id;
  q.run(`INSERT INTO thread_reads (user_id, kind, thread_id, last_read_id) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, kind, thread_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`,
    userId, kind, threadId, max);
}
// Unread counts per thread: messages from other people, not deleted, newer than what the user has seen,
// in DMs they're part of and boards of games they're in.
function unreadCounts(userId) {
  const rows = q.all(`
    SELECT m.kind, m.thread_id AS threadId, COUNT(*) AS n FROM messages m
    LEFT JOIN thread_reads r ON r.user_id = ? AND r.kind = m.kind AND r.thread_id = m.thread_id
    WHERE m.user_id != ? AND m.deleted = 0 AND m.id > COALESCE(r.last_read_id, 0) AND (
      (m.kind = 'dm' AND m.thread_id IN (SELECT id FROM dm_threads WHERE user_a = ? OR user_b = ?)) OR
      (m.kind = 'game' AND m.thread_id IN (SELECT game_id FROM game_members WHERE user_id = ?)))
    GROUP BY m.kind, m.thread_id`, userId, userId, userId, userId, userId);
  const out = { total: 0, dm: {}, game: {} };
  for (const r of rows) { out[r.kind][r.threadId] = r.n; out.total += r.n; }
  return out;
}

function getOrCreateDm(u1, u2) {
  if (u1 === u2) throw httpError(400, "You can't message yourself");
  const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
  let t = q.get('SELECT * FROM dm_threads WHERE user_a = ? AND user_b = ?', a, b);
  if (!t) {
    const r = q.run('INSERT INTO dm_threads (user_a, user_b) VALUES (?, ?)', a, b);
    t = q.get('SELECT * FROM dm_threads WHERE id = ?', r.lastInsertRowid);
  }
  return t;
}
function getDmForUser(threadId, user) {
  const t = q.get('SELECT * FROM dm_threads WHERE id = ?', Number(threadId));
  if (!t || (t.user_a !== user.id && t.user_b !== user.id)) throw httpError(404, 'Conversation not found');
  return t;
}

const wordCount = s => (s.trim().match(/\S+/g) || []).length;

function validateGameInput(body) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const startAt = new Date(body.startAt);
  const duration = Number(body.durationMin);
  const recurrence = String(body.recurrence || 'none');
  const visibility = String(body.visibility || 'public');
  const timeZone = String(body.timeZone || '').slice(0, 64) || null;
  if (timeZone) try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch { throw httpError(400, 'Invalid time zone'); }
  if (!title || title.length > 100) throw httpError(400, 'Title is required (max 100 characters)');
  if (wordCount(description) > 500) throw httpError(400, 'Description must be 500 words or fewer');
  if (description.length > 6000) throw httpError(400, 'Description is too long');
  if (isNaN(startAt)) throw httpError(400, 'A valid date and time is required');
  if (!Number.isInteger(duration) || duration < 15 || duration > 24 * 60) throw httpError(400, 'Duration must be between 15 minutes and 24 hours');
  if (!['public', 'invite', 'private'].includes(visibility)) throw httpError(400, 'Invalid visibility');
  const pattern = validatePattern(recurrence, body.pattern || {});
  return { title, description, startAt: startAt.toISOString(), duration, recurrence, visibility, timeZone, pattern };
}

// A sorted, de-duplicated list of integers in [min, max], or an error.
function intSet(list, min, max, message) {
  if (!Array.isArray(list) || !list.length || !list.every(n => Number.isInteger(n) && n >= min && n <= max)) throw httpError(400, message);
  return [...new Set(list)].sort((a, b) => a - b);
}
function validatePattern(recurrence, p) {
  const every = () => {
    const n = p.every == null ? 1 : p.every;
    if (!Number.isInteger(n) || n < 1 || n > 12) throw httpError(400, 'Repeat every 1 to 12 months');
    return n;
  };
  switch (recurrence) {
    case 'none': return null;
    case 'weekly': return JSON.stringify({ days: intSet(p.days, 0, 6, 'Pick at least one day of the week') });
    case 'monthly': return JSON.stringify({ dates: intSet(p.dates, 1, 31, 'Pick at least one date of the month'), every: every() });
    case 'monthly_weekday': return JSON.stringify({
      weeks: intSet(p.weeks, 1, 5, 'Pick which week(s) of the month'),
      weekdays: intSet(p.weekdays, 0, 6, 'Pick at least one day of the week'), every: every() });
    default: throw httpError(400, 'Invalid recurrence');
  }
}

function gameSummary(g, userId) {
  const gm = q.get('SELECT id, username FROM users WHERE id = ?', g.gm_id);
  const memberCount = q.get('SELECT COUNT(*) AS c FROM game_members WHERE game_id = ?', g.id).c;
  return {
    id: g.id, title: g.title, description: g.description, startAt: g.start_at,
    durationMin: g.duration_min, recurrence: g.recurrence, visibility: g.visibility, timeZone: g.time_zone,
    pattern: g.pattern ? JSON.parse(g.pattern) : null, closed: !!g.closed,
    gm: publicUser(gm), memberCount, isGM: g.gm_id === userId,
  };
}

function formatMessage(m, viewer, canModerate) {
  const author = q.get('SELECT id, username FROM users WHERE id = ?', m.user_id);
  return {
    id: m.id, author: publicUser(author), createdAt: m.created_at, deleted: !!m.deleted,
    body: m.deleted ? null : m.body,
    canDelete: !m.deleted && (m.user_id === viewer.id || canModerate),
  };
}

function listMessages(kind, threadId, viewer, canModerate, afterId = 0) {
  return q.all('SELECT * FROM messages WHERE kind = ? AND thread_id = ? AND id > ? ORDER BY id ASC LIMIT 1000',
    kind, threadId, Number(afterId) || 0).map(m => formatMessage(m, viewer, canModerate));
}

function validateBody(text) {
  const body = String(text || '').trim();
  if (!body) throw httpError(400, 'Message is empty');
  if (body.length > 2000) throw httpError(400, 'Message is too long (max 2000 characters)');
  return body;
}

// ---------------------------------------------------------------- auth middleware
app.use((req, res, next) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) {
    const s = q.get('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
    if (s && s.expires_at > now()) {
      const u = q.get('SELECT * FROM users WHERE id = ?', s.user_id);
      if (u && !u.banned) req.user = u;
    } else if (s) q.run('DELETE FROM sessions WHERE token_hash = ?', s.token_hash);
  }
  next();
});
const auth = (req, res, next) => req.user ? next() : next(httpError(401, 'Please log in'));
const adminOnly = (req, res, next) => req.user && req.user.is_admin ? next() : next(httpError(403, 'Admins only'));

// Simple in-memory rate limiter for login/registration attempts.
const attempts = new Map();
function rateLimit(key, max = 10, windowMs = 15 * 60 * 1000) {
  const t = now(), rec = attempts.get(key) || { n: 0, reset: t + windowMs };
  if (t > rec.reset) { rec.n = 0; rec.reset = t + windowMs; }
  rec.n++; attempts.set(key, rec);
  if (rec.n > max) throw httpError(429, 'Too many attempts. Try again in a few minutes.');
}

// ---------------------------------------------------------------- account routes
function checkNewUsername(raw) {
  const username = String(raw || '').trim();
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(username))
    throw httpError(400, 'Username must be 3–20 characters: letters, numbers, _ or -');
  if (q.get('SELECT 1 FROM users WHERE username = ?', username)) throw httpError(409, 'That username is taken');
  return username;
}
function checkNewPassword(password) {
  if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters');
  if (password.length > 200) throw httpError(400, 'Password is too long');
}
const isAdminName = username => ADMIN_USERNAMES.includes(username.toLowerCase()) ? 1 : 0;

app.post('/api/register', wrap((req, res) => {
  rateLimit('reg:' + req.ip, 20);
  const username = checkNewUsername(req.body.username);
  const password = String(req.body.password || '');
  checkNewPassword(password);
  const { hash, salt } = hashPassword(password);
  const r = q.run('INSERT INTO users (username, pass_hash, salt, is_admin) VALUES (?, ?, ?, ?)', username, hash, salt, isAdminName(username));
  createSession(req, res, r.lastInsertRowid);
  res.json({ ok: true });
}));

app.post('/api/login', wrap((req, res) => {
  const username = String(req.body.username || '').trim();
  rateLimit('login:' + req.ip + ':' + username.toLowerCase());
  const u = q.get('SELECT * FROM users WHERE username = ?', username);
  if (!u || !verifyPassword(String(req.body.password || ''), u.salt, u.pass_hash))
    throw httpError(401, 'Wrong username or password');
  if (u.banned) throw httpError(403, 'This account has been suspended');
  createSession(req, res, u.id);
  res.json({ ok: true });
}));

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) q.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  setSessionCookie(req, res, '', 0);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const unread = q.get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', req.user.id).c;
  const pending = q.get("SELECT email FROM email_tokens WHERE user_id = ? AND kind = 'verify' AND expires_at > ?", req.user.id, now());
  res.json({ id: req.user.id, username: req.user.username, isAdmin: !!req.user.is_admin, unread,
    unreadMessages: unreadCounts(req.user.id).total,
    displayName: req.user.display_name, pronouns: req.user.pronouns, bio: req.user.bio,
    hasPassword: !!req.user.pass_hash, email: req.user.email || null, pendingEmail: pending ? pending.email : null,
    googleEmail: req.user.google_sub ? (req.user.google_email || 'your Google account') : null });
});

app.get('/api/unread', auth, (req, res) => res.json(unreadCounts(req.user.id)));

app.get('/api/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID || null }));

// ---------------------------------------------------------------- passwords & recovery email
function setPassword(userId, password) {
  const { hash, salt } = hashPassword(password);
  q.run('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?', hash, salt, userId);
  q.run("DELETE FROM email_tokens WHERE user_id = ? AND kind = 'reset'", userId);
}
// Sensitive account changes need the current password (if the account has one).
function requireCurrentPassword(req) {
  if (!req.user.pass_hash) return;
  rateLimit('pwcheck:' + req.user.id, 10);
  if (!verifyPassword(String(req.body.currentPassword || ''), req.user.salt, req.user.pass_hash))
    throw httpError(400, 'Your current password is wrong');
}
// One-time links sent by email. Only a hash of the token is stored; each link works once.
function issueEmailToken(userId, kind, email, ttlMs) {
  const token = crypto.randomBytes(32).toString('base64url');
  q.run('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?', userId, kind); // newest link replaces older ones
  q.run('INSERT INTO email_tokens (token_hash, user_id, kind, email, expires_at) VALUES (?, ?, ?, ?, ?)',
    sha256(token), userId, kind, email, now() + ttlMs);
  return token;
}
function takeEmailToken(token, kind) {
  const t = q.get('SELECT * FROM email_tokens WHERE token_hash = ? AND kind = ?', sha256(String(token || '')), kind);
  if (!t || t.expires_at < now()) throw httpError(400, 'This link is invalid or has expired. Please request a new one.');
  q.run('DELETE FROM email_tokens WHERE token_hash = ?', t.token_hash);
  return t;
}
const mailInBackground = (...a) => sendMail(...a).catch(e => console.error('[mail] send failed:', e.message));
const validEmail = e => e.length <= 254 && /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e);

app.post('/api/password/change', auth, wrap((req, res) => {
  requireCurrentPassword(req);
  const password = String(req.body.password || '');
  checkNewPassword(password);
  setPassword(req.user.id, password);
  // Sign out every other device.
  q.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', req.user.id, sha256(parseCookies(req.headers.cookie).sid || ''));
  res.json({ ok: true });
}));

// Always answers the same way, so it can't be used to discover which usernames or emails exist.
app.post('/api/password/forgot', wrap((req, res) => {
  rateLimit('forgot:' + req.ip, 5);
  const id = String(req.body.identifier || '').trim().slice(0, 254);
  const users = id.includes('@')
    ? q.all('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND banned = 0', id)
    : q.all('SELECT * FROM users WHERE username = ? AND banned = 0 AND email IS NOT NULL', id);
  for (const u of users) {
    const token = issueEmailToken(u.id, 'reset', u.email, 60 * 60 * 1000);
    mailInBackground(u.email, 'Reset your Session Xero password',
      `Hi ${u.username},\n\nSomeone (hopefully you) asked to reset your Session Xero password. Open this link to choose a new one:\n\n` +
      `${BASE_URL}/?reset=${token}\n\nThe link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email; your password hasn't changed.`);
  }
  res.json({ ok: true });
}));

app.post('/api/password/reset', wrap((req, res) => {
  rateLimit('reset:' + req.ip, 20);
  const password = String(req.body.password || '');
  checkNewPassword(password); // before using up the link
  const t = takeEmailToken(req.body.token, 'reset');
  const u = q.get('SELECT * FROM users WHERE id = ?', t.user_id);
  if (!u || u.banned || (u.email || '').toLowerCase() !== t.email.toLowerCase())
    throw httpError(400, 'This link is invalid or has expired. Please request a new one.');
  setPassword(u.id, password);
  q.run('DELETE FROM sessions WHERE user_id = ?', u.id); // sign out everywhere, then sign in here
  createSession(req, res, u.id);
  res.json({ ok: true });
}));

app.post('/api/account/email', auth, wrap((req, res) => {
  rateLimit('email:' + req.user.id, 10);
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!validEmail(email)) throw httpError(400, 'Enter a valid email address');
  requireCurrentPassword(req);
  const token = issueEmailToken(req.user.id, 'verify', email, 24 * 60 * 60 * 1000);
  mailInBackground(email, 'Confirm your Session Xero recovery email',
    `Hi ${req.user.username},\n\nConfirm this address as the recovery email for your Session Xero account:\n\n` +
    `${BASE_URL}/?verify=${token}\n\nThe link expires in 24 hours. If you didn't ask for this, ignore this email.`);
  res.json({ ok: true });
}));
app.post('/api/account/email/verify', wrap((req, res) => {
  const t = takeEmailToken(req.body.token, 'verify');
  q.run('UPDATE users SET email = ? WHERE id = ?', t.email, t.user_id);
  q.run("DELETE FROM email_tokens WHERE user_id = ? AND kind = 'reset'", t.user_id); // links sent to the old address stop working
  res.json({ ok: true, email: t.email });
}));
app.post('/api/account/email/remove', auth, wrap((req, res) => {
  requireCurrentPassword(req);
  q.run('UPDATE users SET email = NULL WHERE id = ?', req.user.id);
  q.run('DELETE FROM email_tokens WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Google sign-in
async function googleIdentity(req) {
  rateLimit('google:' + req.ip, 30);
  try { return await verifyGoogleToken(req.body.credential); } catch (e) { throw httpError(400, e.message); }
}
// Sign in with a linked Google account. If none is linked, the client offers to create an account.
app.post('/api/google/login', wrap(async (req, res) => {
  const g = await googleIdentity(req);
  const u = q.get('SELECT * FROM users WHERE google_sub = ?', g.sub);
  if (!u) return res.json({ needsAccount: true, email: g.email });
  if (u.banned) throw httpError(403, 'This account has been suspended');
  createSession(req, res, u.id);
  res.json({ ok: true });
}));
app.post('/api/google/register', wrap(async (req, res) => {
  const g = await googleIdentity(req);
  rateLimit('reg:' + req.ip, 20);
  if (q.get('SELECT 1 FROM users WHERE google_sub = ?', g.sub)) throw httpError(409, 'That Google account already has an account here. Sign in with Google instead.');
  const username = checkNewUsername(req.body.username);
  // No password (pass_hash ''); Google already verified the email, so it becomes the recovery address.
  const r = q.run("INSERT INTO users (username, pass_hash, salt, is_admin, google_sub, google_email, email) VALUES (?, '', '', ?, ?, ?, ?)",
    username, isAdminName(username), g.sub, g.email || null, g.email || null);
  createSession(req, res, r.lastInsertRowid);
  res.json({ ok: true });
}));
app.post('/api/google/link', auth, wrap(async (req, res) => {
  const g = await googleIdentity(req);
  const other = q.get('SELECT id FROM users WHERE google_sub = ?', g.sub);
  if (other && other.id !== req.user.id) throw httpError(409, 'That Google account is already linked to a different user');
  q.run('UPDATE users SET google_sub = ?, google_email = ? WHERE id = ?', g.sub, g.email || null, req.user.id);
  res.json({ ok: true });
}));
app.post('/api/google/unlink', auth, wrap((req, res) => {
  if (!req.user.pass_hash) throw httpError(400, 'Set a password first, or you would have no way to sign in');
  q.run('UPDATE users SET google_sub = NULL, google_email = NULL WHERE id = ?', req.user.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- profiles (public to logged-in users)
const cleanLine = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
app.put('/api/profile', auth, wrap((req, res) => {
  const displayName = cleanLine(req.body.displayName, 40);
  const pronouns = cleanLine(req.body.pronouns, 30);
  const bio = String(req.body.bio || '').replace(/\r\n/g, '\n').trim();
  if (wordCount(bio) > 300) throw httpError(400, 'Bio must be 300 words or fewer');
  if (bio.length > 3000) throw httpError(400, 'Bio is too long');
  q.run('UPDATE users SET display_name = ?, pronouns = ?, bio = ? WHERE id = ?', displayName, pronouns, bio, req.user.id);
  res.json({ ok: true });
}));
app.get('/api/users/:id', auth, wrap((req, res) => {
  const u = q.get('SELECT id, username, display_name, pronouns, bio, created_at FROM users WHERE id = ? AND banned = 0', Number(req.params.id));
  if (!u) throw httpError(404, 'User not found');
  res.json({ id: u.id, username: u.username, displayName: u.display_name, pronouns: u.pronouns, bio: u.bio, memberSince: u.created_at });
}));

app.get('/api/users/search', auth, (req, res) => {
  const term = String(req.query.q || '').trim();
  if (!term) return res.json([]);
  res.json(q.all("SELECT id, username FROM users WHERE username LIKE ? AND id != ? AND banned = 0 ORDER BY username LIMIT 10",
    term.replace(/[%_]/g, '') + '%', req.user.id));
});

// ---------------------------------------------------------------- availability
app.get('/api/availability', auth, (req, res) => {
  res.json(q.all('SELECT date, repeat, start_min AS start, end_min AS end FROM availability WHERE user_id = ? ORDER BY date, start_min', req.user.id));
});
// Local calendar date "YYYY-MM-DD" -> weekday, or null if it isn't a real date.
function weekdayOf(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d.getUTCDay() : null;
}
app.put('/api/availability', auth, wrap((req, res) => {
  const slots = Array.isArray(req.body.slots) ? req.body.slots : [];
  if (slots.length > 200) throw httpError(400, 'Too many time slots');
  for (const s of slots) {
    if (weekdayOf(s.date) === null) throw httpError(400, 'Each time slot needs a valid date');
    if (!['none', 'weekly', 'monthly'].includes(s.repeat)) throw httpError(400, 'Invalid repeat setting');
    if (![s.start, s.end].every(Number.isInteger) || s.start < 0 || s.end > 1440 || s.start >= s.end)
      throw httpError(400, 'Each time slot needs a start before its end');
  }
  db.exec('BEGIN');
  try {
    q.run('DELETE FROM availability WHERE user_id = ?', req.user.id);
    for (const s of slots) q.run('INSERT INTO availability (user_id, day, date, repeat, start_min, end_min) VALUES (?, ?, ?, ?, ?, ?)',
      req.user.id, weekdayOf(s.date), s.date, s.repeat, s.start, s.end);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- games
// Games the user is in (for their calendar)
app.get('/api/games/mine', auth, (req, res) => {
  const games = q.all('SELECT g.* FROM games g JOIN game_members m ON m.game_id = g.id WHERE m.user_id = ? ORDER BY g.start_at', req.user.id);
  res.json(games.map(g => gameSummary(g, req.user.id)));
});

// All public games (the client filters these by the user's availability).
// Closed games are unlisted, except to people already at the table.
app.get('/api/games/public', auth, (req, res) => {
  const games = q.all(`SELECT * FROM games g WHERE visibility = 'public' AND (closed = 0
    OR EXISTS (SELECT 1 FROM game_members m WHERE m.game_id = g.id AND m.user_id = ?)) ORDER BY start_at`, req.user.id);
  res.json(games.map(g => {
    const s = gameSummary(g, req.user.id);
    s.isMember = isMember(g.id, req.user.id);
    const r = q.get("SELECT status FROM join_requests WHERE game_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1", g.id, req.user.id);
    s.requestStatus = r ? r.status : null;
    return s;
  }));
});

app.post('/api/games', auth, wrap((req, res) => {
  const v = validateGameInput(req.body);
  const r = q.run(`INSERT INTO games (gm_id, title, description, start_at, duration_min, recurrence, pattern, visibility, time_zone, invite_token)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, req.user.id, v.title, v.description, v.startAt, v.duration,
    v.recurrence, v.pattern, v.visibility, v.timeZone, crypto.randomBytes(18).toString('base64url'));
  addMember(r.lastInsertRowid, req.user.id);
  res.json({ id: r.lastInsertRowid });
}));

app.get('/api/games/:id', auth, wrap((req, res) => {
  const g = getGame(req.params.id);
  const member = isMember(g.id, req.user.id);
  const out = gameSummary(g, req.user.id);
  out.isMember = member;
  if (!member) {
    if (g.visibility !== 'public') throw httpError(404, 'Game not found');
    const r = q.get("SELECT status FROM join_requests WHERE game_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1", g.id, req.user.id);
    out.requestStatus = r ? r.status : null;
    out.wasKicked = isKicked(g.id, req.user.id);
    return res.json(out);
  }
  out.members = q.all('SELECT u.id, u.username, u.display_name AS displayName, u.pronouns FROM game_members m JOIN users u ON u.id = m.user_id WHERE m.game_id = ? ORDER BY m.joined_at', g.id);
  if (g.gm_id === req.user.id) {
    out.inviteToken = g.visibility === 'private' ? null : g.invite_token;
    out.requests = q.all(`SELECT r.id, r.created_at AS createdAt, u.id AS userId, u.username, u.display_name AS displayName, u.pronouns FROM join_requests r
                          JOIN users u ON u.id = r.user_id WHERE r.game_id = ? AND r.status = 'pending' ORDER BY r.id`, g.id);
    out.invites = q.all(`SELECT i.id, u.username FROM game_invites i JOIN users u ON u.id = i.user_id
                         WHERE i.game_id = ? AND i.status = 'pending'`, g.id);
  }
  res.json(out);
}));

app.put('/api/games/:id', auth, wrap((req, res) => {
  const g = getGame(req.params.id); requireGM(g, req.user);
  const v = validateGameInput(req.body);
  q.run('UPDATE games SET title=?, description=?, start_at=?, duration_min=?, recurrence=?, pattern=?, visibility=?, time_zone=? WHERE id=?',
    v.title, v.description, v.startAt, v.duration, v.recurrence, v.pattern, v.visibility, v.timeZone, g.id);
  res.json({ ok: true });
}));

// Close to / reopen for new players. The GM can still approve pending requests and invite by username.
app.post('/api/games/:id/closed', auth, wrap((req, res) => {
  const g = getGame(req.params.id); requireGM(g, req.user);
  q.run('UPDATE games SET closed = ? WHERE id = ?', req.body.closed ? 1 : 0, g.id);
  res.json({ ok: true });
}));
const CLOSED_MSG = "This game isn't taking new players right now";

app.delete('/api/games/:id', auth, wrap((req, res) => {
  const g = getGame(req.params.id); requireGM(g, req.user);
  const members = q.all('SELECT user_id FROM game_members WHERE game_id = ? AND user_id != ?', g.id, req.user.id);
  for (const m of members) notify(m.user_id, 'game_cancelled', { gameTitle: g.title });
  q.run("DELETE FROM messages WHERE kind = 'game' AND thread_id = ?", g.id);
  q.run("DELETE FROM thread_reads WHERE kind = 'game' AND thread_id = ?", g.id);
  q.run('DELETE FROM games WHERE id = ?', g.id);
  res.json({ ok: true });
}));

app.post('/api/games/:id/regenerate-link', auth, wrap((req, res) => {
  const g = getGame(req.params.id); requireGM(g, req.user);
  const token = crypto.randomBytes(18).toString('base64url');
  q.run('UPDATE games SET invite_token = ? WHERE id = ?', token, g.id);
  res.json({ inviteToken: token });
}));

// Invite link: joining puts the game on your calendar and opens its board.
app.get('/api/invite/:token', auth, wrap((req, res) => {
  const g = q.get('SELECT * FROM games WHERE invite_token = ?', String(req.params.token));
  if (!g || g.visibility === 'private') throw httpError(404, 'This invite link is invalid or has been reset');
  res.json({ ...gameSummary(g, req.user.id), isMember: isMember(g.id, req.user.id) });
}));
app.post('/api/invite/:token/join', auth, wrap((req, res) => {
  const g = q.get('SELECT * FROM games WHERE invite_token = ?', String(req.params.token));
  if (!g || g.visibility === 'private') throw httpError(404, 'This invite link is invalid or has been reset');
  if (isKicked(g.id, req.user.id)) throw httpError(403, 'The GM removed you from this game');
  if (!isMember(g.id, req.user.id)) {
    if (g.closed) throw httpError(403, CLOSED_MSG);
    addMember(g.id, req.user.id);
    q.run("UPDATE join_requests SET status = 'approved' WHERE game_id = ? AND user_id = ? AND status = 'pending'", g.id, req.user.id);
    notify(g.gm_id, 'player_joined', { gameId: g.id, gameTitle: g.title, username: req.user.username });
  }
  res.json({ gameId: g.id });
}));

// Public game: request to join -> notifies GM and opens a DM between GM and player.
app.post('/api/games/:id/request', auth, wrap((req, res) => {
  const g = getGame(req.params.id);
  if (g.visibility !== 'public') throw httpError(404, 'Game not found');
  if (isMember(g.id, req.user.id)) throw httpError(400, "You're already in this game");
  if (isKicked(g.id, req.user.id)) throw httpError(403, 'The GM removed you from this game');
  if (g.closed) throw httpError(403, CLOSED_MSG);
  const existing = q.get("SELECT * FROM join_requests WHERE game_id = ? AND user_id = ? AND status = 'pending'", g.id, req.user.id);
  const thread = getOrCreateDm(req.user.id, g.gm_id);
  if (!existing) {
    const r = q.run('INSERT INTO join_requests (game_id, user_id) VALUES (?, ?)', g.id, req.user.id);
    const intro = String(req.body.message || '').trim().slice(0, 2000) || `Hi! I'd like to join "${g.title}".`;
    q.run("INSERT INTO messages (kind, thread_id, user_id, body) VALUES ('dm', ?, ?, ?)", thread.id, req.user.id, intro);
    notify(g.gm_id, 'join_request', { requestId: r.lastInsertRowid, gameId: g.id, gameTitle: g.title,
      username: req.user.username, userId: req.user.id, threadId: thread.id });
  }
  res.json({ ok: true, threadId: thread.id });
}));

function decideRequest(req, approve) {
  const r = q.get('SELECT * FROM join_requests WHERE id = ?', Number(req.params.id));
  if (!r) throw httpError(404, 'Request not found');
  const g = getGame(r.game_id); requireGM(g, req.user);
  if (r.status !== 'pending') throw httpError(400, 'This request was already handled');
  q.run('UPDATE join_requests SET status = ? WHERE id = ?', approve ? 'approved' : 'declined', r.id);
  if (approve) addMember(g.id, r.user_id);
  notify(r.user_id, approve ? 'request_approved' : 'request_declined', { gameId: g.id, gameTitle: g.title });
}
app.post('/api/requests/:id/approve', auth, wrap((req, res) => { decideRequest(req, true); res.json({ ok: true }); }));
app.post('/api/requests/:id/decline', auth, wrap((req, res) => { decideRequest(req, false); res.json({ ok: true }); }));

// Private games: GM invites a specific user by username.
app.post('/api/games/:id/invite', auth, wrap((req, res) => {
  const g = getGame(req.params.id); requireGM(g, req.user);
  const u = q.get('SELECT * FROM users WHERE username = ? AND banned = 0', String(req.body.username || '').trim());
  if (!u) throw httpError(404, 'No user with that username');
  if (isMember(g.id, u.id)) throw httpError(400, `${u.username} is already in this game`);
  q.run('DELETE FROM game_kicked WHERE game_id = ? AND user_id = ?', g.id, u.id); // GM explicitly re-inviting
  if (!q.get("SELECT 1 FROM game_invites WHERE game_id = ? AND user_id = ? AND status = 'pending'", g.id, u.id)) {
    const r = q.run('INSERT INTO game_invites (game_id, user_id) VALUES (?, ?)', g.id, u.id);
    notify(u.id, 'game_invite', { inviteId: r.lastInsertRowid, gameId: g.id, gameTitle: g.title, gm: req.user.username });
  }
  res.json({ ok: true });
}));
function decideInvite(req, accept) {
  const i = q.get('SELECT * FROM game_invites WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!i) throw httpError(404, 'Invite not found');
  if (i.status !== 'pending') throw httpError(400, 'This invite was already handled');
  const g = getGame(i.game_id);
  q.run('UPDATE game_invites SET status = ? WHERE id = ?', accept ? 'accepted' : 'declined', i.id);
  if (accept) addMember(g.id, req.user.id);
  notify(g.gm_id, accept ? 'invite_accepted' : 'invite_declined', { gameId: g.id, gameTitle: g.title, username: req.user.username });
  return g;
}
app.post('/api/invites/:id/accept', auth, wrap((req, res) => res.json({ gameId: decideInvite(req, true).id })));
app.post('/api/invites/:id/decline', auth, wrap((req, res) => { decideInvite(req, false); res.json({ ok: true }); }));

app.post('/api/games/:id/kick', auth, wrap((req, res) => {
  const g = getGame(req.params.id); requireGM(g, req.user);
  const userId = Number(req.body.userId);
  if (userId === g.gm_id) throw httpError(400, "The GM can't kick themselves");
  if (!isMember(g.id, userId)) throw httpError(400, 'That user is not in this game');
  q.run('DELETE FROM game_members WHERE game_id = ? AND user_id = ?', g.id, userId);
  q.run('INSERT OR IGNORE INTO game_kicked (game_id, user_id) VALUES (?, ?)', g.id, userId);
  notify(userId, 'kicked', { gameTitle: g.title });
  res.json({ ok: true });
}));

app.post('/api/games/:id/leave', auth, wrap((req, res) => {
  const g = getGame(req.params.id);
  if (g.gm_id === req.user.id) throw httpError(400, 'The GM can delete the game instead of leaving');
  q.run('DELETE FROM game_members WHERE game_id = ? AND user_id = ?', g.id, req.user.id);
  notify(g.gm_id, 'player_left', { gameId: g.id, gameTitle: g.title, username: req.user.username });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- game message boards
app.get('/api/games/:id/messages', auth, wrap((req, res) => {
  const g = getGame(req.params.id); requireMember(g, req.user);
  markRead(req.user.id, 'game', g.id);
  res.json(listMessages('game', g.id, req.user, g.gm_id === req.user.id, req.query.after));
}));
app.post('/api/games/:id/messages', auth, wrap((req, res) => {
  const g = getGame(req.params.id); requireMember(g, req.user);
  const body = validateBody(req.body.body);
  q.run("INSERT INTO messages (kind, thread_id, user_id, body) VALUES ('game', ?, ?, ?)", g.id, req.user.id, body);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- direct messages
app.get('/api/dms', auth, (req, res) => {
  const threads = q.all('SELECT * FROM dm_threads WHERE user_a = ? OR user_b = ?', req.user.id, req.user.id);
  const out = threads.map(t => {
    const other = q.get('SELECT id, username FROM users WHERE id = ?', t.user_a === req.user.id ? t.user_b : t.user_a);
    const last = q.get("SELECT * FROM messages WHERE kind = 'dm' AND thread_id = ? ORDER BY id DESC LIMIT 1", t.id);
    return { id: t.id, other, lastAt: last ? last.created_at : null,
      lastPreview: last ? (last.deleted ? 'Message deleted' : last.body.slice(0, 80)) : '' };
  }).sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  res.json(out);
});
app.post('/api/dms', auth, wrap((req, res) => {
  const u = req.body.userId
    ? q.get('SELECT * FROM users WHERE id = ?', Number(req.body.userId))
    : q.get('SELECT * FROM users WHERE username = ?', String(req.body.username || '').trim());
  if (!u || u.banned) throw httpError(404, 'No user with that username');
  res.json({ id: getOrCreateDm(req.user.id, u.id).id });
}));
app.get('/api/dms/:id', auth, wrap((req, res) => {
  const t = getDmForUser(req.params.id, req.user);
  const otherId = t.user_a === req.user.id ? t.user_b : t.user_a;
  const other = q.get('SELECT id, username, display_name AS displayName, pronouns FROM users WHERE id = ?', otherId);
  // If the viewer is a GM and the other person has pending join requests, surface them in the chat.
  const pendingRequests = q.all(`SELECT r.id, g.id AS gameId, g.title AS gameTitle FROM join_requests r
      JOIN games g ON g.id = r.game_id WHERE r.user_id = ? AND g.gm_id = ? AND r.status = 'pending'`, otherId, req.user.id);
  res.json({ id: t.id, other, pendingRequests });
}));
app.get('/api/dms/:id/messages', auth, wrap((req, res) => {
  const t = getDmForUser(req.params.id, req.user);
  markRead(req.user.id, 'dm', t.id);
  res.json(listMessages('dm', t.id, req.user, true, req.query.after)); // both participants moderate a DM
}));
app.post('/api/dms/:id/messages', auth, wrap((req, res) => {
  const t = getDmForUser(req.params.id, req.user);
  const body = validateBody(req.body.body);
  q.run("INSERT INTO messages (kind, thread_id, user_id, body) VALUES ('dm', ?, ?, ?)", t.id, req.user.id, body);
  res.json({ ok: true });
}));

// Delete a message. Game boards: author or GM. DMs: either participant.
app.delete('/api/messages/:id', auth, wrap((req, res) => {
  const m = q.get('SELECT * FROM messages WHERE id = ?', Number(req.params.id));
  if (!m) throw httpError(404, 'Message not found');
  if (m.kind === 'game') {
    const g = getGame(m.thread_id);
    if (m.user_id !== req.user.id && g.gm_id !== req.user.id) throw httpError(403, 'You can only delete your own messages');
    if (m.user_id === req.user.id) requireMember(g, req.user);
  } else {
    getDmForUser(m.thread_id, req.user);
  }
  q.run('UPDATE messages SET deleted = 1, deleted_by = ? WHERE id = ?', req.user.id, m.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- reports
app.post('/api/reports', auth, wrap((req, res) => {
  const reportedId = Number(req.body.reportedId);
  const context = String(req.body.context);
  const contextId = Number(req.body.contextId);
  const messageId = req.body.messageId ? Number(req.body.messageId) : null;
  const reason = String(req.body.reason || '').trim();
  if (!reason || reason.length > 2000) throw httpError(400, 'Please describe the problem (max 2000 characters)');
  if (reportedId === req.user.id) throw httpError(400, "You can't report yourself");
  if (context === 'dm') {
    const t = getDmForUser(contextId, req.user);
    if (t.user_a !== reportedId && t.user_b !== reportedId) throw httpError(400, 'That user is not in this conversation');
  } else if (context === 'game') {
    const g = getGame(contextId); requireMember(g, req.user);
    const inGame = isMember(g.id, reportedId) ||
      q.get("SELECT 1 FROM messages WHERE kind = 'game' AND thread_id = ? AND user_id = ?", g.id, reportedId);
    if (!inGame) throw httpError(400, 'That user is not part of this game');
  } else throw httpError(400, 'Invalid report');
  if (messageId) {
    const m = q.get('SELECT * FROM messages WHERE id = ? AND kind = ? AND thread_id = ?', messageId, context, contextId);
    if (!m) throw httpError(400, 'Message not found in this conversation');
  }
  q.run('INSERT INTO reports (reporter_id, reported_id, context, context_id, message_id, reason) VALUES (?, ?, ?, ?, ?, ?)',
    req.user.id, reportedId, context, contextId, messageId, reason);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- notifications
app.get('/api/notifications', auth, (req, res) => {
  res.json(q.all('SELECT id, type, payload, is_read AS isRead, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id)
    .map(n => ({ ...n, isRead: !!n.isRead, payload: JSON.parse(n.payload) })));
});
app.post('/api/notifications/read', auth, (req, res) => {
  q.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- admin (moderation team)
app.get('/api/admin/reports', auth, adminOnly, (req, res) => {
  const rows = q.all('SELECT * FROM reports ORDER BY (status = \'open\') DESC, id DESC LIMIT 200');
  res.json(rows.map(r => {
    const msg = r.message_id ? q.get('SELECT body, deleted, created_at FROM messages WHERE id = ?', r.message_id) : null;
    const reported = q.get('SELECT id, username, banned FROM users WHERE id = ?', r.reported_id);
    let where = '';
    if (r.context === 'game') { const g = q.get('SELECT title FROM games WHERE id = ?', r.context_id); where = g ? `Game: ${g.title}` : 'Game (deleted)'; }
    else where = 'Direct message';
    const recent = q.all('SELECT m.body, m.deleted, m.created_at, u.username FROM messages m JOIN users u ON u.id = m.user_id WHERE m.kind = ? AND m.thread_id = ? ORDER BY m.id DESC LIMIT 15', r.context, r.context_id).reverse();
    return {
      id: r.id, status: r.status, reason: r.reason, createdAt: r.created_at, where,
      reporter: publicUser(q.get('SELECT id, username FROM users WHERE id = ?', r.reporter_id)),
      reported: { id: reported.id, username: reported.username, banned: !!reported.banned },
      message: msg && { body: msg.body, deleted: !!msg.deleted, createdAt: msg.created_at },
      recent,
    };
  }));
});
app.post('/api/admin/reports/:id', auth, adminOnly, wrap((req, res) => {
  const status = String(req.body.status);
  if (!['open', 'resolved', 'dismissed'].includes(status)) throw httpError(400, 'Invalid status');
  q.run('UPDATE reports SET status = ? WHERE id = ?', status, Number(req.params.id));
  res.json({ ok: true });
}));
app.post('/api/admin/users/:id/ban', auth, adminOnly, wrap((req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw httpError(400, "You can't ban yourself");
  const banned = req.body.banned ? 1 : 0;
  q.run('UPDATE users SET banned = ? WHERE id = ?', banned, id);
  if (banned) q.run('DELETE FROM sessions WHERE user_id = ?', id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- static + SPA fallback
app.use(express.static(path.join(__dirname, 'public')));
app.get(['/join/:token', '/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Tabletop scheduler running at http://localhost:${PORT}`));
}
module.exports = app;
