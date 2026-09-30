# Session Xero: tabletop RPG scheduler

A website for finding, hosting and scheduling tabletop RPG games. It runs on Node.js with SQLite and a plain HTML/CSS/JS front end, and there's no build step.

## Run it

Requires **Node.js 22.13 or newer**. That version has SQLite built in, so there's nothing native to compile.

```bash
npm install
npm start            # http://localhost:3000
```

Settings (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port the site runs on |
| `DB_PATH` | `./data.sqlite` | Where the database file lives |
| `ADMIN_USERNAMES` | (none) | Comma-separated usernames that become admins when they register |
| `BASE_URL` | `http://localhost:<PORT>` | Public address of the site, used in links inside emails |
| `SMTP_URL` | (none) | Outgoing mail server, e.g. `smtps://user:app-password@smtp.gmail.com:465`. Without it, emails are printed to the server console |
| `MAIL_FROM` | `Session Xero <no-reply@localhost>` | Sender shown on emails |
| `GOOGLE_CLIENT_ID` | (none) | OAuth Web client ID. It turns on "Sign in with Google" (see below) |

### Setting up Google sign-in
1. Go to [Google Cloud Console](https://console.cloud.google.com/). Create a project, then open **APIs & Services → OAuth consent screen** and fill it in (External, app name, support email).
2. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**, and choose **Web application**.
3. Under **Authorized JavaScript origins**, add every address the site is served from, e.g. `http://localhost:3000` and `https://yourdomain.com`. No redirect URI is needed.
4. Copy the client ID (`….apps.googleusercontent.com`) and start the server with it:
   - PowerShell: `$env:GOOGLE_CLIENT_ID="…"; npm start`
   - bash: `GOOGLE_CLIENT_ID=… npm start`

### Setting up email
Any SMTP provider works. For Gmail, turn on 2-Step Verification, create an **App password**, and use `SMTP_URL=smtps://you@gmail.com:APP_PASSWORD@smtp.gmail.com:465` with `MAIL_FROM="Session Xero <you@gmail.com>"`. Set `BASE_URL` to the site's public address so links in emails point to the right place.

To make an existing account part of the admin/moderation team, run `npm run make-admin -- <username>`. Add `--remove` to revoke it.

## Features

**Accounts**
- Usernames are unique, and uniqueness ignores case. They can be 3–20 characters: letters, numbers, `_` and `-`.
- Passwords can be anything 8+ characters long.
- Passwords are hashed with **scrypt** (N=16384, r=8, p=1) using a random 16-byte salt per user and compared in constant time.
- Sessions use random 256-bit tokens in an HttpOnly, SameSite=Lax cookie. Only a SHA-256 of each token is stored in the database.
- Login and registration are rate-limited.
- **Sign in with Google** (when `GOOGLE_CLIENT_ID` is set):
  - It's an alternative to the password; either one signs you in.
  - New users can create an account with Google by picking a username.
  - Existing users can link or unlink Google under **Profile → Password & sign-in**.
  - Google's sign-in tokens are checked on the server against Google's published keys, the client ID, the issuer and the expiry.
  - An account can't unlink Google until it has a password.
- **Password & sign-in (Profile menu):** change or set your password, which signs out your other devices. You can also add a **recovery email**, which only counts once you click the confirmation link sent to it.
- **Forgot password:** from the login screen, enter your username or recovery email to get a one-time reset link, valid for 1 hour.
  - Only a hash of the link's token is stored.
  - The answer is the same whether or not an account matched.
  - Resetting signs out every device.
  - Links in emails always use `BASE_URL`, never the request's Host header.
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
server.js            API routes + static hosting
db.js                SQLite schema
mail.js              outgoing email (SMTP, or console output when not set up)
google-auth.js       verifies Google sign-in tokens
scripts/make-admin.js
public/index.html    app shell
public/app.js        all front-end views
public/styles.css
```

## Before going live

- Serve it over **HTTPS** behind a reverse proxy such as nginx or Caddy. The cookie gets the `Secure` flag automatically when `X-Forwarded-Proto: https` is present. Add `app.set('trust proxy', 1)` in `server.js` so rate limiting sees real client IPs.
- Chat refreshes by polling every 3 seconds, which is fine for small communities. Switch to WebSockets if traffic grows.
- The rate limiter keeps its counts in memory, so a restart resets them.
- Back up `data.sqlite`.
