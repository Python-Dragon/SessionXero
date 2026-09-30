/// <reference path="../pb_data/types.d.ts" />
// Account routes: current user, profiles, availability, passwords, recovery email, Google link.
// Signing up, logging in and Google sign-in themselves use PocketBase's built-in auth API.

routerAdd("GET", "/api/app/me", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const google = $app.findAllExternalAuthsByRecord(u).find(x => x && x.provider() === "google");
  return e.json(200, {
    ...c.profileFields(u), bio: u.getString("bio"), isAdmin: u.getBool("is_admin"),
    unread: $app.countRecords("notifications", $dbx.hashExp({ user: u.id, is_read: false })),
    unreadMessages: c.unreadCounts(u.id).total,
    hasPassword: u.getBool("has_password"),
    // The recovery email only counts once confirmed; until then it's "pending".
    email: u.verified() && u.email() ? u.email() : null,
    pendingEmail: !u.verified() && u.email() ? u.email() : null,
    googleLinked: !!google,
  });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/app/unread", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  return e.json(200, c.unreadCounts(c.me(e).id));
}, $apis.requireAuth("users"));

// ---------------------------------------------------------------- profiles (public to logged-in users)
routerAdd("PUT", "/api/app/profile", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e), b = c.body(e);
  const bio = String(b.bio || "").replace(/\r\n/g, "\n").trim();
  if (c.wordCount(bio) > 300) throw c.bad("Bio must be 300 words or fewer");
  if (bio.length > 3000) throw c.bad("Bio is too long");
  u.set("display_name", c.cleanLine(b.displayName, 40));
  u.set("pronouns", c.cleanLine(b.pronouns, 30));
  u.set("bio", bio);
  $app.save(u);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Used right after creating an account with Google, which starts with a generated username.
routerAdd("PUT", "/api/app/username", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  u.set("username", c.checkNewUsername(c.body(e).username, u.id));
  $app.save(u);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/app/users/search", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const term = String(e.request.url.query().get("q") || "").trim().replace(/[%_]/g, "");
  if (!term) return e.json(200, []);
  const rows = c.sql(`SELECT id, username FROM users WHERE username LIKE {:t} AND id != {:me} AND banned = 0
                      ORDER BY username COLLATE NOCASE LIMIT 10`, { t: term + "%", me: u.id }, { id: "", username: "" });
  return e.json(200, rows);
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/app/users/{id}", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  c.me(e);
  const u = c.find("users", c.param(e, "id"));
  if (!u || u.getBool("banned")) throw new NotFoundError("User not found");
  return e.json(200, { ...c.profileFields(u), bio: u.getString("bio"), memberSince: c.iso(u) });
}, $apis.requireAuth("users"));

// ---------------------------------------------------------------- availability
routerAdd("GET", "/api/app/availability", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  return e.json(200, c.all("availability", "user = {:u}", "date,start_min", { u: u.id }).map(a => ({
    date: a.getString("date"), repeat: a.getString("repeat"), start: a.getInt("start_min"), end: a.getInt("end_min") })));
}, $apis.requireAuth("users"));

routerAdd("PUT", "/api/app/availability", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  const slots = Array.isArray(c.body(e).slots) ? c.body(e).slots : [];
  if (slots.length > 200) throw c.bad("Too many time slots");
  const realDate = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  };
  for (const s of slots) {
    if (!realDate(s.date)) throw c.bad("Each time slot needs a valid date");
    if (!["none", "weekly", "monthly"].includes(s.repeat)) throw c.bad("Invalid repeat setting");
    if (![s.start, s.end].every(Number.isInteger) || s.start < 0 || s.end > 1440 || s.start >= s.end)
      throw c.bad("Each time slot needs a start before its end");
  }
  // Replace the whole set atomically.
  $app.runInTransaction((tx) => {
    for (const old of tx.findRecordsByFilter("availability", "user = {:u}", "", 0, 0, { u: u.id })) tx.delete(old);
    for (const s of slots) c.create("availability", { user: u.id, date: s.date, repeat: s.repeat, start_min: s.start, end_min: s.end }, tx);
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------------------------------------------------------------- passwords & recovery email
routerAdd("POST", "/api/app/password/change", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e), b = c.body(e);
  c.requireCurrentPassword(u, b);
  const password = String(b.password || "");
  c.checkNewPassword(password);
  u.setPassword(password); // also rotates the token key, which signs out every other device
  u.set("has_password", true);
  $app.save(u);
  return $apis.recordAuthResponse(e, u, "", null); // a fresh token for this device
}, $apis.requireAuth("users"));

// Reset by username or recovery email. Always answers the same way, so it can't reveal who has an account.
// Only a confirmed recovery email gets a link (a typo'd, unconfirmed address never receives one).
routerAdd("POST", "/api/app/password/forgot", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const id = String(c.body(e).identifier || "").trim().slice(0, 254);
  const u = id.includes("@") ? c.first("users", "email = {:v}", { v: id.toLowerCase() }) : c.userByName(id);
  if (u && u.verified() && u.email() && !u.getBool("banned")) {
    try { $mails.sendRecordPasswordReset($app, u); } catch (err) { console.log("[mail] password reset failed:", err); }
  }
  return e.json(200, { ok: true });
});

routerAdd("POST", "/api/app/account/email", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e), b = c.body(e);
  const email = String(b.email || "").trim().toLowerCase();
  if (!c.validEmail(email)) throw c.bad("Enter a valid email address");
  c.requireCurrentPassword(u, b);
  const other = c.first("users", "email = {:v} && id != {:id}", { v: email, id: u.id });
  if (other && other.verified()) throw c.bad("That email is already used by another account");
  // Someone else typed this address but never proved it's theirs: that claim doesn't block the real owner.
  // (Whoever clicks the confirmation link in that inbox ends up with it.)
  if (other) c.releaseUnverifiedEmail(other);
  u.setEmail(email);
  u.setVerified(false); // becomes the recovery email once the link is clicked
  $app.save(u);
  try { $mails.sendRecordVerification($app, u); } catch (err) { console.log("[mail] verification failed:", err); }
  return $apis.recordAuthResponse(e, u, "", null); // changing the email rotates the token
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/app/account/email/remove", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  c.requireCurrentPassword(u, c.body(e));
  u.setEmail("");
  u.setVerified(false);
  $app.save(u);
  return $apis.recordAuthResponse(e, u, "", null);
}, $apis.requireAuth("users"));

// Linking Google happens by signing in with Google while logged in (PocketBase links it automatically).
routerAdd("POST", "/api/app/google/unlink", (e) => {
  const c = require(`${__hooks}/lib/core.js`);
  const u = c.me(e);
  if (!u.getBool("has_password")) throw c.bad("Set a password first, or you would have no way to sign in");
  for (const ext of $app.findAllExternalAuthsByRecord(u)) if (ext && ext.provider() === "google") $app.delete(ext);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
