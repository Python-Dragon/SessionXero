# Session Xero: tabletop RPG scheduler

A website for finding, hosting and scheduling tabletop RPG games. The backend is [PocketBase](https://pocketbase.io): a single program that provides the database, accounts, the admin dashboard and hosting. The site's own rules live in PocketBase JavaScript hooks. The front end is plain HTML/CSS/JS with no build step.

## Run it

Requires **Node.js 18+**, but only for the two helper scripts; the server itself is the PocketBase binary.

```bash
npm run setup        # downloads PocketBase 0.40.4 for your OS into ./pocketbase/
npm start            # http://localhost:3000
```

The first time it starts, PocketBase prints a link for creating a **superuser** (the owner account for the dashboard at `http://localhost:3000/_/`). You can also run `npm run superuser -- you@example.com yourpassword`. The dashboard lets you browse and edit all data, view logs, make backups, and set up email and Google sign-in.

To add an account to the site's admin/moderation team, run `npm run make-admin -- <username>`. To take it away, run `npm run remove-admin -- <username>`.

Settings (environment variables, all optional; anything left unset can be configured in the dashboard instead):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port the site runs on |
| `PB_DATA` | `./pb_data` | Where PocketBase keeps its database and files |
| `BASE_URL` | `http://localhost:<PORT>` | Public address of the site, used in links inside emails |
| `SMTP_URL` | (none) | Outgoing mail, e.g. `smtps://user:app-password@smtp.gmail.com:465`. Without it, emails are printed to the server console |
| `MAIL_FROM` | `Session Xero <no-reply@example.com>` | Sender shown on emails |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | (none) | Turns on "Continue with Google" (see below) |
| `ADMIN_USERNAMES` | (none) | Comma-separated usernames that join the admin team when they sign up |

### Setting up Google sign-in
1. Go to [Google Cloud Console](https://console.cloud.google.com/). Create a project, then open **APIs & Services → OAuth consent screen** and fill it in (External, app name "Session Xero", support email).
2. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**, and choose **Web application**.
3. Under **Authorized redirect URIs**, add `<BASE_URL>/api/oauth2-redirect`, e.g. `http://localhost:3000/api/oauth2-redirect` and `https://yourdomain.com/api/oauth2-redirect`.
4. Copy the client ID and client secret, and start the server with them:
   - PowerShell: `$env:GOOGLE_CLIENT_ID="…"; $env:GOOGLE_CLIENT_SECRET="…"; npm start`
   - bash: `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… npm start`

   Alternatively, enter them in the dashboard under **Collections → users → Options → OAuth2**.

### Setting up email
Any SMTP provider works. For Gmail, turn on 2-Step Verification, create an **App password**, and use `SMTP_URL=smtps://you@gmail.com:APP_PASSWORD@smtp.gmail.com:465` with `MAIL_FROM="Session Xero <you@gmail.com>"`. You can also enter these in the dashboard under **Settings → Mail settings**.

## Features

**Accounts**
- Usernames are unique, and uniqueness ignores case. They can be 3–20 characters: letters, numbers, `_` and `-`.
- Passwords can be anything 8+ characters long.
- Accounts, passwords (bcrypt), sign-in tokens, Google sign-in and the reset/confirmation emails are handled by **PocketBase**'s built-in auth. The site adds these rules in `pb_hooks/auth.pb.js`:
  - Usernames ignore case when logging in.
  - Banned accounts can't sign in by any method.
  - A reset email only goes to a *confirmed* recovery email.
- Sign-in and sensitive actions are rate-limited by PocketBase's rate limiter (configured in the migration).
- **Continue with Google** (when Google is set up, see above):
  - It's an alternative to the password; either one signs you in.
  - The first Google sign-in creates an account with a generated username and offers to change it.
  - Signed-in users can link or unlink Google under **Profile → Password & sign-in**.
  - An account can't unlink Google until it has a password.
- **Password & sign-in (Profile menu):** change or set your password, which signs out your other devices. You can also add a **recovery email**, which only counts once you click the confirmation link sent to it.
- **Forgot password:** from the login screen, enter your username or recovery email to get a one-time reset link.
  - The answer is the same whether or not an account matched.
  - Resetting signs out every device.
- **Profiles:** a preferred name, pronouns, and a public bio of up to 300 words, all optional. New users are offered profile setup right after they sign up, then availability. The **Profile menu (top-right)** has View my profile, Edit profile, Availability and Log out. Click anyone's name on a board, in a member list, in a DM or in a join request to see their profile.

**Scheduling**
- Calendar with a **Month / Week** toggle, showing every game you're in. Recurring sessions are expanded onto the calendar, and games you GM are shown in green.
- Recurrence can be:
  - **One-time.**
  - **Weekly** on one or more weekdays, e.g. Tue & Thu.
  - **Monthly by date** on one or more dates, e.g. the 1st & 15th. A date the month doesn't have moves to the month's last day.
  - **Monthly by weekday**, e.g. the 1st & 3rd Tuesday, or the last Friday.

  Both monthly types can repeat every 1–12 months, e.g. every 2 or 3 months. The host form previews the next few sessions.
- **Close to new players:** the GM can close a game from its page and reopen it later. A closed game is hidden from Find games (except for its members), and join requests and the invite link stop working. The GM can still approve pending requests and invite people by username.
- A clickable **clock face** sets the start time: pick the hour, then the minutes, then AM/PM.
- **Time zones:** times are entered in the GM's computer time zone and shown to everyone in their own computer's time zone. A noon game in New York shows as 11 AM in Chicago. Recurring games stay at the same time in the GM's zone, even when daylight saving changes on different dates. When a viewer's time differs from the GM's, the game page also shows the GM's local time.

**Hosting and finding games**
- The **+ Host a game** button (bottom-left) opens the host screen: title, date, clock, session length, repeat setting, a description capped at 500 words with a live counter, and who can join.
  - **Public:** listed in Find games. Players *request* to join.
  - **Invite only:** not listed. Anyone with the GM's link joins.
  - **Private:** not listed and has no link. The GM invites players by username, and each player accepts from their notifications.
- **Invite link** (`/join/<token>`): opening it adds the game to your calendar and gives you board access right away. If you aren't logged in, it joins you after you log in or sign up. The GM can reset the link, and players who were kicked can't use it to rejoin.
- **Public list:** clicking a game opens its details and an "Ask to join" button. Asking does **not** join you. The GM gets a notification and a DM opens with your intro message. The DM shows the GM a "Let them join / Decline" banner, so she can decide based on the chat.
- **Availability (Profile menu, or the "Set my availability" button on Find games):** a month calendar. Pick a day, add time windows, and set each window to not repeat, repeat **weekly** (same weekday) or repeat **monthly** (same date, moved to the month's last day if that date doesn't exist). Find games then only shows public games with a session that fits entirely inside one of your windows. A toggle turns the filter off.

**Messaging**
- **Unread markers:** a red count on the Messages tab and on each DM or game board with new posts from other people. Opening a conversation marks it read. Deleted messages, your own messages, and board history from before you joined a game never count.
- **DMs:** private between two people, and either of them can delete messages in the thread. Both can post, and either can report the other.
- **Game boards:** every member can post, see the full history, delete their own messages, DM other players and report anyone, including the GM. Click a name in the board or the member list to do this.
- **GM powers:** delete any message on the board, and kick players. A kicked player loses board access and can't rejoin with the link.
- **Admin page:** reports appear here for anyone on the admin team. Each report shows the reported message (kept even if it was deleted) and recent context. Admins can resolve, dismiss or reopen a report, and ban or unban a user. Banning signs the user out immediately.

## Layout

```
pb_migrations/1700000000_init.js   database schema, access rules, email templates, rate limits
pb_hooks/lib/core.js               shared helpers (permissions, games, messages, unread counts)
pb_hooks/accounts.pb.js            /api/app: me, profiles, availability, password & email
pb_hooks/games.pb.js               /api/app: hosting, listing, invites, join requests, kick/leave
pb_hooks/messages.pb.js            /api/app: boards, DMs, reports, notifications, admin
pb_hooks/auth.pb.js                sign-in rules, env settings, dev email fallback, make-admin
pb_public/                         the site (index.html, app.js, styles.css, tavern.js, vendor/pocketbase.umd.js)
scripts/setup.js, scripts/run.js   download / run PocketBase with this project's folders
```

Only `users` is reachable through PocketBase's standard collections API, and only for signing up and reading your own record. Every other collection is superuser-only. The browser goes through the `/api/app` routes, which enforce who may see or change what.

## Before going live

- Serve it over **HTTPS** behind a reverse proxy such as nginx or Caddy, or use PocketBase's built-in automatic HTTPS: `pocketbase serve yourdomain.com`. Set `BASE_URL` to the public address. If you use a proxy, set the trusted proxy headers in the dashboard (**Settings → Application**) so rate limiting sees real client IPs.
- Chat refreshes by polling every 3 seconds, which is fine for small communities. PocketBase's realtime subscriptions are the natural upgrade.
- Back up `pb_data/`. The dashboard can make scheduled backups, including to S3.
