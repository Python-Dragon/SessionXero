// Verifies "Sign in with Google" ID tokens (JWTs) locally against Google's published keys.
// Needs GOOGLE_CLIENT_ID (an OAuth 2.0 Web client ID from Google Cloud Console).
const crypto = require('crypto');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let keys = null, keysExpire = 0;

async function googleKeys() {
  if (keys && Date.now() < keysExpire) return keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('Could not reach Google to check the sign-in');
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1]) || 3600;
  keys = Object.fromEntries((await res.json()).keys.map(k => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })]));
  keysExpire = Date.now() + maxAge * 1000;
  return keys;
}

const b64json = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

// Returns { sub, email } for a valid token, or throws.
async function verifyGoogleToken(token) {
  if (!CLIENT_ID) throw new Error('Google sign-in is not set up on this server');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid Google sign-in');
  const header = b64json(parts[0]), payload = b64json(parts[1]);
  if (header.alg !== 'RS256') throw new Error('Invalid Google sign-in');
  let key = (await googleKeys())[header.kid];
  if (!key) { keysExpire = 0; key = (await googleKeys())[header.kid]; } // Google rotated its keys
  const ok = key && crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'));
  const now = Date.now() / 1000;
  if (!ok || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
      payload.aud !== CLIENT_ID || !(payload.exp > now) || !payload.sub) throw new Error('Invalid or expired Google sign-in');
  return { sub: String(payload.sub), email: payload.email_verified ? String(payload.email || '') : '' };
}

module.exports = { verifyGoogleToken, GOOGLE_CLIENT_ID: CLIENT_ID };
