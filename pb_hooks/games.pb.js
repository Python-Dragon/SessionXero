/// <reference path="../pb_data/types.d.ts" />
// Game routes: hosting, listing, invites (link / by username), join requests, kicking, leaving.

// Games the user is in (for their calendar).
routerAdd("GET", "/api/app/games/mine", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const games = c.all("game_members", "user = {:u}", "", { u: u.id }).map(m => c.find("games", m.getString("game"))).filter(Boolean);
  games.sort((a, b) => a.getString("start_at") < b.getString("start_at") ? -1 : 1);
  return e.json(200, games.map(g => c.gameSummary(g, u.id)));
}, $apis.requireAuth("users"));

// All public games (the browser filters them by the user's availability).
// Closed games are unlisted, except to people already at the table.
routerAdd("GET", "/api/app/games/public", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const out = [];
  for (const g of c.all("games", "visibility = 'public'", "start_at")) {
    const member = c.isMember(g.id, u.id);
    if (g.getBool("closed") && !member) continue;
    const r = c.lastRequest(g.id, u.id);
    out.push({ ...c.gameSummary(g, u.id), isMember: member, requestStatus: r ? r.getString("status") : null });
  }
  return e.json(200, out);
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/app/games", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const v = c.validateGameInput(c.body(e));
  const g = c.create("games", { ...v, gm: u.id, closed: false, invite_token: $security.randomString(24) });
  c.addMember(g.id, u.id);
  return e.json(200, { id: g.id });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/app/games/{id}", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.getGame(c.param(e, "id"));
  const member = c.isMember(g.id, u.id);
  const out = { ...c.gameSummary(g, u.id), isMember: member };
  if (!member) {
    if (g.getString("visibility") !== "public") throw new NotFoundError("Game not found");
    const r = c.lastRequest(g.id, u.id);
    out.requestStatus = r ? r.getString("status") : null;
    out.wasKicked = c.isKicked(g.id, u.id);
    return e.json(200, out);
  }
  out.members = c.all("game_members", "game = {:g}", "created", { g: g.id })
    .map(m => c.find("users", m.getString("user"))).filter(Boolean).map(c.profileFields);
  if (g.getString("gm") === u.id) {
    out.inviteToken = g.getString("visibility") === "private" ? null : g.getString("invite_token");
    out.requests = c.all("join_requests", "game = {:g} && status = 'pending'", "created", { g: g.id }).map(r => {
      const ru = c.find("users", r.getString("user"));
      return ru && { id: r.id, createdAt: c.iso(r), userId: ru.id, username: ru.getString("username"),
        displayName: ru.getString("display_name"), pronouns: ru.getString("pronouns") };
    }).filter(Boolean);
    out.invites = c.all("game_invites", "game = {:g} && status = 'pending'", "created", { g: g.id }).map(i => {
      const iu = c.find("users", i.getString("user"));
      return iu && { id: i.id, username: iu.getString("username") };
    }).filter(Boolean);
  }
  return e.json(200, out);
}, $apis.requireAuth("users"));

