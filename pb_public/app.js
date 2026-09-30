/* Session Xero — front end (no build step, no framework). */
'use strict';

// ============================================================ tiny DOM helper
// h('div', {class: 'x', onclick: fn}, 'text', child) — text is always inserted as text (XSS-safe).
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = c => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}
function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  children.flat().forEach(c => c != null && el.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return el;
}
const ICONS = {
  logo: '<svg viewBox="0 0 32 32"><polygon points="16,2 29,9.5 29,22.5 16,30 3,22.5 3,9.5" fill="#e0a84a"/><polygon points="16,8 23,20 9,20" fill="#1a1d29"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  moon: '<svg viewBox="0 0 12 12" shape-rendering="crispEdges" fill="currentColor"><path d="M4 1h4v1H6v1H5v2H4v2h1v2h1v1h2v1H4v-1H3V9H2V3h1V2h1z"/></svg>',
  google: '<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.4 5.7c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>',
  sun: '<svg viewBox="0 0 12 12" shape-rendering="crispEdges" fill="currentColor"><path d="M5 0h2v2H5zM5 10h2v2H5zM0 5h2v2H0zM10 5h2v2h-2zM1 1h2v2H1zM9 1h2v2H9zM1 9h2v2H1zM9 9h2v2H9zM4 3h4v1h1v4H8v1H4V8H3V4h1z"/></svg>',
};
function icon(name) { const s = document.createElement('span'); s.style.display = 'contents'; s.innerHTML = ICONS[name]; return s; }

// ============================================================ API + UI utilities
// PocketBase handles accounts (sign-up, login, Google, reset/verify emails); its SDK keeps the
// auth token in localStorage. Everything else goes through the site's own routes under /api/app.
const pb = new PocketBase(location.origin);

// Readable text for a PocketBase error: { message, data: { field: { code, message } } }.
const FIELD_ERRORS = {
  username: { validation_not_unique: 'That username is taken', default: 'Username must be 3–20 characters: letters, numbers, _ or -' },
  password: { default: 'Password must be at least 8 characters' },
  passwordConfirm: { default: "Passwords don't match" },
};
function errorText(err) {
  const d = (err && (err.response || err.data)) || {};
  const fields = d.data && typeof d.data === 'object' ? Object.entries(d.data) : [];
  if (fields.length) return fields.map(([k, v]) => (FIELD_ERRORS[k] && (FIELD_ERRORS[k][v.code] || FIELD_ERRORS[k].default)) || v.message).join('. ');
  if ((err && err.status) === 429) return 'Too many attempts. Try again in a few minutes.';
  return String(d.message || (err && err.message) || 'Request failed').replace(/\.$/, '');
}

async function api(path, opts = {}) {
  const headers = opts.body ? { 'Content-Type': 'application/json' } : {};
  if (pb.authStore.token) headers.Authorization = pb.authStore.token;
  const res = await fetch('/api/app' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'), headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.me && !opts.quiet) { pb.authStore.clear(); state.me = null; render(); }
    throw new Error(errorText({ status: res.status, response: data }));
  }
  return data;
}
// Routes that change the password or email return a fresh token (the old one stops working).
const keepSession = r => { if (r && r.token) pb.authStore.save(r.token, r.record); return r; };
function toast(msg, isError) {
  const t = h('div', { class: 'toast' + (isError ? ' error' : '') }, msg);
  document.getElementById('toast-root').append(t);
  setTimeout(() => t.remove(), 3800);
}
// Wrap an async handler so errors show as a toast.
const act = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

function openModal(content, { wide } = {}) {
  closeModal();
  const back = h('div', { class: 'modal-back', onmousedown: e => { if (e.target === back) closeModal(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' }, content));
  document.getElementById('modal-root').append(back);
  const first = back.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 30);
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closePopover(); } });

let popoverEl = null;
function openPopover(anchor, items) {
  closePopover();
  const r = anchor.getBoundingClientRect();
  popoverEl = h('div', { class: 'popover' },
    items.filter(Boolean).map(it => h('button', { class: it.danger ? 'danger' : '', onclick: () => { closePopover(); it.onClick(); } }, it.label)));
  document.body.append(popoverEl);
  const pw = popoverEl.offsetWidth, ph = popoverEl.offsetHeight;
  popoverEl.style.left = Math.min(r.left, innerWidth - pw - 8) + 'px';
  popoverEl.style.top = (r.bottom + ph + 8 > innerHeight ? r.top - ph - 4 : r.bottom + 4) + 'px';
  setTimeout(() => document.addEventListener('click', closePopover, { once: true }), 0);
}
function closePopover() { if (popoverEl) { popoverEl.remove(); popoverEl = null; } }

// Timers that belong to the current view (chat polling); cleared on every navigation.
let viewTimers = [];
function every(ms, fn) { viewTimers.push(setInterval(fn, ms)); }
function clearViewTimers() { viewTimers.forEach(clearInterval); viewTimers = []; }

// ============================================================ date helpers
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = n => String(n).padStart(2, '0');
const fmtTime = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDate = d => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const fmtDateLong = d => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtStamp = iso => { const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'); return fmtDate(d) + ' ' + fmtTime(d); };
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a, b) => dateKey(a) === dateKey(b);
const minsToHHMM = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const hhmmToMins = s => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
function fmtMinsLabel(m) { const d = new Date(2000, 0, 1, Math.floor(m / 60), m % 60); return m === 1440 ? 'midnight' : fmtTime(d); }

// ---- time zones
// Game times are stored as UTC instants and shown in the viewer's computer time zone.
// Recurring games repeat at the same wall-clock time in the GM's zone (g.timeZone), so a
// weekly noon game in New York stays noon there across DST, wherever the viewer is.
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const tzFormatters = {};
function zonedParts(date, tz) {
  const f = tzFormatters[tz] ||= new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  const p = Object.fromEntries(f.formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month - 1, d: p.day, hh: p.hour % 24, mm: p.minute };
}
// The instant when the wall clock in `tz` reads y-m-d hh:mm (overflowing d/m are normalised).
function zonedToDate(y, m, d, hh, mm, tz) {
  const want = Date.UTC(y, m, d, hh, mm);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(t), tz), diff = want - Date.UTC(p.y, p.m, p.d, p.hh, p.mm);
    if (!diff) break;
    t += diff;
  }
  return new Date(t);
}
// The server can only check that a zone name looks right, so an unknown zone (e.g. "Mars/Base")
// falls back to the viewer's own zone here instead of throwing and breaking every page that lists the game.
const tzValid = {};
function knownTz(tz) {
  if (!tz) return null;
  if (!(tz in tzValid)) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); tzValid[tz] = true; } catch { tzValid[tz] = false; } }
  return tzValid[tz] ? tz : null;
}
const gameTz = g => knownTz(g.timeZone) || LOCAL_TZ;
// Differs from the viewer's clock? Show the GM's own time, e.g. "Wed 12:00 PM EDT for the GM".
function gmTimeNote(g, when) {
  const tz = knownTz(g.timeZone);
  if (!when || !tz) return '';
  const a = zonedParts(when, tz), b = zonedParts(when, LOCAL_TZ);
  if (a.d === b.d && a.hh === b.hh && a.mm === b.mm) return '';
  return ` (${when.toLocaleString([], { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })} for the GM)`;
}

