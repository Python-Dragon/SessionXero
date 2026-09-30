// Database setup using Node's built-in SQLite (Node 22.13+). No native modules to compile.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash   TEXT NOT NULL,
  salt        TEXT NOT NULL,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  banned      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

-- Availability windows. day: 0=Sun..6=Sat (weekday of date); minutes since local midnight.
-- date/repeat columns are added by the migration below.
CREATE TABLE IF NOT EXISTS availability (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        INTEGER NOT NULL,
  start_min  INTEGER NOT NULL,
  end_min    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  gm_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  start_at      TEXT NOT NULL,              -- ISO timestamp (UTC) of first session
  duration_min  INTEGER NOT NULL DEFAULT 180,
  recurrence    TEXT NOT NULL DEFAULT 'none', -- none | weekly | monthly | monthly_weekday (see pattern)
  visibility    TEXT NOT NULL DEFAULT 'public', -- public | invite | private
  invite_token  TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_members (
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, user_id)
);

CREATE TABLE IF NOT EXISTS game_kicked (
  game_id  INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, user_id)
);

CREATE TABLE IF NOT EXISTS join_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | declined
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dm_threads (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_a, user_b)
);

-- kind: 'dm' (thread_id -> dm_threads.id) or 'game' (thread_id -> games.id)
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  thread_id   INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  deleted_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(kind, thread_id, id);

CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context      TEXT NOT NULL,        -- dm | game
  context_id   INTEGER NOT NULL,
  message_id   INTEGER,
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open', -- open | resolved | dismissed
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Availability became calendar-based: each window is anchored to a local date (YYYY-MM-DD)
// and repeats none | weekly | monthly. Older rows only had a weekday, so they become
// weekly windows anchored to the most recent matching day.
const availCols = db.prepare('PRAGMA table_info(availability)').all().map(c => c.name);
if (!availCols.includes('date')) db.exec('ALTER TABLE availability ADD COLUMN date TEXT');
if (!availCols.includes('repeat')) db.exec("ALTER TABLE availability ADD COLUMN repeat TEXT NOT NULL DEFAULT 'weekly'");
db.exec(`UPDATE availability SET date = date('now', 'localtime', '-6 days', 'weekday ' || day) WHERE date IS NULL`);

// Public profile fields: preferred name, pronouns and bio (all optional).
const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols.includes('display_name')) db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
if (!userCols.includes('pronouns')) db.exec("ALTER TABLE users ADD COLUMN pronouns TEXT NOT NULL DEFAULT ''");
if (!userCols.includes('bio')) db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");

// Sign-in and recovery. pass_hash = '' means the account has no password (created with Google).
// email is the *verified* recovery address; a pending change lives in email_tokens until confirmed.
if (!userCols.includes('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
if (!userCols.includes('google_sub')) db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');   // Google's stable account id
if (!userCols.includes('google_email')) db.exec('ALTER TABLE users ADD COLUMN google_email TEXT');
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE);
-- One-time links sent by email. kind: 'reset' (password reset) | 'verify' (confirm recovery email).
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
`);

// IANA time zone of the GM's computer when the game was saved. Recurring sessions keep the
// same wall-clock time in this zone. NULL (older games) means "use the viewer's zone".
const gameCols = db.prepare('PRAGMA table_info(games)').all().map(c => c.name);
if (!gameCols.includes('time_zone')) db.exec('ALTER TABLE games ADD COLUMN time_zone TEXT');
// closed = 1: not taking new players (hidden from Find games; requests and invite links refused).
if (!gameCols.includes('closed')) db.exec('ALTER TABLE games ADD COLUMN closed INTEGER NOT NULL DEFAULT 0');
// Recurrence details as JSON (NULL on older games = derive from start_at):
//   weekly:          { days: [0-6...] }
//   monthly:         { dates: [1-31...], every: months }           e.g. the 1st & 15th
//   monthly_weekday: { weeks: [1-4, 5=last...], weekdays: [0-6...], every: months }  e.g. 1st & 3rd Tue
if (!gameCols.includes('pattern')) db.exec('ALTER TABLE games ADD COLUMN pattern TEXT');

module.exports = db;
