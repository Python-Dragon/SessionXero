/// <reference path="../../pb_data/types.d.ts" />
// Shared helpers for Session Xero's custom API (pb_hooks/*.pb.js).
// PocketBase runs every route handler in its own JS context, so handlers `require()` this module
// rather than sharing top-level functions. Nothing here may keep state between requests.

// ---------------------------------------------------------------- request / record basics
const body = e => e.requestInfo().body || {};
const param = (e, name) => e.request.pathValue(name);
const bad = msg => new BadRequestError(msg);

function find(col, id) {
  if (!id) return null;
  try { return $app.findRecordById(col, String(id)); } catch (_) { return null; }
}
function first(col, filter, params) {
  try { return $app.findFirstRecordByFilter(col, filter, params || {}); } catch (_) { return null; }
}
const all = (col, filter, sort, params, limit) => $app.findRecordsByFilter(col, filter, sort || "", limit || 0, 0, params || {});
function create(col, data, txApp) {
  const a = txApp || $app;
  const r = new Record(a.findCollectionByNameOrId(col));
  for (const k in data) r.set(k, data[k]);
  a.save(r);
  return r;
}
// Autodate fields come back as "2026-09-30 18:12:35.925Z"; the browser wants ISO.
const iso = (r, field) => String(r.get(field || "created")).replace(" ", "T");
function sql(query, params, shape) {
  const rows = arrayOf(new DynamicModel(shape));
  $app.db().newQuery(query).bind(params || {}).all(rows);
  return rows;
}

// The signed-in site user (routes use $apis.requireAuth("users") first).
function me(e) {
  const u = e.auth;
  if (!u || u.collection().name !== "users") throw new UnauthorizedError("Please log in");
  if (u.getBool("banned")) throw new ForbiddenError("This account has been suspended");
  return u;
}
function requireAdmin(e) {
  const u = me(e);
  if (!u.getBool("is_admin")) throw new ForbiddenError("Admins only");
  return u;
}
const publicUser = u => u && { id: u.id, username: u.getString("username") };
const profileFields = u => ({ id: u.id, username: u.getString("username"), displayName: u.getString("display_name"), pronouns: u.getString("pronouns") });
function userByName(username) {
  const rows = sql("SELECT id FROM users WHERE username = {:u} COLLATE NOCASE LIMIT 1", { u: String(username || "").trim() }, { id: "" });
  return rows.length ? find("users", rows[0].id) : null;
}

const wordCount = s => (String(s).trim().match(/\S+/g) || []).length;
const cleanLine = (s, max) => String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const validEmail = s => s.length <= 254 && /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s);
function checkNewUsername(raw, exceptId) {
  const username = String(raw || "").trim();
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(username)) throw bad("Username must be 3–20 characters: letters, numbers, _ or -");
  const taken = userByName(username);
  if (taken && taken.id !== exceptId) throw new ApiError(409, "That username is taken");
  return username;
}
function checkNewPassword(p) {
  if (p.length < 8) throw bad("Password must be at least 8 characters");
  if (p.length > 200) throw bad("Password is too long");
}
// Sensitive account changes need the current password, if the account has one it chose.
function requireCurrentPassword(u, b) {
  if (u.getBool("has_password") && !u.validatePassword(String(b.currentPassword || "")))
    throw bad("Your current password is wrong");
}

function notify(userId, type, payload) {
  create("notifications", { user: userId, type, payload, is_read: false });
}

// ---------------------------------------------------------------- games & membership
function getGame(id) {
  const g = find("games", id);
  if (!g) throw new NotFoundError("Game not found");
  return g;
}
const isMember = (gameId, userId) => !!first("game_members", "game = {:g} && user = {:u}", { g: gameId, u: userId });
const isKicked = (gameId, userId) => !!first("game_kicked", "game = {:g} && user = {:u}", { g: gameId, u: userId });
function requireMember(g, u) { if (!isMember(g.id, u.id)) throw new ForbiddenError("You are not a member of this game"); }
function requireGM(g, u) { if (g.getString("gm") !== u.id) throw new ForbiddenError("Only the GM can do that"); }
function addMember(gameId, userId) {
  if (!isMember(gameId, userId)) create("game_members", { game: gameId, user: userId });
  markRead(userId, "game", gameId); // the board's history before you joined isn't "unread"
}
const lastRequest = (gameId, userId) => all("join_requests", "game = {:g} && user = {:u}", "-created", { g: gameId, u: userId }, 1)[0] || null;

// A sorted, de-duplicated list of integers in [min, max], or an error.
function intSet(list, min, max, message) {
  if (!Array.isArray(list) || !list.length || !list.every(n => Number.isInteger(n) && n >= min && n <= max)) throw bad(message);
  return [...new Set(list)].sort((a, b) => a - b);
}
function validatePattern(recurrence, p) {
  const every = () => {
    const n = p.every == null ? 1 : p.every;
    if (!Number.isInteger(n) || n < 1 || n > 12) throw bad("Repeat every 1 to 12 months");
    return n;
  };
  switch (recurrence) {
    case "none": return null;
    case "weekly": return { days: intSet(p.days, 0, 6, "Pick at least one day of the week") };
    case "monthly": return { dates: intSet(p.dates, 1, 31, "Pick at least one date of the month"), every: every() };
    case "monthly_weekday": return {
      weeks: intSet(p.weeks, 1, 5, "Pick which week(s) of the month"),
      weekdays: intSet(p.weekdays, 0, 6, "Pick at least one day of the week"), every: every() };
    default: throw bad("Invalid recurrence");
  }
}
function validateGameInput(b) {
  const title = String(b.title || "").trim();
  const description = String(b.description || "").trim();
  const startAt = new Date(b.startAt);
  const duration = Number(b.durationMin);
  const recurrence = String(b.recurrence || "none");
  const visibility = String(b.visibility || "public");
  // Goja has no Intl, so check the shape of an IANA zone name; the browser falls back if it's unknown.
  const timeZone = String(b.timeZone || "").slice(0, 64);
  if (timeZone && !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(timeZone)) throw bad("Invalid time zone");
  if (!title || title.length > 100) throw bad("Title is required (max 100 characters)");
  if (wordCount(description) > 500) throw bad("Description must be 500 words or fewer");
  if (description.length > 6000) throw bad("Description is too long");
  if (isNaN(startAt.getTime())) throw bad("A valid date and time is required");
  if (!Number.isInteger(duration) || duration < 15 || duration > 24 * 60) throw bad("Duration must be between 15 minutes and 24 hours");
  if (!["public", "invite", "private"].includes(visibility)) throw bad("Invalid visibility");
  const pattern = validatePattern(recurrence, b.pattern || {});
  return { title, description, start_at: startAt.toISOString(), duration_min: duration, recurrence, visibility, time_zone: timeZone, pattern };
}

