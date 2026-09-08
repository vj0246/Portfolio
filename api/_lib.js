/* _lib.js
   Shared helpers for the admin API: session cookies, auth guard, GitHub calls,
   and server-side validation of a card file.

   Files prefixed with _ are not routed by Vercel, so this is not reachable.

   Security model
   --------------
   Sign-in is GitHub OAuth. The only account accepted is ALLOWED_LOGIN; every
   other GitHub user is rejected after the token exchange, so a stranger who
   completes the OAuth dance still gets nothing.

   Writes use the signed-in user's own OAuth token rather than a long-lived PAT
   stored on the server. Nothing here can write to the repository unless a real
   person signed in, and revoking the OAuth app from GitHub settings kills all
   access immediately.

   The session cookie carries that token encrypted with AES-256-GCM under
   SESSION_SECRET. It is httpOnly and Secure, so script cannot read it, and the
   encryption means a leaked cookie is not a usable credential without the
   server key.
*/

'use strict';

const crypto = require('crypto');

const ALLOWED_LOGIN = process.env.GITHUB_OWNER || 'vj0246';
const REPO = process.env.GITHUB_REPO || 'Portfolio';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

const SESSION_COOKIE = 'pf_session';
const STATE_COOKIE = 'pf_oauth_state';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/* ── secrets ── */

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function sessionKey() {
  // A 32-byte key derived from the configured secret, whatever length it is.
  return crypto.createHash('sha256').update(requireEnv('SESSION_SECRET')).digest();
}

/* ── cookies ── */

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, { maxAge, sameSite = 'Lax' } = {}) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    `SameSite=${sameSite}`,
  ];
  if (maxAge !== undefined) bits.push(`Max-Age=${maxAge}`);
  const existing = res.getHeader('Set-Cookie');
  const list = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  list.push(bits.join('; '));
  res.setHeader('Set-Cookie', list);
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

/* ── session ── */

function encryptSession(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, body].map((b) => b.toString('base64url')).join('.');
}

function decryptSession(token) {
  try {
    const [ivB64, tagB64, bodyB64] = String(token).split('.');
    if (!ivB64 || !tagB64 || !bodyB64) return null;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      sessionKey(),
      Buffer.from(ivB64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(bodyB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plain);
    if (!payload.exp || Date.now() > payload.exp) return null;
    if (payload.login !== ALLOWED_LOGIN) return null;
    return payload;
  } catch {
    return null; // tampered, wrong key, or malformed. All the same answer.
  }
}

function startSession(res, { login, token }) {
  setCookie(res, SESSION_COOKIE, encryptSession({ login, token, exp: Date.now() + SESSION_TTL_MS }), {
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

function readSession(req) {
  const raw = parseCookies(req)[SESSION_COOKIE];
  return raw ? decryptSession(raw) : null;
}

/** Guard for every write route. Returns the session, or null after replying 401. */
function requireSession(req, res) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: 'not signed in' });
    return null;
  }
  return session;
}

/* ── GitHub ── */