// ---- recurrence
// Sessions happen at the start time (in the GM's zone) on every date from the start date on
// that matches the game's pattern. Older games have no pattern; it's derived from startAt.
const WEEK_NAMES = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: 'last' };
function gamePattern(g) {
  if (g.pattern) return g.pattern;
  const s = zonedParts(new Date(g.startAt), gameTz(g)), wd = new Date(Date.UTC(s.y, s.m, s.d)).getUTCDay();
  return g.recurrence === 'weekly' ? { days: [wd] } : { dates: [s.d], every: 1 };
}
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
// Does calendar date `d` (a UTC-midnight Date standing for a wall-clock date) match the pattern?
// `s` is the start date's parts; monthly intervals count from the start month.
function patternMatches(rec, p, d, s) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate(), wd = d.getUTCDay();
  if (rec === 'weekly') return p.days.includes(wd);
  if (((y - s.y) * 12 + m - s.m) % (p.every || 1)) return false;
  const last = daysInMonth(y, m);
  if (rec === 'monthly') return p.dates.some(n => Math.min(n, last) === day); // 31st -> last day of short months
  return p.weekdays.includes(wd) && p.weeks.some(w => (w === 5 ? day + 7 > last : Math.ceil(day / 7) === w));
}
// Every session of a game that overlaps [from, to).
function occurrences(g, from, to) {
  const start = new Date(g.startAt), dur = g.durationMin * 60000, out = [];
  if (g.recurrence === 'none') {
    if (start < to && start.getTime() + dur > from) out.push(start);
    return out;
  }
  const tz = gameTz(g), s = zonedParts(start, tz), p = gamePattern(g);
  // Walk the GM's calendar dates (pure date arithmetic) and only resolve matching ones to instants.
  const f = zonedParts(new Date(Math.max(from.getTime() - dur, start.getTime())), tz), e = zonedParts(to, tz);
  const endDay = Date.UTC(e.y, e.m, e.d + 1);
  for (let t = Date.UTC(f.y, f.m, f.d - 1), n = 0; t <= endDay && n < 1500; t += 864e5, n++) {
    const d = new Date(t);
    if (!patternMatches(g.recurrence, p, d, s)) continue;
    const at = zonedToDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), s.hh, s.mm, tz);
    if (at >= start && at < to && at.getTime() + dur > from) out.push(at);
  }
  return out;
}
function nextOccurrence(g) {
  const now = new Date();
  return occurrences(g, now, new Date(now.getTime() + 400 * 864e5))[0] || null;
}
const listJoin = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
const everyMonths = n => n > 1 ? `Every ${n} months` : 'Monthly';
// Describe the schedule in the viewer's time when their dates line up with the GM's in a simple way
// (same day, or a weekly game shifted a whole day). Otherwise use the GM's own terms and zone.
function recurrenceLabel(g) {
  const now = new Date();
  const upcoming = g.recurrence === 'none' ? [] : occurrences(g, now, new Date(now.getTime() + 400 * 864e5)).slice(0, 8);
  const next = upcoming[0] || new Date(g.startAt);
  if (g.recurrence === 'none') return `One-time · ${fmtDate(next)} at ${fmtTime(next)}`;
  const p = gamePattern(g), tz = gameTz(g);
  const dayShift = o => { const a = zonedParts(o, tz), b = zonedParts(o, LOCAL_TZ); return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 864e5); };
  const shifts = new Set((upcoming.length ? upcoming : [next]).map(dayShift));
  const shift = shifts.size === 1 ? [...shifts][0] : null; // null: differs between sessions (DST weeks)
  const gmTime = next.toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  if (g.recurrence === 'weekly')
    return `Every ${listJoin(p.days.map(d => (d + (shift || 0) + 7) % 7).sort((a, b) => a - b).map(d => DAY_NAMES[d].slice(0, 3)))} at ${shift === null ? gmTime : fmtTime(next)}`;
  const time = shift === 0 ? fmtTime(next) : gmTime;
  const days = g.recurrence === 'monthly'
    ? `on the ${listJoin(p.dates.map(ordinal))}`
    : `on the ${listJoin(p.weeks.map(w => WEEK_NAMES[w]))} ${listJoin(p.weekdays.map(d => DAY_NAMES[d]))}`;
  return `${everyMonths(p.every || 1)} ${days} at ${time}`;
}
const recurrenceShort = g => ({ none: 'One-time', weekly: 'Weekly' })[g.recurrence] || everyMonths((gamePattern(g).every) || 1);
const durLabel = m => (m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`);
const VIS = { public: 'Public', invite: 'Invite only', private: 'Private' };

// Availability windows are anchored to a local date and repeat none | weekly | monthly.
// Monthly follows the same rule as games: same date, clamped to the month's last day.
const parseDateKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
function slotOnDate(slot, day) {
  const key = dateKey(day);
  if (key === slot.date) return true;
  if (slot.repeat === 'none' || key < slot.date) return false;
  const a = parseDateKey(slot.date);
  if (slot.repeat === 'weekly') return a.getDay() === day.getDay();
  const last = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
  return day.getDate() === Math.min(a.getDate(), last);
}
function slotRepeatLabel(slot) {
  const a = parseDateKey(slot.date);
  if (slot.repeat === 'weekly') return `Every ${DAY_NAMES[a.getDay()]}`;
  if (slot.repeat === 'monthly') return `Monthly on the ${ordinal(a.getDate())}`;
  return 'One day only';
}
// Does a session fit fully inside one of the user's availability windows?
function fitsAvailability(start, durationMin, slots) {
  const s = start.getHours() * 60 + start.getMinutes(), e = s + durationMin;
  return slots.some(a => slotOnDate(a, start) && s >= a.start && e <= a.end);
}

// ============================================================ app state + routing
const state = {
  me: null, myGames: [], availability: [], unread: 0,
  calMode: 'month', calCursor: new Date(), onlyAvailable: true, findQuery: '',
  authView: 'hero', // logged out: 'hero' (landing page) | 'login' | 'register'
};
// Invite links look like /join/<token>; remember it until the user is logged in.
let pendingInvite = location.pathname.startsWith('/join/') ? decodeURIComponent(location.pathname.slice(6)) : null;

function route() { const parts = location.hash.replace(/^#\/?/, '').split('/'); return { name: parts[0] || 'calendar', parts }; }
function go(hash) { if (location.hash === hash) renderView(); else location.hash = hash; }
window.addEventListener('hashchange', () => renderView());

// Links from emails: /?reset=<token> (choose a new password), /?verify=<token> (confirm recovery email).
let resetToken = null;
async function boot() {
  state.authMethods = await pb.collection('users').listAuthMethods().catch(() => null);
  const params = new URLSearchParams(location.search);
  resetToken = params.get('reset');
  const verifyToken = params.get('verify');
  if (resetToken || verifyToken) history.replaceState(null, '', location.pathname + location.hash);
  if (verifyToken) await pb.collection('users').confirmVerification(verifyToken)
    .then(() => toast('Recovery email confirmed')).catch(e => toast(errorText(e), true));
  await loadMe();
  render();
}
// Check the saved sign-in (refreshing its token) and load the current user.
async function loadMe() {
  state.me = null;
  if (!pb.authStore.isValid) return;
  try { await pb.collection('users').authRefresh(); state.me = await api('/me', { quiet: true }); }
  catch { pb.authStore.clear(); }
}
const googleEnabled = () => !!(state.authMethods && state.authMethods.oauth2 && state.authMethods.oauth2.enabled &&
  state.authMethods.oauth2.providers.some(p => p.name === 'google'));

function render() {
  clearViewTimers();
  const app = document.getElementById('app');
  app.innerHTML = '';
  if (resetToken) return app.append(resetScreen());
  // Invite links skip the landing page: the visitor already knows why they're here.
  if (!state.me) return app.append(state.authView === 'hero' && !pendingInvite ? heroScreen() : authScreen(state.authView));
  app.append(shell());
  handleInvite().then(renderView);
  pollBadge();
}

async function handleInvite() {
  if (!pendingInvite) return;
  const token = pendingInvite; pendingInvite = null;
  history.replaceState(null, '', '/' + location.hash);
  try {
    const { gameId } = await api(`/invite/${encodeURIComponent(token)}/join`, { body: {} });
    toast('Game added to your calendar — welcome to the table!');
    location.hash = '#/game/' + gameId;
  } catch (e) { toast(e.message, true); }
}

// ============================================================ theme (parchment default, dark optional)
function themeToggle() {
  const btn = h('button', { class: 'icon-btn theme-toggle', type: 'button' });
  const sync = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    btn.innerHTML = ''; btn.append(icon(dark ? 'sun' : 'moon'));
    btn.title = dark ? 'Switch to parchment theme' : 'Switch to dark theme';
    btn.setAttribute('aria-label', btn.title);
  };
  btn.onclick = () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('theme', dark ? 'dark' : 'parchment'); } catch {}
    sync();
  };
  sync();
  return btn;
}

// ============================================================ landing page (logged-out visitors)
function heroScreen() {
  const toAuth = view => () => { state.authView = view; render(); window.scrollTo(0, 0); };
  const feature = (title, text) => h('div', { class: 'hero-feature' }, h('h3', {}, title), h('p', {}, text));
  return h('div', { class: 'hero-page' },
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, icon('logo'), h('span', {}, 'Session Xero')),
      h('div', { class: 'top-right' }, themeToggle(), h('button', { class: 'btn', onclick: toAuth('login') }, 'Log in'))),
    h('section', { class: 'hero' },
      h('h1', {}, 'Every great campaign starts with ', h('span', { class: 'hero-accent' }, 'Session Zero')),
      h('p', { class: 'hero-sub' }, 'A tavern-style party finder for tabletop RPGs — built for the hardest part of scheduling: finding a group when you can actually play.'),
      h('div', { class: 'hero-cta' },
        h('button', { class: 'btn primary', onclick: toAuth('register') }, 'Find your party'),
        h('button', { class: 'btn', onclick: toAuth('login') }, 'I have an account'))),
    h('section', { class: 'hero-features' },
      feature('Mark when you can play', 'Fill in an availability calendar once, with weekly or monthly repeats, and we only show you tables that fit.'),
      feature('Find a table that fits', 'Browse public games by system, GM or vibe. Ask to join, then chat with the GM before you commit.'),
      feature('Host your own campaign', 'Weekly, twice a month, the last Friday… every repeat pattern, shown in each player’s own time zone.'),
      feature('Keep the party together', 'Every game gets a message board and a calendar entry. Players can also DM each other and read profiles.')));
}

// ============================================================ auth screen
function authScreen(initialMode = 'login') {
  let mode = 'login';
  const user = h('input', { type: 'text', autocomplete: 'username', maxlength: 20, required: true });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = h('div', { class: 'field-error' });
  const title = h('h2', {}, 'Log in');
  const confirmWrap = h('div', { class: 'hidden' }, h('label', {}, 'Confirm password'), pass2);
  const hint = h('div', { class: 'muted small hidden' }, 'Username: 3–20 letters, numbers, _ or -. Password: at least 8 characters.');
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Log in');
  const swap = h('button', { class: 'link', type: 'button', onclick: () => setMode(mode === 'login' ? 'register' : 'login') });
  const swapText = h('span', { class: 'muted small' });
  const forgot = h('button', { class: 'link small', type: 'button', style: 'display:block;margin:.35rem 0 0 auto', onclick: openForgotPassword }, 'Forgot password?');
  function setMode(m) {
    mode = m; err.textContent = '';
    const reg = m === 'register';
    title.textContent = reg ? 'Create an account' : 'Log in';
    submit.textContent = reg ? 'Create account' : 'Log in';
    confirmWrap.classList.toggle('hidden', !reg); hint.classList.toggle('hidden', !reg); forgot.classList.toggle('hidden', reg);
    pass.autocomplete = reg ? 'new-password' : 'current-password';
    swapText.textContent = reg ? 'Already have an account? ' : 'New here? ';
    swap.textContent = reg ? 'Log in' : 'Create an account';
  }
  setMode(initialMode === 'register' ? 'register' : 'login');
  const form = h('form', {
    onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      if (mode === 'register' && pass.value !== pass2.value) { err.textContent = "Passwords don't match"; return; }
      submit.disabled = true;
      const users = pb.collection('users'), username = user.value.trim();
      try {
        if (mode === 'register') await users.create({ username, password: pass.value, passwordConfirm: pass2.value });
        try { await users.authWithPassword(username, pass.value); }
        catch (ex) { throw new Error(ex.status === 400 ? 'Wrong username or password' : errorText(ex)); }
        state.me = await api('/me'); render();
        if (mode === 'register') openProfileEditor({ onboarding: true });
      } catch (ex) { err.textContent = ex instanceof Error && !ex.response ? ex.message : errorText(ex); }
      finally { submit.disabled = false; }
    },
  }, title, h('label', {}, 'Username'), user, h('label', {}, 'Password'), pass, forgot, confirmWrap, hint, err, submit,
    h('p', { style: 'text-align:center;margin:1rem 0 0' }, swapText, swap));
  const google = googleButton('Continue with Google', async auth => {
    state.me = await api('/me'); render();
    if (auth.meta && auth.meta.isNew) openPickUsername();
  }, msg => { err.textContent = msg; });
  return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    themeToggle(),
    !pendingInvite && h('button', { class: 'link small', type: 'button', style: 'margin-bottom:.6rem', onclick: () => { state.authView = 'hero'; render(); } }, '← Back'),
    h('div', { class: 'brand' }, icon('logo'), 'Session Xero'),
    h('p', { class: 'muted', style: 'margin-top:0' },
      pendingInvite ? "You've been invited to a game. Log in or create an account to join." : 'Every great campaign starts with Session Zero.'),
    form,
    google && [h('div', { class: 'or-rule' }, 'or'), h('div', { class: 'google-wrap' }, google)]));
}

// Page opened from a password-reset email.
function resetScreen() {
  const pass = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const err = h('div', { class: 'field-error' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Set new password');
  const leave = () => { resetToken = null; render(); };
  const form = h('form', {
    onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      if (pass.value !== pass2.value) { err.textContent = "Passwords don't match"; return; }
      submit.disabled = true;
      try {
        await pb.collection('users').confirmPasswordReset(resetToken, pass.value, pass2.value);
        resetToken = null; pb.authStore.clear(); state.me = null; state.authView = 'login'; render();
        toast('Password changed, and every device was signed out. Log in with your new password.');
      } catch (ex) {
        err.textContent = ex.status === 400 && !(ex.response && ex.response.data && ex.response.data.password)
          ? 'This link is invalid or has expired. Please request a new one.' : errorText(ex);
        submit.disabled = false;
      }
    },
  }, h('h2', {}, 'Choose a new password'),
  h('label', {}, 'New password'), pass, h('label', {}, 'Confirm new password'), pass2,
  h('div', { class: 'muted small' }, 'At least 8 characters.'), err, submit,
  h('p', { style: 'text-align:center;margin:1rem 0 0' }, h('button', { class: 'link', type: 'button', onclick: leave }, 'Back to log in')));
  return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    themeToggle(), h('div', { class: 'brand' }, icon('logo'), 'Session Xero'), form));
}

function openForgotPassword() {
  const id = h('input', { type: 'text', autocomplete: 'username', placeholder: 'Username or recovery email' });
  const err = h('div', { class: 'field-error' });
  const body = h('div', {},
    h('h2', {}, 'Reset your password'),
    h('p', { class: 'muted', style: 'margin-top:0' }, "Enter your username or recovery email. We'll email a reset link to the recovery email on your account. This only works if you've added and confirmed one."),
    id, err,
    h('div', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        err.textContent = '';
        if (!id.value.trim()) { err.textContent = 'Enter your username or email'; return; }
        try {
          await api('/password/forgot', { body: { identifier: id.value }, quiet: true });
          body.replaceChildren(h('h2', {}, 'Check your email'),
            h('p', {}, "If that matches an account with a confirmed recovery email, we've sent it a reset link. The link expires in 1 hour."),
            h('p', { class: 'muted small' }, "Nothing arrived? Check spam. If you never added a recovery email, and you linked Google, you can still sign in with Google and set a new password."),
            h('div', { class: 'modal-foot' }, h('button', { class: 'btn primary', onclick: closeModal }, 'OK')));
        } catch (ex) { err.textContent = ex.message; }
      } }, 'Send reset link')));
  openModal(body);
}

// First Google sign-in created an account with a generated username: offer to change it.
function openPickUsername() {
  const user = h('input', { type: 'text', maxlength: 20, autocomplete: 'username', value: state.me.username });
  const err = h('div', { class: 'field-error' });
  const next = () => { closeModal(); openProfileEditor({ onboarding: true }); };
  openModal(h('form', {
    onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      try {
        if (user.value.trim() !== state.me.username) await api('/username', { method: 'PUT', body: { username: user.value } });
        state.me = await api('/me'); render(); next();
      } catch (ex) { err.textContent = ex.message; }
    },
  }, h('h2', {}, 'Pick your username'),
  h('p', { class: 'muted', style: 'margin-top:0' }, `Your account is set up with Google. We picked the username "${state.me.username}". It's how other players find and invite you, so change it now if you like.`),
  h('label', {}, 'Username'), user, h('div', { class: 'muted small' }, '3–20 letters, numbers, _ or -.'), err,
  h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: next }, 'Keep it'),
    h('button', { class: 'btn primary', type: 'submit' }, 'Save username'))));
}