function gameSummary(g, userId) {
  const recurrence = g.getString("recurrence");
  return {
    id: g.id, title: g.getString("title"), description: g.getString("description"), startAt: g.getString("start_at"),
    durationMin: g.getInt("duration_min"), recurrence, visibility: g.getString("visibility"),
    timeZone: g.getString("time_zone") || null, pattern: recurrence === "none" ? null : (g.get("pattern") || null),
    closed: g.getBool("closed"), gm: publicUser(find("users", g.getString("gm"))),
    memberCount: $app.countRecords("game_members", $dbx.hashExp({ game: g.id })), isGM: g.getString("gm") === userId,
  };
}

// ---------------------------------------------------------------- messaging
function getOrCreateDm(u1, u2) {
  if (u1 === u2) throw bad("You can't message yourself");
  const pair = u1 < u2 ? { a: u1, b: u2 } : { a: u2, b: u1 };
  return first("dm_threads", "user_a = {:a} && user_b = {:b}", pair) || create("dm_threads", { user_a: pair.a, user_b: pair.b });
}
function getDmForUser(threadId, u) {
  const t = find("dm_threads", threadId);
  if (!t || (t.getString("user_a") !== u.id && t.getString("user_b") !== u.id)) throw new NotFoundError("Conversation not found");
  return t;
}
function validateBody(text) {
  const b = String(text || "").trim();
  if (!b) throw bad("Message is empty");
  if (b.length > 2000) throw bad("Message is too long (max 2000 characters)");
  return b;
}
function postMessage(kind, threadId, userId, text) {
  return create("messages", { kind, thread_id: threadId, user: userId, body: text, deleted: false });
}
function listMessages(kind, threadId, viewer, canModerate) {
  const authors = {};
  return all("messages", "kind = {:k} && thread_id = {:t}", "created,id", { k: kind, t: threadId }, 1000).map(m => {
    const uid = m.getString("user"), deleted = m.getBool("deleted");
    if (!(uid in authors)) authors[uid] = publicUser(find("users", uid)) || { id: uid, username: "(deleted user)" };
    return { id: m.id, author: authors[uid], createdAt: iso(m), deleted, body: deleted ? null : m.getString("body"),
      canDelete: !deleted && (uid === viewer.id || canModerate) };
  });
}

// ---------------------------------------------------------------- unread tracking
// Remember the newest message the user has seen in a thread (called whenever they load it).
function markRead(userId, kind, threadId) {
  const newest = sql("SELECT COALESCE(MAX(created), '') AS m FROM messages WHERE kind = {:k} AND thread_id = {:t}",
    { k: kind, t: threadId }, { m: "" })[0].m;
  const r = first("thread_reads", "user = {:u} && kind = {:k} && thread_id = {:t}", { u: userId, k: kind, t: threadId });
  if (!r) create("thread_reads", { user: userId, kind, thread_id: threadId, last_read_at: newest });
  else if (r.getString("last_read_at") < newest) { r.set("last_read_at", newest); $app.save(r); }
}
// Messages from other people, not deleted, newer than what the user has seen, in DMs they're in
// and boards of games they belong to.
function unreadCounts(userId) {
  const rows = sql(`
    SELECT m.kind AS kind, m.thread_id AS thread, COUNT(*) AS n FROM messages m
    LEFT JOIN thread_reads r ON r.user = {:u} AND r.kind = m.kind AND r.thread_id = m.thread_id
    WHERE m.user != {:u} AND m.deleted = 0 AND m.created > COALESCE(r.last_read_at, '') AND (
      (m.kind = 'dm' AND m.thread_id IN (SELECT id FROM dm_threads WHERE user_a = {:u} OR user_b = {:u})) OR
      (m.kind = 'game' AND m.thread_id IN (SELECT game FROM game_members WHERE user = {:u})))
    GROUP BY m.kind, m.thread_id`, { u: userId }, { kind: "", thread: "", n: 0 });
  const out = { total: 0, dm: {}, game: {} };
  for (const r of rows) { out[r.kind][r.thread] = r.n; out.total += r.n; }
  return out;
}

module.exports = {
  body, param, bad, find, first, all, create, iso, sql, me, requireAdmin, publicUser, profileFields, userByName,
  wordCount, cleanLine, validEmail, checkNewUsername, checkNewPassword, requireCurrentPassword, notify,
  getGame, isMember, isKicked, requireMember, requireGM, addMember, lastRequest, validateGameInput, gameSummary,
  getOrCreateDm, getDmForUser, validateBody, postMessage, listMessages, markRead, unreadCounts,
};
