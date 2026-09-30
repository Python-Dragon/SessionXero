/// <reference path="../pb_data/types.d.ts" />
// Messaging routes: game boards, DMs, deleting, reports, notifications, and the admin team's moderation.

// ---------------------------------------------------------------- game boards
routerAdd("GET", "/api/app/games/{id}/messages", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.getGame(c.param(e, "id"));
  c.requireMember(g, u);
  c.markRead(u.id, "game", g.id);
  return e.json(200, c.listMessages("game", g.id, u, g.getString("gm") === u.id));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/app/games/{id}/messages", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.getGame(c.param(e, "id"));
  c.requireMember(g, u);
  c.postMessage("game", g.id, u.id, c.validateBody(c.body(e).body));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------------------------------------------------------------- direct messages
routerAdd("GET", "/api/app/dms", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const out = c.all("dm_threads", "user_a = {:u} || user_b = {:u}", "", { u: u.id }).map(t => {
    const otherId = t.getString("user_a") === u.id ? t.getString("user_b") : t.getString("user_a");
    const last = c.all("messages", "kind = 'dm' && thread_id = {:t}", "-created,-id", { t: t.id }, 1)[0];
    return { id: t.id, other: c.publicUser(c.find("users", otherId)) || { id: otherId, username: "(deleted user)" },
      lastAt: last ? c.iso(last) : null,
      lastPreview: last ? (last.getBool("deleted") ? "Message deleted" : last.getString("body").slice(0, 80)) : "" };
  });
  out.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
  return e.json(200, out);
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/app/dms", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e), b = c.body(e);
  const other = b.userId ? c.find("users", b.userId) : c.userByName(b.username);
  if (!other || other.getBool("banned")) throw new NotFoundError("No user with that username");
  return e.json(200, { id: c.getOrCreateDm(u.id, other.id).id });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/app/dms/{id}", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const t = c.getDmForUser(c.param(e, "id"), u);
  const otherId = t.getString("user_a") === u.id ? t.getString("user_b") : t.getString("user_a");
  const other = c.find("users", otherId);
  // If the viewer is a GM and the other person asked to join one of their games, show it in the chat.
  const pendingRequests = c.all("join_requests", "user = {:o} && status = 'pending' && game.gm = {:me}", "created", { o: otherId, me: u.id })
    .map(r => { const g = c.find("games", r.getString("game")); return g && { id: r.id, gameId: g.id, gameTitle: g.getString("title") }; })
    .filter(Boolean);
  return e.json(200, { id: t.id, other: other ? c.profileFields(other) : { id: otherId, username: "(deleted user)" }, pendingRequests });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/app/dms/{id}/messages", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const t = c.getDmForUser(c.param(e, "id"), u);
  c.markRead(u.id, "dm", t.id);
  return e.json(200, c.listMessages("dm", t.id, u, true)); // both people can moderate a DM
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/app/dms/{id}/messages", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const t = c.getDmForUser(c.param(e, "id"), u);
  c.postMessage("dm", t.id, u.id, c.validateBody(c.body(e).body));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Delete a message (kept for moderators, hidden for everyone). Boards: author or GM. DMs: either person.
routerAdd("DELETE", "/api/app/messages/{id}", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const m = c.find("messages", c.param(e, "id"));
  if (!m) throw new NotFoundError("Message not found");
  if (m.getString("kind") === "game") {
    const g = c.getGame(m.getString("thread_id"));
    const mine = m.getString("user") === u.id;
    if (!mine && g.getString("gm") !== u.id) throw new ForbiddenError("You can only delete your own messages");
    if (mine) c.requireMember(g, u);
  } else c.getDmForUser(m.getString("thread_id"), u);
  m.set("deleted", true);
  m.set("deleted_by", u.id);
  $app.save(m);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------------------------------------------------------------- reports
routerAdd("POST", "/api/app/reports", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e), b = c.body(e);
  const reportedId = String(b.reportedId || ""), context = String(b.context || ""), contextId = String(b.contextId || "");
  const messageId = b.messageId ? String(b.messageId) : "";
  const reason = String(b.reason || "").trim();
  if (!reason || reason.length > 2000) throw c.bad("Please describe the problem (max 2000 characters)");
  if (reportedId === u.id) throw c.bad("You can't report yourself");
  if (!c.find("users", reportedId)) throw c.bad("That user doesn't exist");
  if (context === "dm") {
    const t = c.getDmForUser(contextId, u);
    if (t.getString("user_a") !== reportedId && t.getString("user_b") !== reportedId) throw c.bad("That user is not in this conversation");
  } else if (context === "game") {
    const g = c.getGame(contextId);
    c.requireMember(g, u);
    const inGame = c.isMember(g.id, reportedId) || c.first("messages", "kind = 'game' && thread_id = {:g} && user = {:u}", { g: g.id, u: reportedId });
    if (!inGame) throw c.bad("That user is not part of this game");
  } else throw c.bad("Invalid report");
  if (messageId && !c.first("messages", "id = {:m} && kind = {:k} && thread_id = {:t}", { m: messageId, k: context, t: contextId }))
    throw c.bad("Message not found in this conversation");
  c.create("reports", { reporter: u.id, reported: reportedId, context, context_id: contextId, message_id: messageId, reason, status: "open" });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------------------------------------------------------------- notifications
routerAdd("GET", "/api/app/notifications", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  return e.json(200, c.all("notifications", "user = {:u}", "-created,-id", { u: u.id }, 50).map(n => ({
    id: n.id, type: n.getString("type"), payload: n.get("payload") || {}, isRead: n.getBool("is_read"), createdAt: c.iso(n) })));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/app/notifications/read", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  $app.db().newQuery("UPDATE notifications SET is_read = 1 WHERE user = {:u} AND is_read = 0").bind({ u: u.id }).execute();
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------------------------------------------------------------- admin (moderation team)
routerAdd("GET", "/api/app/admin/reports", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  c.requireAdmin(e);
  const reports = c.all("reports", "id != ''", "-created", {}, 200);
  reports.sort((a, b) => (b.getString("status") === "open") - (a.getString("status") === "open")); // open first, stable
  return e.json(200, reports.map(r => {
    const context = r.getString("context"), contextId = r.getString("context_id");
    const msg = r.getString("message_id") ? c.find("messages", r.getString("message_id")) : null;
    const reported = c.find("users", r.getString("reported"));
    let where = "Direct message";
    if (context === "game") { const g = c.find("games", contextId); where = g ? `Game: ${g.getString("title")}` : "Game (deleted)"; }
    const recent = c.all("messages", "kind = {:k} && thread_id = {:t}", "-created,-id", { k: context, t: contextId }, 15).reverse().map(m => {
      const a = c.find("users", m.getString("user"));
      return { body: m.getString("body"), deleted: m.getBool("deleted"), createdAt: c.iso(m), username: a ? a.getString("username") : "(deleted user)" };
    });
    return {
      id: r.id, status: r.getString("status"), reason: r.getString("reason"), createdAt: c.iso(r), where,
      reporter: c.publicUser(c.find("users", r.getString("reporter"))),
      reported: reported ? { id: reported.id, username: reported.getString("username"), banned: reported.getBool("banned") } : null,
      message: msg && { body: msg.getString("body"), deleted: msg.getBool("deleted"), createdAt: c.iso(msg) },
      recent,
    };
  }));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/app/admin/reports/{id}", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  c.requireAdmin(e);
  const status = String(c.body(e).status);
  if (!["open", "resolved", "dismissed"].includes(status)) throw c.bad("Invalid status");
  const r = c.find("reports", c.param(e, "id"));
  if (!r) throw new NotFoundError("Report not found");
  r.set("status", status);
  $app.save(r);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/app/admin/users/{id}/ban", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const admin = c.requireAdmin(e);
  const target = c.find("users", c.param(e, "id"));
  if (!target) throw new NotFoundError("User not found");
  if (target.id === admin.id) throw c.bad("You can't ban yourself");
  const banned = !!c.body(e).banned;
  target.set("banned", banned);
  if (banned) target.refreshTokenKey(); // signs them out everywhere immediately
  $app.save(target);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