// "Continue with Google" (PocketBase OAuth2 in a popup). Returns null when Google isn't set up on the server.
// While signed in, the same flow links Google to the current account instead of signing in.
function googleButton(label, onDone, onError) {
  if (!googleEnabled()) return null;
  const btn = h('button', { class: 'btn google-btn', type: 'button', onclick: async () => {
    const before = pb.authStore.token, beforeRecord = pb.authStore.record;
    btn.disabled = true;
    try {
      const auth = await pb.collection('users').authWithOAuth2({ provider: 'google' });
      // Linking a Google account that already belongs to someone else would switch accounts; undo that.
      if (before && beforeRecord && auth.record.id !== beforeRecord.id) {
        pb.authStore.save(before, beforeRecord);
        throw new Error('That Google account is already linked to a different user');
      }
      await onDone(auth);
    } catch (ex) {
      const msg = ex.isAbort || /cancel|closed/i.test(String(ex.message)) ? '' : (ex.response ? errorText(ex) : ex.message);
      if (msg) (onError || (m => toast(m, true)))(msg);
    } finally { btn.disabled = false; }
  } }, icon('google'), label);
  return btn;
}

// ============================================================ shell (top bar, host button)
let badgeEl, msgBadgeEl, notifWrap;
function shell() {
  badgeEl = h('span', { class: 'badge hidden' });
  msgBadgeEl = h('span', { class: 'nav-badge hidden', 'aria-label': 'unread messages' });
  const bell = h('button', { class: 'icon-btn', title: 'Notifications', 'aria-label': 'Notifications', onclick: e => { e.stopPropagation(); toggleNotifications(); } }, icon('bell'), badgeEl);
  notifWrap = h('div', { style: 'position:relative' }, bell);
  const nav = h('nav', { class: 'nav' },
    h('a', { href: '#/calendar', 'data-r': 'calendar' }, 'Calendar'),
    h('a', { href: '#/find', 'data-r': 'find' }, 'Find games'),
    h('a', { href: '#/messages', 'data-r': 'messages' }, 'Messages', msgBadgeEl),
    state.me.isAdmin && h('a', { href: '#/admin', 'data-r': 'admin' }, 'Admin'));
  const userBtn = h('button', { class: 'icon-btn', title: 'Profile and availability', 'aria-label': 'Profile menu', onclick: e => { e.stopPropagation(); openPopover(userBtn, [
    { label: `Signed in as ${state.me.username}`, onClick: () => {} },
    { label: 'View my profile', onClick: () => openProfile(state.me.id) },
    { label: 'Edit profile', onClick: () => openProfileEditor() },
    { label: 'Availability', onClick: openAvailability },
    { label: 'Password & sign-in', onClick: openSecurity },
    { label: 'Log out', danger: true, onClick: () => { pb.authStore.clear(); state.me = null; state.authView = 'login'; render(); } },
  ]); } }, icon('user'), h('span', { class: 'avail-btn-label' }, 'Profile'));
  return h('div', {},
    h('header', { class: 'topbar' },
      h('a', { href: '#/calendar', class: 'brand', style: 'text-decoration:none;color:inherit' }, icon('logo'), h('span', {}, 'Session Xero')),
      nav,
      h('div', { class: 'top-right' },
        notifWrap, themeToggle(), userBtn)),
    h('main', { id: 'view' }),
    h('button', { class: 'fab', title: 'Host a game', onclick: () => openGameEditor() },
      h('span', { class: 'fab-plus', 'aria-hidden': 'true' }, '+'), h('span', { class: 'fab-label' }, 'Host a game')));
}

async function renderView() {
  clearViewTimers(); closePopover();
  const view = document.getElementById('view');
  if (!view) return;
  const r = route();
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.r === r.name || (r.name === 'game' && a.dataset.r === 'calendar')));
  view.innerHTML = '';
  try {
    if (r.name === 'find') await viewFind(view);
    else if (r.name === 'messages') await viewMessages(view, r.parts[1], r.parts[2]);
    else if (r.name === 'game') await viewGame(view, r.parts[1]);
    else if (r.name === 'admin' && state.me.isAdmin) await viewAdmin(view);
    else await viewCalendar(view);
  } catch (e) { view.append(h('div', { class: 'empty' }, e.message)); }
}

// ============================================================ notifications
let badgeTimer;
const countLabel = n => (n > 99 ? '99+' : String(n));
// Bell = notifications; red count on the Messages tab = unread DMs and game-board posts.
async function refreshBadges() {
  let me;
  try { me = await api('/me', { quiet: true }); } catch { return; }
  state.unread = me.unread;
  badgeEl.textContent = countLabel(state.unread); badgeEl.classList.toggle('hidden', !state.unread);
  msgBadgeEl.textContent = countLabel(me.unreadMessages); msgBadgeEl.classList.toggle('hidden', !me.unreadMessages);
}
function pollBadge() {
  clearInterval(badgeTimer);
  refreshBadges(); badgeTimer = setInterval(refreshBadges, 10000);
}
async function toggleNotifications() {
  const existing = notifWrap.querySelector('.dropdown');
  if (existing) return existing.remove();
  const dd = h('div', { class: 'dropdown', onclick: e => e.stopPropagation() }, h('div', { class: 'muted small', style: 'padding:.5rem' }, 'Loading…'));
  notifWrap.append(dd);
  document.addEventListener('click', function off() { dd.remove(); document.removeEventListener('click', off); });
  const list = await api('/notifications');
  api('/notifications/read', { body: {} }).then(() => { state.unread = 0; badgeEl.classList.add('hidden'); });
  dd.innerHTML = '';
  if (!list.length) dd.append(h('div', { class: 'empty' }, 'No notifications yet.'));
  for (const n of list) dd.append(notificationItem(n, dd));
}
function notificationItem(n, dd) {
  const p = n.payload, close = () => dd.remove();
  const openGame = p.gameId && h('button', { class: 'btn small', onclick: () => { close(); go('#/game/' + p.gameId); } }, 'Open game');
  let text, actions = [];
  switch (n.type) {
    case 'join_request':
      text = `${p.username} asked to join “${p.gameTitle}”. Chat with them, then decide.`;
      actions = [
        h('button', { class: 'btn small', onclick: () => { close(); go('#/messages/dm/' + p.threadId); } }, 'Open chat'),
        h('button', { class: 'btn small primary', onclick: act(async () => { await api(`/requests/${p.requestId}/approve`, { body: {} }); toast(`${p.username} joined ${p.gameTitle}`); close(); refreshMyGames(); }) }, 'Let them in'),
        h('button', { class: 'btn small danger', onclick: act(async () => { await api(`/requests/${p.requestId}/decline`, { body: {} }); toast('Request declined'); close(); }) }, 'Decline'),
      ]; break;
    case 'request_approved': text = `You're in! Your request to join “${p.gameTitle}” was approved.`; actions = [openGame]; break;
    case 'request_declined': text = `Your request to join “${p.gameTitle}” was declined.`; break;
    case 'game_invite':
      text = `${p.gm} invited you to “${p.gameTitle}”.`;
      actions = [
        h('button', { class: 'btn small primary', onclick: act(async () => { const r = await api(`/invites/${p.inviteId}/accept`, { body: {} }); close(); await refreshMyGames(); go('#/game/' + r.gameId); }) }, 'Accept'),
        h('button', { class: 'btn small danger', onclick: act(async () => { await api(`/invites/${p.inviteId}/decline`, { body: {} }); toast('Invite declined'); close(); }) }, 'Decline'),
      ]; break;
    case 'player_joined': text = `${p.username} joined “${p.gameTitle}” with your invite link.`; actions = [openGame]; break;
    case 'player_left': text = `${p.username} left “${p.gameTitle}”.`; break;
    case 'invite_accepted': text = `${p.username} accepted your invite to “${p.gameTitle}”.`; actions = [openGame]; break;
    case 'invite_declined': text = `${p.username} declined your invite to “${p.gameTitle}”.`; break;
    case 'kicked': text = `You were removed from “${p.gameTitle}” by the GM.`; break;
    case 'game_cancelled': text = `The GM deleted “${p.gameTitle}”.`; break;
    default: text = n.type;
  }
  return h('div', { class: 'notif' + (n.isRead ? '' : ' unread') }, h('div', {}, text),
    h('div', { class: 'muted small' }, fmtStamp(n.createdAt)), actions.length ? h('div', { class: 'row' }, actions) : null);
}

async function refreshMyGames() { state.myGames = await api('/games/mine'); return state.myGames; }