routerAdd("PUT", "/api/app/games/{id}", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.getGame(c.param(e, "id"));
  c.requireGM(g, u);
  const v = c.validateGameInput(c.body(e));
  for (const k in v) g.set(k, v[k]);
  $app.save(g);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("DELETE", "/api/app/games/{id}", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.getGame(c.param(e, "id"));
  c.requireGM(g, u);
  const title = g.getString("title");
  for (const m of c.all("game_members", "game = {:g} && user != {:u}", "", { g: g.id, u: u.id }))
    c.notify(m.getString("user"), "game_cancelled", { gameTitle: title });
  $app.runInTransaction((tx) => {
    // The board's messages and read markers aren't relations, so remove them by hand; the rest cascades.
    for (const m of tx.findRecordsByFilter("messages", "kind = 'game' && thread_id = {:g}", "", 0, 0, { g: g.id })) tx.delete(m);
    for (const r of tx.findRecordsByFilter("thread_reads", "kind = 'game' && thread_id = {:g}", "", 0, 0, { g: g.id })) tx.delete(r);
    tx.delete(tx.findRecordById("games", g.id));
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/app/games/{id}/regenerate-link", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.getGame(c.param(e, "id"));
  c.requireGM(g, u);
  g.set("invite_token", $security.randomString(24));
  $app.save(g);
  return e.json(200, { inviteToken: g.getString("invite_token") });
}, $apis.requireAuth("users"));

// Close to / reopen for new players. The GM can still approve pending requests and invite by username.
routerAdd("POST", "/api/app/games/{id}/closed", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.getGame(c.param(e, "id"));
  c.requireGM(g, u);
  g.set("closed", !!c.body(e).closed);
  $app.save(g);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------------------------------------------------------------- invite links
routerAdd("GET", "/api/app/invite/{token}", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.first("games", "invite_token = {:t}", { t: c.param(e, "token") });
  if (!g || g.getString("visibility") === "private") throw new NotFoundError("This invite link is invalid or has been reset");
  return e.json(200, { ...c.gameSummary(g, u.id), isMember: c.isMember(g.id, u.id) });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/app/invite/{token}/join", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.first("games", "invite_token = {:t}", { t: c.param(e, "token") });
  if (!g || g.getString("visibility") === "private") throw new NotFoundError("This invite link is invalid or has been reset");
  if (c.isKicked(g.id, u.id)) throw new ForbiddenError("The GM removed you from this game");
  if (!c.isMember(g.id, u.id)) {
    if (g.getBool("closed")) throw new ForbiddenError("This game isn't taking new players right now");
    c.addMember(g.id, u.id);
    for (const r of c.all("join_requests", "game = {:g} && user = {:u} && status = 'pending'", "", { g: g.id, u: u.id })) {
      r.set("status", "approved"); $app.save(r);
    }
    c.notify(g.getString("gm"), "player_joined", { gameId: g.id, gameTitle: g.getString("title"), username: u.getString("username") });
  }
  return e.json(200, { gameId: g.id });
}, $apis.requireAuth("users"));

// ---------------------------------------------------------------- join requests (public games)
// Requesting notifies the GM and opens a DM with the player's intro; it doesn't add them yet.
routerAdd("POST", "/api/app/games/{id}/request", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.getGame(c.param(e, "id"));
  if (g.getString("visibility") !== "public") throw new NotFoundError("Game not found");
  if (c.isMember(g.id, u.id)) throw c.bad("You're already in this game");
  if (c.isKicked(g.id, u.id)) throw new ForbiddenError("The GM removed you from this game");
  if (g.getBool("closed")) throw new ForbiddenError("This game isn't taking new players right now");
  const gmId = g.getString("gm");
  const thread = c.getOrCreateDm(u.id, gmId);
  if (!c.first("join_requests", "game = {:g} && user = {:u} && status = 'pending'", { g: g.id, u: u.id })) {
    const r = c.create("join_requests", { game: g.id, user: u.id, status: "pending" });
    const intro = String(c.body(e).message || "").trim().slice(0, 2000) || `Hi! I'd like to join "${g.getString("title")}".`;
    c.postMessage("dm", thread.id, u.id, intro);
    c.notify(gmId, "join_request", { requestId: r.id, gameId: g.id, gameTitle: g.getString("title"),
      username: u.getString("username"), userId: u.id, threadId: thread.id });
  }
  return e.json(200, { ok: true, threadId: thread.id });
}, $apis.requireAuth("users"));

for (const [action, approve] of [["approve", true], ["decline", false]]) {
  routerAdd("POST", `/api/app/requests/{id}/${action}`, (e) => {
    const c = require(`${__hooks}/lib/core.js`);
    const approving = e.request.url.path.endsWith("/approve");
    const u = c.me(e);
    const r = c.find("join_requests", c.param(e, "id"));
    if (!r) throw new NotFoundError("Request not found");
    const g = c.getGame(r.getString("game"));
    c.requireGM(g, u);
    if (r.getString("status") !== "pending") throw c.bad("This request was already handled");
    r.set("status", approving ? "approved" : "declined");
    $app.save(r);
    if (approving) c.addMember(g.id, r.getString("user"));
    c.notify(r.getString("user"), approving ? "request_approved" : "request_declined", { gameId: g.id, gameTitle: g.getString("title") });
    return e.json(200, { ok: true });
  }, $apis.requireAuth("users"));
}

// ---------------------------------------------------------------- invites by username (the GM's choice)
routerAdd("POST", "/api/app/games/{id}/invite", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.getGame(c.param(e, "id"));
  c.requireGM(g, u);
  const target = c.userByName(c.body(e).username);
  if (!target || target.getBool("banned")) throw new NotFoundError("No user with that username");
  if (c.isMember(g.id, target.id)) throw c.bad(`${target.getString("username")} is already in this game`);
  const kicked = c.first("game_kicked", "game = {:g} && user = {:u}", { g: g.id, u: target.id });
  if (kicked) $app.delete(kicked); // the GM is explicitly re-inviting them
  if (!c.first("game_invites", "game = {:g} && user = {:u} && status = 'pending'", { g: g.id, u: target.id })) {
    const i = c.create("game_invites", { game: g.id, user: target.id, status: "pending" });
    c.notify(target.id, "game_invite", { inviteId: i.id, gameId: g.id, gameTitle: g.getString("title"), gm: u.getString("username") });
  }
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

for (const action of ["accept", "decline"]) {
  routerAdd("POST", `/api/app/invites/{id}/${action}`, (e) => {
    const c = require(`${__hooks}/lib/core.js`);
    const accepting = e.request.url.path.endsWith("/accept");
    const u = c.me(e);
    const i = c.find("game_invites", c.param(e, "id"));
    if (!i || i.getString("user") !== u.id) throw new NotFoundError("Invite not found");
    if (i.getString("status") !== "pending") throw c.bad("This invite was already handled");
    const g = c.getGame(i.getString("game"));
    i.set("status", accepting ? "accepted" : "declined");
    $app.save(i);
    if (accepting) c.addMember(g.id, u.id);
    c.notify(g.getString("gm"), accepting ? "invite_accepted" : "invite_declined",
      { gameId: g.id, gameTitle: g.getString("title"), username: u.getString("username") });
    return e.json(200, accepting ? { gameId: g.id } : { ok: true });
  }, $apis.requireAuth("users"));
}

// ---------------------------------------------------------------- kicking and leaving
routerAdd("POST", "/api/app/games/{id}/kick", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.getGame(c.param(e, "id"));
  c.requireGM(g, u);
  const userId = String(c.body(e).userId || "");
  if (userId === g.getString("gm")) throw c.bad("The GM can't kick themselves");
  const m = c.first("game_members", "game = {:g} && user = {:u}", { g: g.id, u: userId });
  if (!m) throw c.bad("That user is not in this game");
  $app.delete(m);
  if (!c.isKicked(g.id, userId)) c.create("game_kicked", { game: g.id, user: userId });
  c.notify(userId, "kicked", { gameTitle: g.getString("title") });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/app/games/{id}/leave", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const g = c.getGame(c.param(e, "id"));
  if (g.getString("gm") === u.id) throw c.bad("The GM can delete the game instead of leaving");
  const m = c.first("game_members", "game = {:g} && user = {:u}", { g: g.id, u: u.id });
  if (m) $app.delete(m);
  c.notify(g.getString("gm"), "player_left", { gameId: g.id, gameTitle: g.getString("title"), username: u.getString("username") });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
