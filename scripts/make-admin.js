// Usage: npm run make-admin -- <username>
// Grants (or with --remove, revokes) admin/moderation rights for an existing account.
const db = require('../db');
const args = process.argv.slice(2);
const remove = args.includes('--remove');
const username = args.find(a => !a.startsWith('--'));
if (!username) { console.error('Usage: npm run make-admin -- <username> [--remove]'); process.exit(1); }
const r = db.prepare('UPDATE users SET is_admin = ? WHERE username = ?').run(remove ? 0 : 1, username);
if (!r.changes) { console.error(`No user named "${username}". Register the account first.`); process.exit(1); }
console.log(`${username} is ${remove ? 'no longer' : 'now'} an admin.`);