// ============================================================ calendar view
async function viewCalendar(view) {
  await refreshMyGames();
  const c = state.calCursor;
  const title = state.calMode === 'month'
    ? c.toLocaleDateString([], { month: 'long', year: 'numeric' })
    : (() => { const s = startOfWeek(c), e = new Date(s); e.setDate(e.getDate() + 6); return `${fmtDate(s)} – ${fmtDate(e)}`; })();
  const shift = dir => {
    const d = new Date(state.calCursor);
    if (state.calMode === 'month') { d.setDate(1); d.setMonth(d.getMonth() + dir); } else d.setDate(d.getDate() + 7 * dir);
    state.calCursor = d; renderView();
  };
  const mode = m => h('button', { class: 'btn', 'aria-pressed': String(state.calMode === m), onclick: () => { state.calMode = m; renderView(); } }, m === 'month' ? 'Month' : 'Week');
  view.append(h('div', { class: 'cal-head' },
    h('button', { class: 'btn', onclick: () => shift(-1), 'aria-label': 'Previous' }, '‹'),
    h('button', { class: 'btn', onclick: () => shift(1), 'aria-label': 'Next' }, '›'),
    h('button', { class: 'btn', onclick: () => { state.calCursor = new Date(); renderView(); } }, 'Today'),
    h('h2', {}, title), h('div', { class: 'spacer' }),
    h('div', { class: 'seg' }, mode('month'), mode('week'))));
  view.append(state.calMode === 'month' ? monthGrid(c) : weekGrid(c));
  view.append(h('div', { class: 'legend' }, h('span', {}, 'Playing'), h('span', { class: 'gm' }, "You're the GM")));
  if (!state.myGames.length) view.append(h('div', { class: 'empty' },
    'No games on your calendar yet. ', h('button', { class: 'link', onclick: () => go('#/find') }, 'Find a public game'),
    ' or press + Host a game (bottom left) to run your own.'));
}
function startOfWeek(d) { const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()); s.setDate(s.getDate() - s.getDay()); return s; }
function eventsBetween(from, to) {
  const evs = [];
  for (const g of state.myGames) for (const start of occurrences(g, from, to)) evs.push({ g, start });
  return evs.sort((a, b) => a.start - b.start);
}
function monthGrid(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first), gridEnd = new Date(gridStart); gridEnd.setDate(gridEnd.getDate() + 42);
  const byDay = {};
  for (const ev of eventsBetween(gridStart, gridEnd)) (byDay[dateKey(ev.start)] ||= []).push(ev);
  const grid = h('div', { class: 'month' }, DAY_NAMES.map(d => h('div', { class: 'dow' }, d.slice(0, 3))));
  const today = new Date();
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart); d.setDate(d.getDate() + i);
    const cls = 'cell' + (d.getMonth() !== cursor.getMonth() ? ' other' : '') + (sameDay(d, today) ? ' today' : '');
    grid.append(h('div', { class: cls }, h('div', { class: 'num' }, d.getDate()),
      (byDay[dateKey(d)] || []).map(ev => h('button', { class: 'chip' + (ev.g.isGM ? ' gm' : ''), title: `${ev.g.title} — ${fmtTime(ev.start)}`, onclick: () => go('#/game/' + ev.g.id) },
        `${fmtTime(ev.start)} ${ev.g.title}`))));
  }
  return grid;
}
function weekGrid(cursor) {
  const HOUR = 44, s = startOfWeek(cursor), e = new Date(s); e.setDate(e.getDate() + 7);
  const today = new Date();
  const head = h('div', { class: 'week-head' }, h('div'));
  const hours = h('div', { class: 'week-hours' }, Array.from({ length: 24 }, (_, i) => h('div', {}, i ? fmtTime(new Date(2000, 0, 1, i)) : '')));
  const body = h('div', { class: 'week-body' }, hours);
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(s); d.setDate(d.getDate() + i);
    head.append(h('div', { class: sameDay(d, today) ? 'today' : '' }, d.toLocaleDateString([], { weekday: 'short', day: 'numeric' })));
    const col = h('div', { class: 'week-col' }); cols.push(col); body.append(col);
  }
  for (const ev of eventsBetween(s, e)) {
    const idx = Math.round((new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate()) - s) / 864e5);
    if (idx < 0 || idx > 6) continue;
    const startMin = ev.start.getHours() * 60 + ev.start.getMinutes();
    const len = Math.min(ev.g.durationMin, 1440 - startMin);
    const end = new Date(ev.start.getTime() + ev.g.durationMin * 60000);
    cols[idx].append(h('button', {
      class: 'week-ev' + (ev.g.isGM ? ' gm' : ''), onclick: () => go('#/game/' + ev.g.id),
      style: `top:${startMin / 60 * HOUR}px;height:${Math.max(len / 60 * HOUR - 2, 20)}px`,
    }, h('strong', {}, ev.g.title), h('div', { class: 'muted' }, `${fmtTime(ev.start)} – ${fmtTime(end)}`)));
  }
  setTimeout(() => { body.scrollTop = 8 * HOUR; }, 0);
  return h('div', { class: 'week' }, head, body);
}

// ============================================================ clock time picker
function clockPicker(initial = '19:00') {
  let [H, M] = initial.split(':').map(Number);
  let mode = 'h';
  const R = 110, NR = 84;
  const face = svg('svg', { class: 'clock-face', width: 220, height: 220, viewBox: '0 0 220 220' });
  const hBtn = h('button', { type: 'button', onclick: () => { mode = 'h'; draw(); } });
  const mBtn = h('button', { type: 'button', onclick: () => { mode = 'm'; draw(); } });
  const am = h('button', { type: 'button', onclick: () => { if (H >= 12) H -= 12; draw(); } }, 'AM');
  const pm = h('button', { type: 'button', onclick: () => { if (H < 12) H += 12; draw(); } }, 'PM');
  const pos = (i, n) => { const a = (i / n) * 2 * Math.PI - Math.PI / 2; return [R + NR * Math.cos(a), R + NR * Math.sin(a)]; };
  function pick(evt, final) {
    const b = face.getBoundingClientRect();
    const x = evt.clientX - b.left - R, y = evt.clientY - b.top - R;
    let ang = Math.atan2(y, x) + Math.PI / 2; if (ang < 0) ang += 2 * Math.PI;
    if (mode === 'h') {
      let hr = Math.round(ang / (Math.PI / 6)) % 12; if (hr === 0) hr = 12;
      const isPM = H >= 12; H = (hr % 12) + (isPM ? 12 : 0);
      if (final) mode = 'm';
    } else M = (Math.round(ang / (Math.PI / 30) / 5) * 5) % 60;
    draw();
  }
  let dragging = false;
  face.addEventListener('pointerdown', e => { dragging = true; face.setPointerCapture(e.pointerId); pick(e, false); });
  face.addEventListener('pointermove', e => { if (dragging) pick(e, false); });
  face.addEventListener('pointerup', e => { if (dragging) { dragging = false; pick(e, true); } });
  function draw() {
    const h12 = H % 12 || 12;
    hBtn.textContent = h12; mBtn.textContent = pad(M);
    hBtn.classList.toggle('on', mode === 'h'); mBtn.classList.toggle('on', mode === 'm');
    am.classList.toggle('on', H < 12); pm.classList.toggle('on', H >= 12);
    face.innerHTML = '';
    face.append(svg('circle', { cx: R, cy: R, r: R - 2, fill: 'var(--bg)', stroke: 'var(--line)' }));
    const selIdx = mode === 'h' ? h12 % 12 : M / 5;
    const [hx, hy] = pos(mode === 'h' ? h12 % 12 : M, mode === 'h' ? 12 : 60);
    face.append(svg('line', { x1: R, y1: R, x2: hx, y2: hy, stroke: 'var(--accent)', 'stroke-width': 2 }));
    face.append(svg('circle', { cx: R, cy: R, r: 4, fill: 'var(--accent)' }));
    for (let i = 0; i < 12; i++) {
      const [x, y] = pos(i, 12), sel = i === selIdx;
      const label = mode === 'h' ? (i || 12) : pad(i * 5);
      face.append(svg('circle', { class: 'num' + (sel ? ' sel' : ''), cx: x, cy: y, r: 16 }));
      face.append(svg('text', { x, y, class: sel ? 'sel' : '' }, label));
    }
  }
  draw();
  const el = h('div', { class: 'clock-wrap' },
    h('div', { class: 'clock-readout' }, hBtn, ':', mBtn, h('div', { class: 'ampm' }, am, pm)),
    face, h('div', { class: 'muted small' }, 'Tap or drag: hour first, then minutes'));
  return { el, get: () => `${pad(H)}:${pad(M)}` };
}

