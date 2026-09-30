/// <reference path="../pb_data/types.d.ts" />
// Sign-in rules layered on PocketBase's built-in auth, settings taken from environment variables,
// the dev email fallback, security headers, and the make-admin / remove-admin commands.

// Banned accounts can't sign in by any method (password, Google, token refresh).
onRecordAuthRequest((e) => {
  if (e.record && e.record.getBool("banned")) throw new ForbiddenError("This account has been suspended");
  return e.next();
}, "users");

// Usernames are unique ignoring case, so let people log in with any capitalisation.
onRecordAuthWithPasswordRequest((e) => {
  if (!e.record && e.identity && !e.identity.includes("@")) {
    const c = require(`${__hooks}/lib/core.js`);
    e.record = c.userByName(e.identity);
  }
  return e.next();
}, "users");

// Regular sign-up: the person chose a password; usernames in ADMIN_USERNAMES join the moderation team.
onRecordCreateRequest((e) => {
  // This also runs for accounts created by Google sign-in (request context "oauth2"), which carry Google's
  // verified email and a random password PocketBase generates. Only a real sign-up chose its password, and it
  // must not set an email: that's added and confirmed later from Password & sign-in.
  const info = e.requestInfo();
  if (info.context === "oauth2") return e.next();
  if (info.body.email) throw new BadRequestError("Add a recovery email after signing up, from Profile → Password & sign-in");
  e.record.set("has_password", true);
  const admins = String($os.getenv("ADMIN_USERNAMES") || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (admins.includes(e.record.getString("username").toLowerCase())) e.record.set("is_admin", true);
  return e.next();
}, "users");

// First Google sign-in creates an account: give it a free username based on the Google name/email.
// The browser then offers to change it (the response's meta.isNew is true).
onRecordAuthWithOAuth2Request((e) => {
  const c = require(`${__hooks}/lib/core.js`);
  // PocketBase falls back to "the account with the same email". If that account never confirmed the
  // address, anyone could have typed it there (e.g. to catch the real owner's Google sign-in), so don't
  // hand the Google user that account: drop the unconfirmed claim and create a fresh account instead.
  // (Signing in when already linked, or linking while signed in, still works as normal.)
  if (!e.isNewRecord && e.record && !e.record.verified() && !(e.auth && e.auth.id === e.record.id)) {
    let linked = null;
    try {
      linked = $app.findFirstExternalAuthByExpr($dbx.hashExp({
        collectionRef: e.record.collection().id, recordRef: e.record.id, provider: e.providerName, providerId: e.oAuth2User.id }));
    } catch (_) {}
    if (!linked) {
      c.releaseUnverifiedEmail(e.record);
      e.record = null;
      e.isNewRecord = true;
    }
  }
  if (e.isNewRecord) {
    const u = e.oAuth2User || {};
    let stem = String(u.username || u.name || String(u.email || "").split("@")[0] || "player").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
    if (stem.length < 3) stem = ("player" + stem).slice(0, 16);
    let name = stem;
    for (let i = 2; c.userByName(name); i++) name = stem + i;
    if (!e.createData) e.createData = {};
    e.createData["username"] = name;
    e.createData["has_password"] = false;
  }
  return e.next();
}, "users");

// Password resets only go to a confirmed recovery email (a typo'd address never gets the keys).
onRecordRequestPasswordResetRequest((e) => {
  if (e.record && !e.record.verified()) return e.noContent(204);
  return e.next();
}, "users");

// Without SMTP set up, print emails to the console instead of failing, so resets can be tested locally.
onMailerSend((e) => {
  if ($app.settings().smtp.enabled) return e.next();
  const m = e.message;
  const to = (m.to || []).map(a => a.address).join(", ");
  const links = (String(m.html || "").match(/href="([^"]+)"/g) || []).map(s => s.slice(6, -1));
  console.log(`\n[mail] SMTP not configured; not sending.\n[mail] To: ${to}\n[mail] Subject: ${m.subject}\n[mail] Links: ${links.join("  ") || "(none)"}\n`);
});

// Apply settings from environment variables at startup (anything unset is left as configured in the dashboard):
//   BASE_URL, MAIL_FROM, SMTP_URL, GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
onBootstrap((e) => {
  e.next(); // the database is ready after this
  const env = n => String($os.getenv(n) || "").trim();
  const s = $app.settings();
  if (env("BASE_URL")) s.meta.appURL = env("BASE_URL").replace(/\/+$/, "");
  const from = env("MAIL_FROM");
  if (from) {
    const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
    s.meta.senderName = m ? m[1] || "Session Xero" : "Session Xero";
    s.meta.senderAddress = m ? m[2] : from;
  } else if (!s.meta.senderAddress || s.meta.senderAddress === "support@example.com") {
    s.meta.senderName = "Session Xero";
    s.meta.senderAddress = "no-reply@example.com";
  }
  const smtp = env("SMTP_URL");
  if (smtp) {
    // smtp://user:pass@host:587 (STARTTLS) or smtps://user:pass@host:465 (TLS)
    const m = /^(smtps?):\/\/(?:([^:@]*)(?::([^@]*))?@)?([^:/?#]+)(?::(\d+))?/.exec(smtp);
    if (!m) console.log("[settings] SMTP_URL is not a valid smtp:// or smtps:// URL; ignoring it");
    else {
      s.smtp.enabled = true;
      s.smtp.tls = m[1] === "smtps";
      s.smtp.host = m[4];
      s.smtp.port = Number(m[5] || (m[1] === "smtps" ? 465 : 587));
      s.smtp.username = decodeURIComponent(m[2] || "");
      s.smtp.password = decodeURIComponent(m[3] || "");
    }
  }
  $app.save(s);

  const id = env("GOOGLE_CLIENT_ID"), secret = env("GOOGLE_CLIENT_SECRET");
  if (id && secret) {
    const users = $app.findCollectionByNameOrId("users");
    users.oauth2.enabled = true;
    users.oauth2.providers = [{ name: "google", clientId: id, clientSecret: secret }];
    $app.save(users);
  } else if (id || secret) console.log("[settings] Google sign-in needs both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
});

routerUse((e) => {
  const h = e.response.header();
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "SAMEORIGIN");
  h.set("Referrer-Policy", "same-origin");
  return e.next();
});

// pocketbase make-admin <username>   /   pocketbase remove-admin <username>
for (const [use, value] of [["make-admin", true], ["remove-admin", false]]) {
  $app.rootCmd.addCommand(new Command({
    use: `${use} <username>`,
    short: value ? "Give an account admin/moderation rights" : "Take away an account's admin rights",
    run: (cmd, args) => {
      const c = require(`${__hooks}/lib/core.js`);
      const making = cmd.name() === "make-admin";
      const u = args[0] && c.userByName(args[0]);
      if (!u) { console.log(`No user named "${args[0] || ""}". Register the account first.`); return; }
      u.set("is_admin", making);
      $app.save(u);
      console.log(`${u.getString("username")} is ${making ? "now" : "no longer"} an admin.`);
    },
  }));
}
