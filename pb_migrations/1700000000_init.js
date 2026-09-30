/// <reference path="../pb_data/types.d.ts" />
// Session Xero schema. Every collection except `users` is superuser-only (all API rules null):
// the site reads and writes them only through the custom routes in pb_hooks, which enforce
// who may see or change what. Ids are PocketBase's 15-character string ids.
migrate((app) => {
  // ---------------------------------------------------------------- users (auth collection)
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "username", required: true, min: 3, max: 20, pattern: "^[A-Za-z0-9_-]+$" }));
  users.fields.add(new TextField({ name: "display_name", max: 40 }));   // preferred name
  users.fields.add(new TextField({ name: "pronouns", max: 30 }));
  users.fields.add(new TextField({ name: "bio", max: 3000 }));
  users.fields.add(new BoolField({ name: "is_admin" }));                  // moderation team
  users.fields.add(new BoolField({ name: "banned" }));
  // Accounts created with Google get a random password they don't know; this says whether they chose one.
  users.fields.add(new BoolField({ name: "has_password" }));
  users.indexes.push("CREATE UNIQUE INDEX idx_users_username ON users (username COLLATE NOCASE)");
  users.fields.getByName("email").required = false;                     // the recovery email is optional
  users.passwordAuth.identityFields = ["username", "email"];
  users.authAlert.enabled = false;                                       // no "new login" emails
  // Anyone can sign up, but not grant themselves admin/banned/verified. Everything else is custom routes.
  users.createRule = "@request.body.is_admin:isset = false && @request.body.banned:isset = false && " +
    "@request.body.verified:isset = false && @request.body.email:isset = false";
  users.listRule = null;
  users.viewRule = "id = @request.auth.id";
  users.updateRule = null;
  users.deleteRule = null;
  // Links in emails open the site itself, which finishes the flow (see pb_public/app.js boot()).
  users.resetPasswordTemplate.subject = "Reset your {APP_NAME} password";
  users.resetPasswordTemplate.body =
    "<p>Hi,</p><p>Someone (hopefully you) asked to reset your {APP_NAME} password. Open this link to choose a new one:</p>" +
    '<p><a href="{APP_URL}/?reset={TOKEN}">{APP_URL}/?reset={TOKEN}</a></p>' +
    "<p>If you didn't ask for this, you can ignore this email; your password hasn't changed.</p>";
  users.verificationTemplate.subject = "Confirm your {APP_NAME} recovery email";
  users.verificationTemplate.body =
    "<p>Hi,</p><p>Confirm this address as the recovery email for your {APP_NAME} account:</p>" +
    '<p><a href="{APP_URL}/?verify={TOKEN}">{APP_URL}/?verify={TOKEN}</a></p>' +
    "<p>If you didn't ask for this, ignore this email.</p>";
  app.save(users);

  const base = (name, fields, indexes) => {
    const c = new Collection({ type: "base", name, fields, indexes: indexes || [],
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null });
    app.save(c);
    return c;
  };
  const rel = (name, target, extra) => Object.assign({ name, type: "relation", collectionId: target.id, maxSelect: 1, cascadeDelete: true, required: true }, extra || {});
  const created = { name: "created", type: "autodate", onCreate: true, onUpdate: false };

  // ---------------------------------------------------------------- availability
  // A window anchored to a local calendar date that repeats none | weekly | monthly.
  base("availability", [
    rel("user", users),
    { name: "date", type: "text", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, // local YYYY-MM-DD
    { name: "repeat", type: "select", values: ["none", "weekly", "monthly"], maxSelect: 1, required: true },
    { name: "start_min", type: "number", onlyInt: true, min: 0, max: 1440 },          // minutes since local midnight
    { name: "end_min", type: "number", onlyInt: true, min: 0, max: 1440 },
  ], ["CREATE INDEX idx_availability_user ON availability (user)"]);

  // ---------------------------------------------------------------- games
  const games = base("games", [
    rel("gm", users),
    { name: "title", type: "text", required: true, max: 100 },
    { name: "description", type: "text", max: 6000 },
    { name: "start_at", type: "text", required: true },          // ISO timestamp (UTC) of the first session / start date
    { name: "duration_min", type: "number", onlyInt: true, min: 15, max: 1440 },
    { name: "recurrence", type: "select", values: ["none", "weekly", "monthly", "monthly_weekday"], maxSelect: 1, required: true },
    // weekly: {days}; monthly: {dates, every}; monthly_weekday: {weeks (5 = last), weekdays, every}
    { name: "pattern", type: "json", maxSize: 2000 },
    { name: "visibility", type: "select", values: ["public", "invite", "private"], maxSelect: 1, required: true },
    { name: "time_zone", type: "text", max: 64 },                // GM's IANA zone; repeats keep wall-clock time there
    { name: "closed", type: "bool" },                            // not taking new players
    { name: "invite_token", type: "text", required: true },
    created,
  ], ["CREATE UNIQUE INDEX idx_games_token ON games (invite_token)", "CREATE INDEX idx_games_visibility ON games (visibility)"]);

  base("game_members", [rel("game", games), rel("user", users), created],
    ["CREATE UNIQUE INDEX idx_members ON game_members (game, user)", "CREATE INDEX idx_members_user ON game_members (user)"]);
  base("game_kicked", [rel("game", games), rel("user", users)], ["CREATE UNIQUE INDEX idx_kicked ON game_kicked (game, user)"]);
  base("join_requests", [rel("game", games), rel("user", users),
    { name: "status", type: "select", values: ["pending", "approved", "declined"], maxSelect: 1, required: true }, created],
    ["CREATE INDEX idx_requests ON join_requests (game, user)"]);
  base("game_invites", [rel("game", games), rel("user", users),
    { name: "status", type: "select", values: ["pending", "accepted", "declined"], maxSelect: 1, required: true }, created],
    ["CREATE INDEX idx_invites ON game_invites (game, user)"]);

  // ---------------------------------------------------------------- notifications
  base("notifications", [rel("user", users), { name: "type", type: "text", required: true },
    { name: "payload", type: "json", maxSize: 5000 }, { name: "is_read", type: "bool" }, created],
    ["CREATE INDEX idx_notifications_user ON notifications (user, created)"]);

  // ---------------------------------------------------------------- messaging
  // user_a < user_b (string order), so each pair has exactly one thread.
  base("dm_threads", [rel("user_a", users), rel("user_b", users)],
    ["CREATE UNIQUE INDEX idx_dm_pair ON dm_threads (user_a, user_b)", "CREATE INDEX idx_dm_b ON dm_threads (user_b)"]);
  // kind 'dm' -> thread_id is a dm_threads id; kind 'game' -> a games id (the game board).
  base("messages", [
    { name: "kind", type: "select", values: ["dm", "game"], maxSelect: 1, required: true },
    { name: "thread_id", type: "text", required: true },
    rel("user", users),
    { name: "body", type: "text", required: true, max: 2000 },
    { name: "deleted", type: "bool" },
    { name: "deleted_by", type: "text" },
    created,
  ], ["CREATE INDEX idx_messages_thread ON messages (kind, thread_id, created)"]);
  // Unread tracking: the newest message time each user has seen in each thread.
  base("thread_reads", [rel("user", users),
    { name: "kind", type: "text", required: true }, { name: "thread_id", type: "text", required: true },
    { name: "last_read_at", type: "text" }],
    ["CREATE UNIQUE INDEX idx_thread_reads ON thread_reads (user, kind, thread_id)"]);

  // ---------------------------------------------------------------- moderation
  base("reports", [
    rel("reporter", users), rel("reported", users),
    { name: "context", type: "select", values: ["dm", "game"], maxSelect: 1, required: true },
    { name: "context_id", type: "text", required: true },
    { name: "message_id", type: "text" },
    { name: "reason", type: "text", required: true, max: 2000 },
    { name: "status", type: "select", values: ["open", "resolved", "dismissed"], maxSelect: 1, required: true },
    created,
  ], ["CREATE INDEX idx_reports_status ON reports (status, created)"]);

  // ---------------------------------------------------------------- settings
  const settings = app.settings();
  settings.meta.appName = "Session Xero";
  settings.rateLimits.enabled = true;
  settings.rateLimits.rules.push(
    { label: "users:auth", maxRequests: 10, duration: 300 },                // password / Google sign-in attempts per IP
    { label: "POST /api/app/password/forgot", maxRequests: 5, duration: 900 },
    { label: "POST /api/app/password/change", maxRequests: 10, duration: 900 },
    { label: "POST /api/app/account/email", maxRequests: 10, duration: 900 },
  );
  app.save(settings);
}, (app) => {
  for (const name of ["reports", "thread_reads", "messages", "dm_threads", "notifications", "game_invites",
                      "join_requests", "game_kicked", "game_members", "games", "availability"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