// ============================================================ host / edit game modal
function openGameEditor(game) {
  const editing = !!game;
  const start = editing ? new Date(game.startAt) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })();
  const title = h('input', { type: 'text', maxlength: 100, value: editing ? game.title : '', placeholder: 'e.g. Curse of the Sunken Keep — D&D 5e' });
  const date = h('input', { type: 'date', value: dateKey(start), required: true });
  const dateLabel = h('label', {}, 'Date');
  const clock = clockPicker(editing ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '19:00');
  const duration = h('select', {}, [60, 90, 120, 150, 180, 210, 240, 300, 360, 480].map(m =>
    h('option', { value: m, selected: (editing ? game.durationMin : 180) === m }, durLabel(m))));
  const radio = (name, value, label, sub, checked) =>
    h('label', {}, h('input', { type: 'radio', name, value, checked }), label, sub && h('small', {}, sub));
  const rec = editing ? game.recurrence : 'none';
  const recurrence = h('div', { class: 'radio-cards four' },
    radio('rec', 'none', 'One-time', 'A single session', rec === 'none'),
    radio('rec', 'weekly', 'Weekly', 'One or more days each week', rec === 'weekly'),
    radio('rec', 'monthly', 'Monthly by date', 'e.g. the 1st & 15th', rec === 'monthly'),
    radio('rec', 'monthly_weekday', 'Monthly by weekday', 'e.g. 1st & 3rd Tuesday', rec === 'monthly_weekday'));

  // Pattern choices. Defaults come from the start date until the GM picks something themselves.
  const selectedDate = () => { const [y, mo, d] = date.value.split('-').map(Number); return new Date(y, mo - 1, d); };
  const p0 = editing && game.recurrence !== 'none' ? gamePattern(game) : {};
  const sel = { days: new Set(p0.days), dates: new Set(p0.dates), weeks: new Set(p0.weeks), weekdays: new Set(p0.weekdays), every: p0.every || 1 };
  let touched = editing && game.recurrence !== 'none';
  function applyDefaults() {
    if (touched || !date.value) return;
    const d = selectedDate(), last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    sel.days = new Set([d.getDay()]); sel.weekdays = new Set([d.getDay()]); sel.dates = new Set([d.getDate()]);
    sel.weeks = new Set([d.getDate() + 7 > last && Math.ceil(d.getDate() / 7) > 4 ? 5 : Math.ceil(d.getDate() / 7)]);
  }
  applyDefaults();
  const toggles = (set, items, cls = '') => h('div', { class: 'toggle-grid ' + cls }, items.map(([value, label]) =>
    h('button', { type: 'button', class: 'toggle', 'aria-pressed': String(set.has(value)),
      onclick: () => { touched = true; set.has(value) ? set.delete(value) : set.add(value); drawPattern(); } }, label)));
  const everySelect = () => h('div', { class: 'row', style: 'margin-top:.5rem' }, h('span', { class: 'small' }, 'Repeat every'),
    h('select', { style: 'width:auto', onchange: e => { touched = true; sel.every = Number(e.target.value); drawPattern(); } },
      Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1, selected: sel.every === i + 1 }, i ? `${i + 1} months` : 'month'))));
  const patternBox = h('div', { class: 'pattern-box' });
  const currentRec = () => form.querySelector('input[name=rec]:checked').value;
  function patternBody(r) {
    if (r === 'weekly') return { days: [...sel.days] };
    if (r === 'monthly') return { dates: [...sel.dates], every: sel.every };
    if (r === 'monthly_weekday') return { weeks: [...sel.weeks], weekdays: [...sel.weekdays], every: sel.every };
    return null;
  }
  function drawPattern() {
    const r = currentRec();
    patternBox.innerHTML = ''; patternBox.classList.toggle('hidden', r === 'none');
    const dayItems = DAY_NAMES.map((n, i) => [i, n.slice(0, 3)]);
    if (r === 'weekly') patternBox.append(h('div', { class: 'small' }, 'On these days'), toggles(sel.days, dayItems));
    if (r === 'monthly') patternBox.append(h('div', { class: 'small' }, 'On these dates'),
      toggles(sel.dates, Array.from({ length: 31 }, (_, i) => [i + 1, i + 1]), 'dates'), everySelect(),
      [...sel.dates].some(d => d > 28) && h('div', { class: 'muted small' }, 'Dates a month doesn’t have (like the 31st) move to its last day.'));
    if (r === 'monthly_weekday') patternBox.append(h('div', { class: 'small' }, 'Week of the month'),
      toggles(sel.weeks, Object.entries(WEEK_NAMES).map(([k, v]) => [Number(k), v[0].toUpperCase() + v.slice(1)])),
      h('div', { class: 'small', style: 'margin-top:.5rem' }, 'Day of the week'), toggles(sel.weekdays, dayItems), everySelect());
    if (r === 'none' || !date.value) return;
    // Preview the next few sessions so the GM can check the pattern.
    const [hh, mm] = clock.get().split(':').map(Number), d = selectedDate();
    const g = { startAt: new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).toISOString(), durationMin: 60,
      recurrence: r, pattern: patternBody(r), timeZone: LOCAL_TZ };
    const p = g.pattern, empty = Object.values(p).some(v => Array.isArray(v) && !v.length);
    const occ = empty ? [] : occurrences(g, new Date(g.startAt), new Date(new Date(g.startAt).getTime() + 800 * 864e5)).slice(0, 5);
    patternBox.append(h('div', { class: 'muted small', style: 'margin-top:.6rem' }, occ.length
      ? `${recurrenceLabel(g)}. Next: ${occ.map(fmtDate).join(' · ')}` : 'Pick at least one option in each row.'));
  }
  const vis = editing ? game.visibility : 'public';
  const visibility = h('div', { class: 'radio-cards' },
    radio('vis', 'public', 'Public', 'Listed; players request to join', vis === 'public'),
    radio('vis', 'invite', 'Invite only', 'Unlisted; anyone with your link joins', vis === 'invite'),
    radio('vis', 'private', 'Private', 'Unlisted; you invite by username', vis === 'private'));
  const desc = h('textarea', { rows: 6, placeholder: 'System, tone, experience level, safety tools, what to bring…' });
  desc.value = editing ? game.description : '';
  const count = h('span', { class: 'small' });
  const err = h('div', { class: 'field-error' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, editing ? 'Save changes' : 'Create game');
  const updateCount = () => {
    const n = (desc.value.trim().match(/\S+/g) || []).length;
    count.textContent = `${n} / 500 words`; count.style.color = n > 500 ? 'var(--danger)' : 'var(--muted)';
    save.disabled = n > 500;
  };
  desc.addEventListener('input', updateCount); updateCount();

  const form = h('form', {
    onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      const [y, mo, d] = date.value.split('-').map(Number);
      const [hh, mm] = clock.get().split(':').map(Number);
      const startAt = new Date(y, mo - 1, d, hh, mm);
      const body = {
        title: title.value, description: desc.value, startAt: startAt.toISOString(), durationMin: Number(duration.value),
        recurrence: currentRec(), pattern: patternBody(currentRec()), visibility: form.querySelector('input[name=vis]:checked').value,
        timeZone: LOCAL_TZ,
      };
      save.disabled = true;
      try {
        let id = game && game.id;
        if (editing) await api('/games/' + id, { method: 'PUT', body });
        else id = (await api('/games', { body })).id;
        closeModal(); toast(editing ? 'Game updated' : 'Game created — share your invite link from the game page');
        await refreshMyGames(); go('#/game/' + id);
      } catch (ex) { err.textContent = ex.message; save.disabled = false; }
    },
  },
  h('h2', {}, editing ? 'Edit game' : 'Host a game'),
  h('label', {}, 'Game title'), title,
  h('div', { class: 'two-col', style: 'margin-top:.4rem' },
    h('div', {}, dateLabel, date, h('label', {}, 'Session length'), duration),
    h('div', {}, h('label', {}, 'Start time'), clock.el,
      h('div', { class: 'muted small', style: 'text-align:center;margin-top:.3rem' }, `In your time zone (${LOCAL_TZ.replace(/_/g, ' ')}). Players see it in theirs.`))),
  h('label', {}, 'Repeats'), recurrence, patternBox,
  h('div', { class: 'row', style: 'justify-content:space-between' }, h('label', {}, 'Description'), count), desc,
  h('label', {}, 'Who can join'), visibility,
  err,
  h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'), save));
  const refresh = () => { dateLabel.textContent = currentRec() === 'none' ? 'Date' : 'Starting from'; drawPattern(); };
  recurrence.addEventListener('change', refresh);
  date.addEventListener('change', () => { applyDefaults(); drawPattern(); });
  clock.el.addEventListener('click', () => setTimeout(drawPattern, 0)); // time can move a session across midnight for players
  refresh();
  openModal(form, { wide: true });
}

// ============================================================ availability modal (upper right)
async function openAvailability() {
  const saved = await api('/availability').catch(e => { toast(e.message, true); return null; });
  if (!saved) return;
  const slots = saved.map(s => ({ date: s.date, repeat: s.repeat, start: minsToHHMM(s.start), end: s.end === 1440 ? '23:59' : minsToHHMM(s.end) }));
  let cursor = new Date(); cursor.setDate(1);
  let selected = new Date(); selected.setHours(0, 0, 0, 0);
  const gridBox = h('div'), panel = h('div', { class: 'avail-panel' });
  const err = h('div', { class: 'field-error' });
  const shortTime = hhmm => fmtMinsLabel(hhmmToMins(hhmm)).replace(':00', '').replace(/\s?([AP])M$/i, (_, x) => x.toLowerCase());

  function drawGrid() {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1), gridStart = startOfWeek(first), today = new Date();
    const shift = dir => { cursor.setMonth(cursor.getMonth() + dir); drawGrid(); };
    const grid = h('div', { class: 'month mini' }, DAY_NAMES.map(d => h('div', { class: 'dow' }, d.slice(0, 2))));
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart); d.setDate(d.getDate() + i);
      const on = slots.filter(s => slotOnDate(s, d)).sort((a, b) => a.start.localeCompare(b.start));
      const cls = 'cell' + (d.getMonth() !== cursor.getMonth() ? ' other' : '') + (sameDay(d, today) ? ' today' : '') + (sameDay(d, selected) ? ' sel' : '');
      grid.append(h('button', { type: 'button', class: cls, onclick: () => { selected = d; if (d.getMonth() !== cursor.getMonth()) cursor = new Date(d.getFullYear(), d.getMonth(), 1); drawGrid(); drawPanel(); } },
        h('div', { class: 'num' }, d.getDate()),
        on.map(s => h('div', { class: 'chip' }, (s.repeat === 'none' ? '' : '↻ ') + `${shortTime(s.start)}–${shortTime(s.end)}`))));
    }
    gridBox.replaceChildren(
      h('div', { class: 'cal-head' },
        h('button', { class: 'btn small', type: 'button', onclick: () => shift(-1), 'aria-label': 'Previous month' }, '‹'),
        h('button', { class: 'btn small', type: 'button', onclick: () => shift(1), 'aria-label': 'Next month' }, '›'),
        h('strong', {}, cursor.toLocaleDateString([], { month: 'long', year: 'numeric' }))),
      grid);
  }

  function drawPanel() {
    const key = dateKey(selected);
    const box = h('div', { class: 'slots' });
    for (const s of slots.filter(s => slotOnDate(s, selected))) {
      const a = parseDateKey(s.date);
      const repeat = h('select', { onchange: e => { s.repeat = e.target.value; drawGrid(); drawPanel(); } },
        h('option', { value: 'none', selected: s.repeat === 'none' }, "Doesn't repeat"),
        h('option', { value: 'weekly', selected: s.repeat === 'weekly' }, `Weekly on ${DAY_NAMES[a.getDay()]}s`),
        h('option', { value: 'monthly', selected: s.repeat === 'monthly' }, `Monthly on the ${ordinal(a.getDate())}`));
      box.append(h('div', { class: 'avail-slot' },
        h('div', { class: 'slot' },
          h('input', { type: 'time', value: s.start, oninput: e => { s.start = e.target.value; drawGrid(); } }),
          h('span', { class: 'muted' }, 'to'),
          h('input', { type: 'time', value: s.end, oninput: e => { s.end = e.target.value; drawGrid(); } }),
          h('button', { class: 'btn small ghost', type: 'button', title: s.repeat === 'none' ? 'Remove' : 'Remove every repeat', onclick: () => { slots.splice(slots.indexOf(s), 1); drawGrid(); drawPanel(); } }, '✕')),
        repeat,
        s.date !== key && h('div', { class: 'muted small' }, `Repeats from ${fmtDate(a)}. Changes apply to every repeat.`)));
    }
    if (!box.children.length) box.append(h('span', { class: 'muted small' }, 'Not available'));
    box.append(h('div', {}, h('button', { class: 'btn small', type: 'button', onclick: () => { slots.push({ date: key, repeat: 'none', start: '18:00', end: '22:00' }); drawGrid(); drawPanel(); } }, '+ Add time')));
    panel.replaceChildren(h('strong', {}, fmtDateLong(selected)), box);
  }
  drawGrid(); drawPanel();

  const save = async () => {
    err.textContent = '';
    const out = [];
    for (const s of slots) {
      if (!s.start || !s.end) { err.textContent = `Fill in both times for ${fmtDate(parseDateKey(s.date))}`; return; }
      let end = hhmmToMins(s.end); if (end === 23 * 60 + 59) end = 1440;
      const start = hhmmToMins(s.start);
      if (start >= end) { err.textContent = `Start time must be before end time (${fmtDate(parseDateKey(s.date))})`; return; }
      out.push({ date: s.date, repeat: s.repeat, start, end });
    }
    try {
      await api('/availability', { method: 'PUT', body: { slots: out } });
      state.availability = out; closeModal(); toast('Availability saved');
      if (route().name === 'find') renderView();
    } catch (e) { err.textContent = e.message; }
  };
  openModal(h('div', {},
    h('h2', {}, 'Your availability'),
    h('p', { class: 'muted', style: 'margin-top:0' }, 'Pick a day, add the times you can play, and choose whether they repeat weekly or monthly. Find games will only show public games that fit inside these windows.'),
    h('div', { class: 'avail-cal' }, gridBox, panel), err,
    h('div', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: () => { slots.length = 0; drawGrid(); drawPanel(); } }, 'Clear all'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: save }, 'Save availability'))), { wide: true });
}

// ============================================================ profiles
// Preferred name if set, otherwise the username.
const nameOf = u => u.displayName || u.username;
const pronounTag = u => u.pronouns ? h('span', { class: 'muted small' }, ` (${u.pronouns})`) : null;

