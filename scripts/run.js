// Runs the PocketBase binary with this project's folders.
//   node scripts/run.js serve                 (npm start)
//   node scripts/run.js make-admin <username>  (npm run make-admin -- <username>)
// Environment: PORT (default 3000), PB_DATA (default ./pb_data), BASE_URL (default http://localhost:PORT),
// plus the settings read by pb_hooks/auth.pb.js (SMTP_URL, MAIL_FROM, GOOGLE_CLIENT_ID/SECRET, ADMIN_USERNAMES).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'pocketbase', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
if (!fs.existsSync(exe)) { console.error('PocketBase is not installed yet. Run: npm run setup'); process.exit(1); }

const port = process.env.PORT || 3000;
const args = process.argv.slice(2);
if (args[0] === 'serve' && !args.some(a => a.startsWith('--http'))) args.push(`--http=127.0.0.1:${port}`);
args.push(
  `--dir=${process.env.PB_DATA || path.join(root, 'pb_data')}`,
  `--hooksDir=${path.join(root, 'pb_hooks')}`,
  `--migrationsDir=${path.join(root, 'pb_migrations')}`,
  `--publicDir=${path.join(root, 'pb_public')}`,
);
const env = { ...process.env, BASE_URL: process.env.BASE_URL || `http://localhost:${port}` };
const child = spawn(exe, args, { stdio: 'inherit', env });
child.on('exit', code => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
