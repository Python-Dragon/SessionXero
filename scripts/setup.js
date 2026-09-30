// Downloads the PocketBase binary for this OS/CPU into ./pocketbase/ (not committed to git).
// Usage: npm run setup
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = '0.40.4';
const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
if (!os || !arch) { console.error(`Unsupported platform ${process.platform}/${process.arch}`); process.exit(1); }

const dir = path.join(__dirname, '..', 'pocketbase');
const exe = path.join(dir, process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
const url = `https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}/pocketbase_${VERSION}_${os}_${arch}.zip`;

(async () => {
  if (fs.existsSync(exe) && execFileSync(exe, ['--version']).toString().includes(VERSION)) {
    console.log(`PocketBase ${VERSION} is already installed.`); return;
  }
  fs.mkdirSync(dir, { recursive: true });
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const zip = path.join(dir, 'pocketbase.zip');
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  // Windows 10+ ships bsdtar, which reads zip files; macOS/Linux have unzip.
  if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', dir], { stdio: 'inherit' });
  else execFileSync('unzip', ['-o', zip, '-d', dir], { stdio: 'inherit' });
  fs.unlinkSync(zip);
  if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
  console.log(execFileSync(exe, ['--version']).toString().trim(), 'installed in', dir);
})().catch(e => { console.error(e.message); process.exit(1); });