async function openProfile(userId) {
  const u = await api('/users/' + userId).catch(e => { toast(e.message, true); return null; });
  if (!u) return;
  const mine = u.id === state.me.id;
  const since = new Date(u.memberSince);
  openModal(h('div', {},
    h('div', { class: 'profile-head' },
      h('h2', { style: 'margin:0' }, nameOf(u)), u.pronouns && h('span', { class: 'pill' }, u.pronouns)),
    h('div', { class: 'muted small', style: 'margin:.2rem 0 1rem' }, `@${u.username} · joined ${since.toLocaleDateString([], { month: 'long', year: 'numeric' })}`),
    h('div', { class: 'desc-full' }, u.bio || h('span', { class: 'muted' }, mine ? "You haven't written a bio yet." : 'No bio yet.')),
    h('div', { class: 'modal-foot' },
      mine ? h('button', { class: 'btn', onclick: () => openProfileEditor() }, 'Edit profile')
        : h('button', { class: 'btn', onclick: act(async () => { closeModal(); await startDm(u.id); }) }, `Message ${nameOf(u)}`),
      h('button', { class: 'btn primary', onclick: closeModal }, 'Close'))));
}

function openProfileEditor({ onboarding } = {}) {
  const me = state.me;
  const name = h('input', { type: 'text', maxlength: 40, value: me.displayName || '', placeholder: me.username });
  const pronouns = h('input', { type: 'text', maxlength: 30, value: me.pronouns || '', placeholder: 'e.g. she/her, he/him, they/them', list: 'pronoun-options' });
  const options = h('datalist', { id: 'pronoun-options' }, ['she/her', 'he/him', 'they/them', 'she/they', 'he/they', 'any pronouns'].map(p => h('option', { value: p })));
  const bio = h('textarea', { rows: 6, placeholder: 'What you like to play, systems you know, how long you have been rolling dice, what you want from a table…' });
  bio.value = me.bio || '';
  const count = h('span', { class: 'small' });
  const err = h('div', { class: 'field-error' });
  const saveBtns = [];
  const updateCount = () => {
    const n = (bio.value.trim().match(/\S+/g) || []).length;
    count.textContent = `${n} / 300 words`; count.style.color = n > 300 ? 'var(--danger)' : 'var(--muted)';
    saveBtns.forEach(b => b.disabled = n > 300);
  };
  const save = next => async () => {
    err.textContent = '';
    const body = { displayName: name.value, pronouns: pronouns.value, bio: bio.value };
    try {
      await api('/profile', { method: 'PUT', body });
      state.me = await api('/me');
      closeModal(); toast('Profile saved');
      if (next) next();
    } catch (e) { err.textContent = e.message; }
  };
  const primary = h('button', { class: 'btn primary', onclick: save(onboarding ? openAvailability : null) }, onboarding ? 'Save and set availability' : 'Save profile');
  saveBtns.push(primary);
  if (onboarding) saveBtns.push(h('button', { class: 'btn', onclick: save(null) }, 'Save'));
  bio.addEventListener('input', updateCount); updateCount();
  openModal(h('div', {},
    h('h2', {}, onboarding ? `Welcome, ${me.username}!` : 'Edit profile'),
    h('p', { class: 'muted', style: 'margin-top:0' }, onboarding
      ? "Set up your profile so GMs and players know who they're rolling with. Everything here is optional and public to other members. You can change it any time from the Profile menu (top right)."
      : 'Your profile is visible to other members.'),
    h('div', { class: 'two-col' },
      h('div', {}, h('label', {}, 'Preferred name'), name),
      h('div', {}, h('label', {}, 'Pronouns'), pronouns, options)),
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('label', {}, 'Bio'), count), bio,
    err,
    h('div', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: closeModal }, onboarding ? 'Skip for now' : 'Cancel'),
      ...saveBtns.slice(1), primary)), { wide: true });
}

// ============================================================ password & sign-in (profile menu)
async function openSecurity() {
  try { state.me = await api('/me'); } catch (e) { return toast(e.message, true); }
  const me = state.me, reopen = () => openSecurity();
  const pw = () => h('input', { type: 'password', autocomplete: 'current-password' });
  const section = (title, ...kids) => h('section', { class: 'sec-section' }, h('h3', {}, title), ...kids);

  // Password
  const cur = pw(), next = h('input', { type: 'password', autocomplete: 'new-password' }), next2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const pwErr = h('div', { class: 'field-error' });
  const password = section(me.hasPassword ? 'Change password' : 'Set a password',
    !me.hasPassword && h('p', { class: 'muted small', style: 'margin-top:0' }, 'You sign in with Google. Adding a password gives you a second way in.'),
    me.hasPassword && [h('label', {}, 'Current password'), cur],
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, 'New password'), next), h('div', {}, h('label', {}, 'Confirm new password'), next2)),
    h('div', { class: 'muted small' }, 'At least 8 characters. Other devices will be signed out.'), pwErr,
    h('button', { class: 'btn primary', onclick: async () => {
      pwErr.textContent = '';
      if (next.value !== next2.value) { pwErr.textContent = "New passwords don't match"; return; }
      try {
        keepSession(await api('/password/change', { body: { currentPassword: cur.value, password: next.value } }));
        toast(me.hasPassword ? 'Password changed' : 'Password set'); reopen();
      } catch (e) { pwErr.textContent = e.message; }
    } }, me.hasPassword ? 'Change password' : 'Set password'));

  // Recovery email
  const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
  const emailPw = pw(), emErr = h('div', { class: 'field-error' });
  const recovery = section('Recovery email',
    h('p', { class: 'muted small', style: 'margin-top:0' }, 'Used only to reset your password if you forget it. It is never shown to other members.'),
    h('div', {}, me.email ? ['Current: ', h('strong', {}, me.email)] : h('span', { class: 'muted' }, 'No recovery email yet.')),
    me.pendingEmail && h('div', { class: 'banner small', style: 'margin-top:.4rem' }, `Waiting for you to confirm ${me.pendingEmail}. Check that inbox for the confirmation link.`),
    h('label', {}, me.email ? 'Change to' : 'Email address'), email,
    me.hasPassword && [h('label', {}, 'Current password'), emailPw], emErr,
    h('div', { class: 'row', style: 'margin-top:.4rem' },
      h('button', { class: 'btn primary', onclick: async () => {
        emErr.textContent = '';
        try {
          keepSession(await api('/account/email', { body: { email: email.value, currentPassword: emailPw.value } }));
          toast(`Confirmation link sent to ${email.value.trim()}`); reopen();
        } catch (e) { emErr.textContent = e.message; }
      } }, 'Send confirmation link'),
      me.email && h('button', { class: 'btn danger', onclick: async () => {
        emErr.textContent = '';
        if (!confirm('Remove your recovery email? You won’t be able to reset a forgotten password.')) return;
        try { keepSession(await api('/account/email/remove', { body: { currentPassword: emailPw.value } })); toast('Recovery email removed'); reopen(); }
        catch (e) { emErr.textContent = e.message; }
      } }, 'Remove')));

  // Google
  const gErr = h('div', { class: 'field-error' });
  const googleBox = section('Sign in with Google',
    me.googleLinked
      ? [h('div', {}, 'Linked. You can sign in with Google instead of your password.'),
         h('div', { class: 'row', style: 'margin-top:.5rem' }, h('button', { class: 'btn danger', disabled: !me.hasPassword, onclick: async () => {
           try { await api('/google/unlink', { body: {} }); toast('Google account unlinked'); reopen(); } catch (e) { gErr.textContent = e.message; }
         } }, 'Unlink Google')),
         !me.hasPassword && h('div', { class: 'muted small' }, 'Set a password above before unlinking, so you can still sign in.')]
      : [h('p', { class: 'muted small', style: 'margin-top:0' }, 'Link a Google account to sign in with one click instead of your password.'),
         googleButton('Link Google account', async () => { toast('Google account linked'); reopen(); }, msg => { gErr.textContent = msg; })
           || h('div', { class: 'muted small' }, "Google sign-in isn't set up on this server yet.")],
    gErr);

  openModal(h('div', {}, h('h2', {}, 'Password & sign-in'), password, recovery, googleBox,
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: closeModal }, 'Close'))), { wide: true });
}

// ============================================================ find games view
async function viewFind(view) {
  const [games, avail] = await Promise.all([api('/games/public'), api('/availability')]);
  state.availability = avail;
  const hasAvail = avail.length > 0;
  const search = h('input', { type: 'text', placeholder: 'Search by title, system or GM…', value: state.findQuery, style: 'max-width:340px' });
  const toggle = h('input', { type: 'checkbox', checked: state.onlyAvailable, disabled: !hasAvail, style: 'accent-color:var(--accent)' });
  const grid = h('div', { class: 'grid-cards' });
  const count = h('div', { class: 'muted small' });
  const now = new Date(), horizon = new Date(now.getTime() + 90 * 864e5);

  function draw() {
    const term = state.findQuery.toLowerCase();
    const filter = hasAvail && state.onlyAvailable;
    const rows = [];
    for (const g of games) {
      if (term && !(`${g.title} ${g.description} ${g.gm.username}`.toLowerCase().includes(term))) continue;
      const occs = occurrences(g, now, horizon);
      if (!occs.length) continue; // finished one-time games
      const next = filter ? occs.find(o => fitsAvailability(o, g.durationMin, avail)) : occs[0];
      if (!next) continue;
      rows.push({ g, next });
    }
    rows.sort((a, b) => a.next - b.next);
    grid.innerHTML = '';
    count.textContent = `${rows.length} game${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) grid.append(h('div', { class: 'empty', style: 'grid-column:1/-1' },
      filter ? 'No public games fit your availability yet. Widen your availability or turn off the filter.' : 'No public games yet — be the first to host one with + Host a game (bottom left).'));
    for (const { g, next } of rows) {
      const status = g.isGM ? h('span', { class: 'pill ok' }, 'Your game')
        : g.isMember ? h('span', { class: 'pill ok' }, 'Joined')
        : g.requestStatus === 'pending' ? h('span', { class: 'pill accent' }, 'Request sent') : null;
      grid.append(h('button', { class: 'game-card', onclick: () => (g.isMember ? go('#/game/' + g.id) : openJoinRequest(g, next)) },
        h('div', { class: 'row' }, h('h3', { style: 'margin:0;flex:1' }, g.title), status),
        h('div', { class: 'small' }, `${filter ? 'Fits you: ' : 'Next: '}${fmtDate(next)} · ${fmtTime(next)} (${durLabel(g.durationMin)})`),
        h('div', { class: 'row' }, h('span', { class: 'pill' }, recurrenceShort(g)), g.closed && h('span', { class: 'pill' }, 'Closed'),
          h('span', { class: 'pill' }, `GM ${g.gm.username}`), h('span', { class: 'pill' }, `${g.memberCount} at the table`)),
        g.description && h('div', { class: 'desc' }, g.description)));
    }
  }
  search.addEventListener('input', () => { state.findQuery = search.value; draw(); });
  toggle.addEventListener('change', () => { state.onlyAvailable = toggle.checked; draw(); });
  view.append(h('div', { class: 'row', style: 'margin-bottom:1rem' },
    h('h2', { style: 'margin:0' }, 'Public games'), count, h('div', { class: 'spacer' }), search,
    h('label', { class: 'row', style: 'margin:0;color:var(--text)' }, toggle, 'Only during my availability'),
    h('button', { class: 'btn' + (hasAvail ? '' : ' primary'), onclick: openAvailability }, icon('clock'), hasAvail ? ' Edit my availability' : ' Set my availability')));
  if (!hasAvail) view.append(h('div', { class: 'banner' }, 'Tip: ',
    h('button', { class: 'link', onclick: openAvailability }, 'set your availability'), ' to only see games at times you can play. You can also find it in the Profile menu.'));
  view.append(grid);
  draw();
}

function openJoinRequest(g, next) {
  const msg = h('textarea', { rows: 3, placeholder: 'Introduce yourself to the GM — experience, characters you like to play, questions…' });
  const pending = g.requestStatus === 'pending';
  openModal(h('div', {},
    h('h2', {}, g.title),
    h('div', { class: 'row', style: 'margin-bottom:.6rem' }, h('span', { class: 'pill' }, recurrenceLabel(g)), h('span', { class: 'pill' }, durLabel(g.durationMin)),
      h('span', { class: 'pill' }, `GM ${g.gm.username}`), h('span', { class: 'pill' }, `${g.memberCount} at the table`)),
    next && h('p', { class: 'small' }, `Next session: ${fmtDateLong(next)} at ${fmtTime(next)}${gmTimeNote(g, next)}`),
    h('div', { class: 'desc-full' }, g.description || 'No description.'),
    h('hr', { style: 'border:none;border-top:1px solid var(--line);margin:1rem 0' }),
    pending
      ? h('p', { class: 'muted' }, `Your request is with ${g.gm.username}. You'll get a notification when they decide — you can keep chatting in Messages.`)
      : [h('p', { class: 'muted small', style: 'margin-top:0' }, `Requesting doesn't add you to the game yet. ${g.gm.username} gets a notification and a chat with you, then decides whether to let you in.`),
        h('label', {}, 'Message to the GM (optional)'), msg],
    h('div', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: closeModal }, 'Close'),
      pending
        ? h('button', { class: 'btn primary', onclick: act(async () => { const r = await api(`/games/${g.id}/request`, { body: {} }); closeModal(); go('#/messages/dm/' + r.threadId); }) }, 'Open chat with GM')
        : h('button', { class: 'btn primary', onclick: act(async () => {
          const r = await api(`/games/${g.id}/request`, { body: { message: msg.value } });
          closeModal(); toast(`Request sent to ${g.gm.username}`); go('#/messages/dm/' + r.threadId);
        }) }, 'Ask to join'))));
}