async function gh(path, token, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'portfolio-admin',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) {
    const message = (body && body.message) || `GitHub returned ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

const contentsPath = (filePath) =>
  `/repos/${ALLOWED_LOGIN}/${REPO}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`;

async function listDir(dir, token) {
  return gh(`${contentsPath(dir)}?ref=${encodeURIComponent(BRANCH)}`, token);
}

async function getFile(filePath, token) {
  const data = await gh(`${contentsPath(filePath)}?ref=${encodeURIComponent(BRANCH)}`, token);
  return {
    sha: data.sha,
    content: Buffer.from(data.content || '', 'base64').toString('utf8'),
  };
}

async function putFile(filePath, token, { contentBase64, message, sha }) {
  return gh(contentsPath(filePath), token, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
}

async function deleteFile(filePath, token, { message, sha }) {
  return gh(contentsPath(filePath), token, {
    method: 'DELETE',
    body: JSON.stringify({ message, branch: BRANCH, sha }),
  });
}

/* ── card validation ──
   Mirrors the rules in scripts/build.py. A file that fails here would fail the
   build, and a failing build would leave the site stale, so it is refused
   before it ever reaches the repository. */

const SECTIONS = ['projects', 'frontier', 'engineering'];
const BADGE_KINDS = ['live', 'progress', 'research', 'published', 'freelance', 'intern'];
const BLOCK_TYPES = ['text', 'bullets', 'arch', 'table', 'nulls', 'html'];
const SIDEBAR_TYPES = ['tags', 'metrics', 'links'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;

function validateCard(card) {
  const errors = [];
  const isString = (v) => typeof v === 'string' && v.trim().length > 0;

  if (!card || typeof card !== 'object' || Array.isArray(card)) return ['card must be a JSON object'];

  if (!SECTIONS.includes(card.section)) errors.push(`section must be one of ${SECTIONS.join(', ')}`);
  if (!Number.isFinite(card.order)) errors.push('order must be a number');
  if (!isString(card.id) || !ID_RE.test(card.id)) errors.push('id must be lowercase letters, digits and hyphens');
  if (!isString(card.name)) errors.push('name is required');
  if (!isString(card.tagline)) errors.push('tagline is required');
  if (card.lede !== undefined && typeof card.lede !== 'string') errors.push('lede must be a string');

  if (card.badge !== undefined) {
    if (!card.badge || typeof card.badge !== 'object') errors.push('badge must be an object, or omitted');
    else {
      if (!BADGE_KINDS.includes(card.badge.kind)) errors.push(`badge.kind must be one of ${BADGE_KINDS.join(', ')}`);
      if (!isString(card.badge.text)) errors.push('badge.text is required when badge is present');
    }
  }

  if (!Array.isArray(card.tags) || card.tags.some((t) => typeof t !== 'string')) {
    errors.push('tags must be an array of strings');
  }

  if (!Array.isArray(card.blocks) || card.blocks.length === 0) {
    errors.push('blocks must be a non-empty array');
  } else {
    card.blocks.forEach((block, i) => {
      const at = `blocks[${i}]`;
      if (!block || typeof block !== 'object') { errors.push(`${at} must be an object`); return; }
      if (!BLOCK_TYPES.includes(block.type)) { errors.push(`${at}.type must be one of ${BLOCK_TYPES.join(', ')}`); return; }
      if (!isString(block.h)) errors.push(`${at}.h is required`);
      if (block.type === 'text' && !Array.isArray(block.paras)) errors.push(`${at}.paras must be an array`);
      if (block.type === 'bullets' && !Array.isArray(block.items)) errors.push(`${at}.items must be an array`);
      if (block.type === 'arch' && !Array.isArray(block.flow) && !Array.isArray(block.flows)) {
        errors.push(`${at} needs flow or flows`);
      }
      if (block.type === 'table') {
        if (!Array.isArray(block.cols)) errors.push(`${at}.cols must be an array`);
        if (!Array.isArray(block.rows)) errors.push(`${at}.rows must be an array`);
      }
      if (block.type === 'nulls') {
        if (!isString(block.label)) errors.push(`${at}.label is required`);
        if (!Array.isArray(block.items) && !Array.isArray(block.after)) {
          errors.push(`${at} needs items or after`);
        }
      }
      if (block.type === 'html' && !isString(block.raw)) errors.push(`${at}.raw is required`);
    });
  }

  if (!Array.isArray(card.sidebar)) {
    errors.push('sidebar must be an array');
  } else {
    card.sidebar.forEach((block, i) => {
      const at = `sidebar[${i}]`;
      if (!block || typeof block !== 'object') { errors.push(`${at} must be an object`); return; }
      if (!SIDEBAR_TYPES.includes(block.type)) errors.push(`${at}.type must be one of ${SIDEBAR_TYPES.join(', ')}`);
      if (!isString(block.label)) errors.push(`${at}.label is required`);
      if (!Array.isArray(block.items)) errors.push(`${at}.items must be an array`);
    });
  }

  return errors;
}

/** The filename build.py expects: <section-prefix>-<order>-<id>.json */
function cardFilename(card) {
  const prefix = { projects: 'proj', frontier: 'fron', engineering: 'engi' }[card.section];
  return `content/projects/${prefix}-${String(card.order).padStart(3, '0')}-${card.id}.json`;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

module.exports = {
  ALLOWED_LOGIN, REPO, BRANCH, SESSION_COOKIE, STATE_COOKIE,
  requireEnv, parseCookies, setCookie, clearCookie,
  startSession, readSession, requireSession,
  gh, listDir, getFile, putFile, deleteFile,
  validateCard, cardFilename, readJsonBody,
};