// ============================================================ chat component (DMs + game boards)
// opts: { kind: 'dm'|'game', id, gmId, isGM, onUser(user, anchor, message) }
function chatBox(opts) {
  const base = opts.kind === 'dm' ? `/dms/${opts.id}/messages` : `/games/${opts.id}/messages`;
  const log = h('div', { class: 'chat-log' });
  const input = h('textarea', { placeholder: opts.kind === 'dm' ? 'Write a message…' : 'Post to the game board…', maxlength: 2000 });
  let lastJSON = '';
  async function load() {
    let msgs;
    try { msgs = await api(base); } catch (e) { log.innerHTML = ''; log.append(h('div', { class: 'empty' }, e.message)); clearViewTimers(); return; }
    const json = JSON.stringify(msgs);
    if (json === lastJSON) return;
    lastJSON = json;
    refreshBadges(); // loading the thread marked it read on the server
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.innerHTML = '';
    if (!msgs.length) log.append(h('div', { class: 'empty' }, opts.kind === 'dm' ? 'No messages yet. Say hello!' : 'No posts yet. Start the conversation!'));
    for (const m of msgs) log.append(messageEl(m));
    if (atBottom || !log.dataset.loaded) log.scrollTop = log.scrollHeight;
    log.dataset.loaded = '1';
  }
  function messageEl(m) {
    const mine = m.author.id === state.me.id;
    const author = h('button', { class: 'author' + (opts.gmId === m.author.id ? ' gm' : '') }, m.author.username);
    author.addEventListener('click', e => { e.stopPropagation(); opts.onUser && opts.onUser(m.author, author, m); });
    const actions = h('div', { class: 'actions' },
      m.canDelete && h('button', { class: 'btn small', title: 'Delete message', onclick: act(async () => {
        if (!confirm('Delete this message?')) return;
        await api('/messages/' + m.id, { method: 'DELETE' }); load();
      }) }, 'Delete'),
      !mine && !m.deleted && h('button', { class: 'btn small danger', title: 'Report', onclick: () => openReport(m.author, opts.kind, opts.id, m) }, 'Report'));
    return h('div', { class: 'msg' },
      h('div', { class: 'meta' }, author, h('span', {}, fmtStamp(m.createdAt))),
      h('div', { class: 'body' + (m.deleted ? ' deleted' : '') }, m.deleted ? 'Message deleted' : m.body), actions);
  }
  const send = act(async () => {
    const body = input.value.trim(); if (!body) return;
    input.value = '';
    await api(base, { body: { body } });
    await load();
    log.scrollTop = log.scrollHeight;
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  load(); every(3000, load);
  return h('div', { class: 'chat' }, log,
    h('div', { class: 'chat-input' }, input, h('button', { class: 'btn primary', onclick: send }, 'Send')),
    h('div', { class: 'muted small', style: 'margin-top:.3rem' }, 'Enter to send · Shift+Enter for a new line'));
}

function openReport(user, context, contextId, message) {
  const reason = h('textarea', { rows: 4, placeholder: 'What happened? This goes to the moderation team.' });
  const err = h('div', { class: 'field-error' });
  openModal(h('div', {},
    h('h2', {}, `Report ${user.username}`),
    message && !message.deleted && h('div', { class: 'banner small' }, h('strong', {}, 'Reported message: '), message.body),
    h('label', {}, 'Reason'), reason, err,
    h('div', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        try {
          await api('/reports', { body: { reportedId: user.id, context, contextId: String(contextId), messageId: message ? message.id : null, reason: reason.value } });
          closeModal(); toast('Report sent to the moderation team. Thank you.');
        } catch (e) { err.textContent = e.message; }
      } }, 'Send report'))));
}

async function startDm(userId) { const r = await api('/dms', { body: { userId } }); go('#/messages/dm/' + r.id); }

// Menu shown when clicking a name in a game board or member list.
function gameUserMenu(game, user, anchor, message) {
  if (user.id === state.me.id) return;
  openPopover(anchor, [
    { label: 'View profile', onClick: () => openProfile(user.id) },
    { label: `Message ${user.username}`, onClick: act(() => startDm(user.id)) },
    { label: `Report ${user.username}`, danger: true, onClick: () => openReport(user, 'game', game.id, message && !message.deleted ? message : null) },
    game.isGM && user.id !== game.gm.id && (game.members || []).some(m => m.id === user.id) &&
      { label: `Kick ${user.username} from game`, danger: true, onClick: act(async () => {
        if (!confirm(`Remove ${user.username} from "${game.title}"? They won't be able to rejoin with the invite link.`)) return;
        await api(`/games/${game.id}/kick`, { body: { userId: user.id } }); toast(`${user.username} was removed`); renderView();
      }) },
  ]);
}

// ============================================================ messages view
async function viewMessages(view, kind, id) {
  const [dms, games, unread] = await Promise.all([api('/dms'), refreshMyGames(), api('/unread')]);
  const list = h('div', { class: 'thread-list' });
  // Red count on each conversation with unread messages (not the one you have open; opening it reads it).
  const badges = { dm: {}, game: {} };
  const isOpen = (k, tid) => kind === k && id === tid;
  const threadButton = (k, tid, title, preview) => {
    const badge = badges[k][tid] = h('span', { class: 'thread-badge hidden' });
    return h('button', { class: 'thread-item' + (isOpen(k, tid) ? ' active' : ''), onclick: () => go(`#/messages/${k}/${tid}`) },
      h('div', { class: 'thread-title' }, h('span', {}, title), badge), h('div', { class: 'preview' }, preview));
  };
  const paintBadges = u => {
    for (const k of ['dm', 'game']) for (const [tid, el] of Object.entries(badges[k])) {
      const n = isOpen(k, tid) ? 0 : (u[k][tid] || 0);
      el.textContent = countLabel(n); el.classList.toggle('hidden', !n);
      el.parentNode.parentNode.classList.toggle('unread', !!n);
    }
  };
  list.append(h('div', { class: 'row', style: 'justify-content:space-between' },
    h('div', { class: 'section' }, 'Direct messages'), h('button', { class: 'btn small', onclick: openNewDm }, '+ New')));
  if (!dms.length) list.append(h('div', { class: 'muted small' }, 'No conversations yet.'));
  for (const t of dms) list.append(threadButton('dm', t.id, t.other.username, t.lastPreview || 'No messages yet'));
  list.append(h('div', { class: 'section' }, 'Game boards'));
  if (!games.length) list.append(h('div', { class: 'muted small' }, "You're not in any games yet."));
  for (const g of games) list.append(threadButton('game', g.id, g.title, g.isGM ? 'You are the GM' : `GM ${g.gm.username}`));
  paintBadges(unread);
  every(10000, () => api('/unread', { quiet: true }).then(paintBadges).catch(() => {}));

  const right = h('div', { class: 'panel' });
  view.append(h('div', { class: 'chat-layout' }, h('div', { class: 'panel' }, list), right));

  if (kind === 'dm' && id) {
    const t = await api('/dms/' + id);
    right.append(h('div', { class: 'row', style: 'margin-bottom:.4rem' },
      h('h3', { style: 'margin:0' }, nameOf(t.other), pronounTag(t.other)), h('span', { class: 'muted small' }, 'Private conversation — either of you can delete messages'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => openProfile(t.other.id) }, 'View profile'),
      h('button', { class: 'btn small danger', onclick: () => openReport(t.other, 'dm', t.id, null) }, `Report ${t.other.username}`)));
    for (const r of t.pendingRequests) right.append(h('div', { class: 'banner row' },
      h('span', { style: 'flex:1' }, `${t.other.username} wants to join `, h('strong', {}, r.gameTitle), '. Let them in when you’re ready.'),
      h('button', { class: 'btn small primary', onclick: act(async () => { await api(`/requests/${r.id}/approve`, { body: {} }); toast(`${t.other.username} joined ${r.gameTitle}`); renderView(); }) }, 'Let them join'),
      h('button', { class: 'btn small danger', onclick: act(async () => { await api(`/requests/${r.id}/decline`, { body: {} }); toast('Request declined'); renderView(); }) }, 'Decline')));
    right.append(chatBox({ kind: 'dm', id: t.id, onUser: (u, anchor, m) => u.id !== state.me.id && openPopover(anchor, [
      { label: 'View profile', onClick: () => openProfile(u.id) },
      { label: `Report ${u.username}`, danger: true, onClick: () => openReport(u, 'dm', t.id, m.deleted ? null : m) }]) }));
  } else if (kind === 'game' && id) {
    const g = await api('/games/' + id);
    if (!g.isMember) throw new Error("You're not a member of that game");
    right.append(h('div', { class: 'row', style: 'margin-bottom:.4rem' }, h('h3', { style: 'margin:0' }, g.title),
      h('span', { class: 'muted small' }, `GM ${g.gm.username} · ${g.members.length} members`), h('div', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => go('#/game/' + g.id) }, 'Game details')));
    right.append(chatBox({ kind: 'game', id: g.id, gmId: g.gm.id, onUser: (u, a, m) => gameUserMenu(g, u, a, m) }));
  } else {
    right.append(h('div', { class: 'empty' }, 'Pick a conversation or game board on the left.'));
  }
}

function openNewDm() {
  const input = h('input', { type: 'text', placeholder: 'Username', autocomplete: 'off' });
  const results = h('div', { class: 'thread-list', style: 'margin-top:.5rem' });
  const err = h('div', { class: 'field-error' });
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const users = await api('/users/search?q=' + encodeURIComponent(input.value)).catch(() => []);
      results.innerHTML = '';
      users.forEach(u => results.append(h('button', { class: 'thread-item', onclick: act(async () => { closeModal(); await startDm(u.id); }) }, u.username)));
    }, 200);
  });
  openModal(h('div', {}, h('h2', {}, 'New message'), h('label', {}, 'Who do you want to message?'), input, results, err,
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'))));
}

// ============================================================ game page
async function viewGame(view, id) {
  const g = await api('/games/' + id);
  const next = nextOccurrence(g);
  const header = h('div', { class: 'panel' },
    h('div', { class: 'row' }, h('h2', { style: 'margin:0;flex:1' }, g.title),
      g.isGM && h('button', { class: 'btn small', onclick: () => openGameEditor(g) }, 'Edit'),
      g.isGM && h('button', { class: 'btn small danger', onclick: act(async () => {
        if (!confirm(`Delete "${g.title}"? This removes it from everyone's calendar and deletes the board.`)) return;
        await api('/games/' + g.id, { method: 'DELETE' }); toast('Game deleted'); go('#/calendar');
      }) }, 'Delete'),
      g.isMember && !g.isGM && h('button', { class: 'btn small danger', onclick: act(async () => {
        if (!confirm(`Leave "${g.title}"?`)) return;
        await api(`/games/${g.id}/leave`, { body: {} }); toast('You left the game'); go('#/calendar');
      }) }, 'Leave game')),
    h('div', { class: 'row', style: 'margin:.6rem 0' },
      h('span', { class: 'pill accent' }, recurrenceLabel(g)), h('span', { class: 'pill' }, durLabel(g.durationMin)),
      h('span', { class: 'pill' }, VIS[g.visibility]),
      g.closed && h('span', { class: 'pill', style: 'color:var(--danger);border-color:var(--danger)' }, 'Closed to new players'),
      h('button', { class: 'pill', style: 'cursor:pointer', title: 'View GM profile', onclick: () => openProfile(g.gm.id) }, `GM ${g.gm.username}`)),
    h('p', { class: 'small', style: 'margin:.2rem 0 .6rem' }, next ? `Next session: ${fmtDateLong(next)} at ${fmtTime(next)}${gmTimeNote(g, next)}` : 'No upcoming sessions.'),
    h('div', { class: 'desc-full' }, g.description || h('span', { class: 'muted' }, 'No description.')));

  if (!g.isMember) {
    view.append(header, h('div', { class: 'panel', style: 'margin-top:1rem' },
      g.wasKicked ? h('p', { class: 'muted' }, 'The GM removed you from this game.')
        : g.closed && g.requestStatus !== 'pending' ? h('p', { class: 'muted' }, "This game isn't taking new players right now.")
        : h('button', { class: 'btn primary', onclick: () => openJoinRequest(g, next) }, g.requestStatus === 'pending' ? 'Request sent — open chat' : 'Ask to join')));
    return;
  }

  const board = h('div', { class: 'panel', style: 'margin-top:1rem' }, h('h3', {}, 'Game board'),
    chatBox({ kind: 'game', id: g.id, gmId: g.gm.id, onUser: (u, a, m) => gameUserMenu(g, u, a, m) }));

  const side = h('div', { style: 'display:flex;flex-direction:column;gap:1rem' });
  const members = h('ul', { class: 'members' }, g.members.map(m => {
    const name = h('button', { class: 'link', style: 'font-weight:500;color:var(--text)' }, nameOf(m));
    name.addEventListener('click', e => { e.stopPropagation(); if (m.id === state.me.id) openProfile(m.id); else gameUserMenu(g, m, name, null); });
    return h('li', {}, name, pronounTag(m), m.id === state.me.id && h('span', { class: 'muted' }, ' (you)'),
      m.id === g.gm.id && h('span', { class: 'pill ok' }, 'GM'));
  }));
  side.append(h('div', { class: 'panel' }, h('h3', {}, `At the table (${g.members.length})`), members,
    h('p', { class: 'muted small', style: 'margin-bottom:0' }, 'Click a name to see their profile, message or report them.')));

  if (g.isGM) {
    const setClosed = closed => act(async () => {
      await api(`/games/${g.id}/closed`, { body: { closed } });
      toast(closed ? 'Closed to new players' : 'Open to new players'); renderView();
    });
    // Private games only take people the GM invites, so there's nothing to close.
    if (g.visibility !== 'private' || g.closed) side.append(h('div', { class: 'panel' }, h('h3', {}, g.closed ? 'Closed to new players' : 'Open to new players'),
      h('p', { class: 'muted small', style: 'margin-top:0' }, g.closed
        ? `Nobody new can ask to join or use the invite link${g.visibility === 'public' ? ', and the game is hidden from Find games' : ''}. You can still let in pending requests and invite people by username.`
        : `New players can ${g.visibility === 'public' ? 'find this game, ask to join, or use your invite link' : 'join with your invite link'}.`),
      g.closed ? h('button', { class: 'btn small primary', onclick: setClosed(false) }, g.visibility === 'public' ? 'Reopen and list again' : 'Reopen to new players')
        : h('button', { class: 'btn small', onclick: setClosed(true) }, g.visibility === 'public' ? 'Close and unlist' : 'Close to new players')));

    const inviteBox = h('div', { class: 'panel' }, h('h3', {}, 'Invite players'));
    if (g.inviteToken) {
      const url = `${location.origin}/join/${g.inviteToken}`;
      const inp = h('input', { type: 'text', value: url, readonly: true, onfocus: e => e.target.select() });
      inviteBox.append(h('p', { class: 'muted small', style: 'margin-top:0' }, 'Anyone who opens this link joins the game, gets it on their calendar and can use the board.'),
        h('div', { class: 'copy-box' }, inp, h('button', { class: 'btn small primary', onclick: act(async () => { await navigator.clipboard.writeText(url); toast('Invite link copied'); }) }, 'Copy')),
        h('button', { class: 'btn small', style: 'margin-top:.5rem', onclick: act(async () => {
          if (!confirm('Reset the link? The old link will stop working.')) return;
          await api(`/games/${g.id}/regenerate-link`, { body: {} }); toast('New invite link created'); renderView();
        }) }, 'Reset link'));
    } else {
      inviteBox.append(h('p', { class: 'muted small', style: 'margin-top:0' }, 'Private game: invite players by username. They get a notification to accept.'));
    }
    const uname = h('input', { type: 'text', placeholder: 'Username' });
    inviteBox.append(h('label', {}, 'Invite by username'), h('div', { class: 'copy-box' }, uname,
      h('button', { class: 'btn small', onclick: act(async () => { await api(`/games/${g.id}/invite`, { body: { username: uname.value } }); toast(`Invite sent to ${uname.value}`); uname.value = ''; renderView(); }) }, 'Invite')));
    if (g.invites.length) inviteBox.append(h('p', { class: 'muted small' }, 'Pending invites: ' + g.invites.map(i => i.username).join(', ')));
    side.append(inviteBox);

    if (g.visibility === 'public' || g.requests.length) {
      const reqBox = h('div', { class: 'panel' }, h('h3', {}, `Join requests (${g.requests.length})`));
      if (!g.requests.length) reqBox.append(h('p', { class: 'muted small', style: 'margin:0' }, 'No pending requests.'));
      for (const r of g.requests) reqBox.append(h('div', { style: 'padding:.4rem 0;border-bottom:1px solid var(--line)' },
        h('strong', {}, nameOf(r)), pronounTag(r), h('span', { class: 'muted small' }, ' · ' + fmtStamp(r.createdAt)),
        h('div', { class: 'row', style: 'margin-top:.35rem' },
          h('button', { class: 'btn small', onclick: () => openProfile(r.userId) }, 'Profile'),
          h('button', { class: 'btn small', onclick: act(() => startDm(r.userId)) }, 'Chat'),
          h('button', { class: 'btn small primary', onclick: act(async () => { await api(`/requests/${r.id}/approve`, { body: {} }); toast(`${r.username} joined`); renderView(); }) }, 'Let in'),
          h('button', { class: 'btn small danger', onclick: act(async () => { await api(`/requests/${r.id}/decline`, { body: {} }); renderView(); }) }, 'Decline'))));
      side.append(reqBox);
    }
  }
  view.append(h('div', { class: 'game-layout' }, h('div', {}, header, board), side));
}

// ============================================================ admin view (moderation team)
async function viewAdmin(view) {
  const reports = await api('/admin/reports');
  view.append(h('h2', {}, 'Reports'));
  if (!reports.length) return view.append(h('div', { class: 'empty' }, 'No reports. All quiet at the tavern.'));
  const body = h('tbody');
  for (const r of reports) {
    const setStatus = s => act(async () => { await api('/admin/reports/' + r.id, { body: { status: s } }); renderView(); });
    body.append(h('tr', {},
      h('td', {}, fmtStamp(r.createdAt), h('div', {}, h('span', { class: 'pill' + (r.status === 'open' ? ' accent' : '') }, r.status))),
      h('td', {}, h('div', {}, h('span', { class: 'muted' }, 'By '), r.reporter.username), h('div', {}, h('span', { class: 'muted' }, 'Against '), h('strong', {}, r.reported.username), r.reported.banned && h('span', { class: 'pill', style: 'margin-left:.3rem' }, 'banned')),
        h('div', { class: 'muted small' }, r.where)),
      h('td', {}, h('div', {}, r.reason),
        r.message && h('div', { class: 'banner small', style: 'margin-top:.4rem' }, h('strong', {}, r.message.deleted ? 'Reported message (since deleted): ' : 'Reported message: '), r.message.body),
        h('details', {}, h('summary', { class: 'small muted' }, 'Recent conversation'),
          h('div', { class: 'transcript' }, r.recent.map(m => h('div', {}, h('strong', {}, m.username + ': '), m.deleted ? h('em', { class: 'muted' }, `[deleted] ${m.body}`) : m.body))))),
      h('td', {}, h('div', { class: 'row' },
        r.status !== 'resolved' && h('button', { class: 'btn small', onclick: setStatus('resolved') }, 'Resolve'),
        r.status !== 'dismissed' && h('button', { class: 'btn small', onclick: setStatus('dismissed') }, 'Dismiss'),
        r.status !== 'open' && h('button', { class: 'btn small', onclick: setStatus('open') }, 'Reopen'),
        h('button', { class: 'btn small danger', onclick: act(async () => {
          const ban = !r.reported.banned;
          if (!confirm(`${ban ? 'Ban' : 'Unban'} ${r.reported.username}?`)) return;
          await api(`/admin/users/${r.reported.id}/ban`, { body: { banned: ban } }); renderView();
        }) }, r.reported.banned ? 'Unban' : 'Ban user')))));
  }
  view.append(h('div', { class: 'panel', style: 'overflow-x:auto' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'Details'), h('th', {}, 'Actions'))), body)));
}

boot();
