/* _lib.js
   Shared helpers for the admin API: session cookies, auth guard, GitHub calls,
   validation, and the collection route behind /api/cards and /api/experience.

   Files prefixed with _ are not routed by Vercel, so this is not reachable.

   Security model
   --------------
   Sign-in is GitHub OAuth. Only accounts listed in GITHUB_ALLOWED_LOGINS are
   accepted, and that defaults to the repository owner alone. Anyone else who
   completes the OAuth dance is refused after the token exchange.

   Writes use the signed-in user's own OAuth token rather than a long-lived PAT
   stored on the server. An allowed account therefore also needs write access to
   the repository: the owner has it, anyone else must be added as a
   collaborator. Revoking the OAuth app from GitHub settings kills access
   immediately.

   The session cookie carries that token encrypted with AES-256-GCM under
   SESSION_SECRET. It is httpOnly and Secure, so script cannot read it, and the
   encryption means a leaked cookie is not a usable credential without the
   server key.
*/

'use strict';

const crypto = require('crypto');

const REPO_OWNER = process.env.GITHUB_OWNER || 'vj0246';
const REPO = process.env.GITHUB_REPO || 'Portfolio';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

const ALLOWED_LOGINS = (process.env.GITHUB_ALLOWED_LOGINS || REPO_OWNER)
  .split(',')
  .map((login) => login.trim().toLowerCase())
  .filter(Boolean);

const isAllowed = (login) => ALLOWED_LOGINS.includes(String(login || '').toLowerCase());

const SESSION_COOKIE = 'pf_session';
const STATE_COOKIE = 'pf_oauth_state';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// Vercel rejects function request bodies above 4.5MB before our code runs.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/* ── secrets ── */

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function sessionKey() {
  // A 32-byte key derived from the configured secret, whatever its length.
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
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(bodyB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plain);
    if (!payload.exp || Date.now() > payload.exp) return null;
    // Re-checked on every request, so removing someone from the allow-list
    // locks them out without waiting for their session to expire.
    if (!isAllowed(payload.login)) return null;
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
    const error = new Error((body && body.message) || `GitHub returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

const contentsPath = (filePath) =>
  `/repos/${REPO_OWNER}/${REPO}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`;

async function listDir(dir, token) {
  return gh(`${contentsPath(dir)}?ref=${encodeURIComponent(BRANCH)}`, token);
}

/** Directory listing, or an empty list if the directory does not exist yet. */
async function listEntries(dir, token) {
  try {
    return await listDir(dir, token);
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

async function getFile(filePath, token) {
  const data = await gh(`${contentsPath(filePath)}?ref=${encodeURIComponent(BRANCH)}`, token);
  return { sha: data.sha, content: Buffer.from(data.content || '', 'base64').toString('utf8') };
}

async function putFile(filePath, token, { contentBase64, message, sha }) {
  return gh(contentsPath(filePath), token, {
    method: 'PUT',
    body: JSON.stringify({ message, content: contentBase64, branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
}

async function deleteFile(filePath, token, { message, sha }) {
  return gh(contentsPath(filePath), token, {
    method: 'DELETE',
    body: JSON.stringify({ message, branch: BRANCH, sha }),
  });
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/* ── validation ──
   Mirrors scripts/build.py. A file that fails here would fail the build, and a
   failing build leaves the live site on its previous version, so it is refused
   before it reaches the repository. validate.py checks these lists against
   build.py so the two cannot drift. */

const SECTIONS = ['projects', 'frontier', 'engineering'];
const BADGE_KINDS = ['live', 'progress', 'research', 'published', 'freelance', 'intern'];
const BLOCK_TYPES = ['text', 'bullets', 'arch', 'table', 'nulls', 'html'];
const SIDEBAR_TYPES = ['tags', 'metrics', 'links'];
const EXPERIENCE_KINDS = ['intern', 'freelance', 'fulltime', 'research'];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isTextList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const nonEmpty = (v) => Array.isArray(v) && v.length > 0;

function checkCommon(item, errors) {
  if (!Number.isInteger(item.order) || item.order < 0) errors.push('Order must be a whole number, 0 or more.');
  if (!isText(item.id) || !ID_RE.test(item.id)) {
    errors.push('The link id must be lowercase letters, digits and hyphens. It is set from the name automatically.');
  }
}

function validateCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return ['The project data is not an object.'];
  const errors = [];
  checkCommon(card, errors);

  if (!SECTIONS.includes(card.section)) errors.push('Choose where the project appears.');
  if (!isText(card.name)) errors.push('Project name is required.');
  if (!isText(card.tagline)) errors.push('Short description is required.');
  if (card.lede !== undefined && typeof card.lede !== 'string') errors.push('One-line summary must be text.');
  if (!isTextList(card.tags)) errors.push('Technologies must be a list of words.');

  if (card.badge !== undefined) {
    if (!card.badge || !BADGE_KINDS.includes(card.badge.kind)) errors.push('Choose a valid status badge, or none.');
    else if (!isText(card.badge.text)) errors.push('Badge text is required when a badge is chosen.');
  }

  if (!nonEmpty(card.blocks)) {
    errors.push('The write-up needs at least one section.');
  } else {
    card.blocks.forEach((block, i) => {
      const at = `Write-up section ${i + 1}`;
      if (!block || typeof block !== 'object' || !BLOCK_TYPES.includes(block.type)) {
        errors.push(`${at} has an unknown type.`);
        return;
      }
      if (!isText(block.h)) errors.push(`${at} needs a heading.`);
      if (block.type === 'text' && !(nonEmpty(block.paras) && isTextList(block.paras))) errors.push(`${at} needs at least one paragraph.`);
      if (block.type === 'bullets' && !(nonEmpty(block.items) && isTextList(block.items))) errors.push(`${at} needs at least one point.`);
      if (block.type === 'arch' && !Array.isArray(block.flow) && !Array.isArray(block.flows)) errors.push(`${at} needs a flow.`);
      if (block.type === 'table') {
        if (!nonEmpty(block.cols)) errors.push(`${at} needs at least one column.`);
        if (!nonEmpty(block.rows)) errors.push(`${at} needs at least one row.`);
      }
      if (block.type === 'nulls') {
        if (!isText(block.label)) errors.push(`${at} needs a label.`);
        if (!nonEmpty(block.items) && !nonEmpty(block.after)) errors.push(`${at} needs at least one point or paragraph.`);
      }
      if (block.type === 'html' && !isText(block.raw)) errors.push(`${at} is empty.`);
    });
  }

  if (!Array.isArray(card.sidebar)) {
    errors.push('The side panel is malformed.');
  } else {
    card.sidebar.forEach((box, i) => {
      const at = `Side panel box ${i + 1}`;
      if (!box || !SIDEBAR_TYPES.includes(box.type)) { errors.push(`${at} has an unknown type.`); return; }
      if (!isText(box.label)) errors.push(`${at} needs a title.`);
      if (!Array.isArray(box.items)) errors.push(`${at} is malformed.`);
    });
  }

  return errors;
}

function validateExperience(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['The experience data is not an object.'];
  const errors = [];
  checkCommon(entry, errors);

  if (!EXPERIENCE_KINDS.includes(entry.kind)) errors.push('Choose the type of role.');
  if (!isText(entry.badge)) errors.push('Label shown is required.');
  if (!isText(entry.role)) errors.push('Role or title is required.');
  if (!isText(entry.company)) errors.push('Organisation is required.');
  if (!isText(entry.period)) errors.push('Dates are required.');
  for (const key of ['period_note', 'summary']) {
    if (entry[key] !== undefined && typeof entry[key] !== 'string') errors.push(`${key} must be text.`);
  }
  if (!isTextList(entry.bullets)) errors.push('Key points must be a list of text.');
  if (entry.link !== undefined) {
    if (!entry.link || !isText(entry.link.text) || !/^https?:\/\/\S+$/.test(entry.link.url || '')) {
      errors.push('A website needs both a label and an address starting with https://');
    }
  }
  return errors;
}

/* Filenames build.py expects: <prefix>-<order>-<id>.json */

const pad = (order) => String(order).padStart(3, '0');

function cardFilename(card) {
  const prefix = { projects: 'proj', frontier: 'fron', engineering: 'engi' }[card.section];
  return `content/projects/${prefix}-${pad(card.order)}-${card.id}.json`;
}

function experienceFilename(entry) {
  return `content/experience/exp-${pad(entry.order)}-${entry.id}.json`;
}

/* ── collection route ──
   GET lists every JSON file in a directory, POST creates or updates one,
   DELETE removes one. index.html is never written here: the "Rebuild cards"
   Action renders it from the JSON, so the content directory stays the single
   source of truth. */

const FILE_RE = /^[a-z0-9][a-z0-9._-]*\.json$/i;
const idOf = (name) => (name.match(/^[a-z]+-\d+-(.+)\.json$/) || [])[1];

function collectionRoute({ dir, noun, validate, filename }) {
  async function list(res, token) {
    const entries = await listEntries(dir, token);
    const files = entries.filter((e) => e.type === 'file' && FILE_RE.test(e.name) && !e.name.startsWith('_'));
    const items = await Promise.all(files.map(async (entry) => {
      const file = await getFile(`${dir}/${entry.name}`, token);
      try {
        return { file: entry.name, sha: file.sha, data: JSON.parse(file.content) };
      } catch (e) {
        return { file: entry.name, sha: file.sha, data: null, error: `not valid JSON: ${e.message}` };
      }
    }));
    res.status(200).json({ items });
  }

  async function save(req, res, token) {
    const body = await readJsonBody(req);
    const item = body.item;

    const errors = validate(item);
    if (errors.length) {
      res.status(400).json({ error: 'Some fields need fixing before this can be saved.', errors });
      return;
    }

    const targetName = filename(item).split('/').pop();
    const previous = typeof body.previousFile === 'string' && FILE_RE.test(body.previousFile) ? body.previousFile : null;
    const samePath = previous === targetName;

    const siblings = await listEntries(dir, token);
    const existing = siblings.find((e) => e.name === targetName);
    const clash = siblings.find((e) => e.name !== targetName && e.name !== previous && idOf(e.name) === item.id);

    if (clash) {
      res.status(409).json({ error: `Another entry already uses the id "${item.id}". Change the name slightly.` });
      return;
    }
    if (existing && !samePath) {
      res.status(409).json({ error: 'An entry with this name and order already exists.' });
      return;
    }

    // Sending the sha this editor loaded makes GitHub refuse the write if the
    // file changed in the meantime, rather than silently overwriting it.
    const loadedSha = typeof body.sha === 'string' && body.sha ? body.sha : null;
    const sha = samePath && existing ? (loadedSha || existing.sha) : null;

    await putFile(`${dir}/${targetName}`, token, {
      contentBase64: Buffer.from(`${JSON.stringify(item, null, 2)}\n`, 'utf8').toString('base64'),
      message: `content(${noun}): ${existing ? 'update' : 'add'} ${item.id}\n\nvia the admin`,
      sha,
    });

    // Changing the order or section changes the filename, so the old file goes.
    const renamedFrom = previous && !samePath ? previous : null;
    if (renamedFrom) {
      const old = siblings.find((e) => e.name === renamedFrom);
      if (old) {
        await deleteFile(`${dir}/${renamedFrom}`, token, {
          message: `content(${noun}): remove ${renamedFrom}, now ${targetName}`,
          sha: old.sha,
        });
      }
    }

    res.status(200).json({ ok: true, file: targetName, renamedFrom });
  }

  async function remove(req, res, token) {
    const body = await readJsonBody(req);
    const name = String(body.file || '');
    if (!FILE_RE.test(name) || name.startsWith('_')) {
      res.status(400).json({ error: 'bad file name' });
      return;
    }
    const entry = (await listEntries(dir, token)).find((e) => e.name === name);
    if (!entry) {
      res.status(404).json({ error: 'That entry no longer exists. Reload the page.' });
      return;
    }
    await deleteFile(`${dir}/${name}`, token, { message: `content(${noun}): remove ${name}\n\nvia the admin`, sha: entry.sha });
    res.status(200).json({ ok: true });
  }

  return async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;

    try {
      if (req.method === 'GET') return await list(res, session.token);
      if (req.method === 'POST') return await save(req, res, session.token);
      if (req.method === 'DELETE') return await remove(req, res, session.token);
      res.setHeader('Allow', 'GET, POST, DELETE');
      res.status(405).json({ error: 'method not allowed' });
    } catch (e) {
      res.status(...describeGitHubError(e, req.method));
    }
  };
}

/** Turn a GitHub failure into something a non-engineer can act on. */
function describeGitHubError(e, method) {
  if (e.status === 409) {
    return [409, { error: 'This entry was changed somewhere else since you opened it. Reload the page and make your edit again.' }];
  }
  if (method !== 'GET' && (e.status === 403 || e.status === 404)) {
    return [403, { error: 'Your GitHub account cannot write to the site repository. Ask the owner to add you as a collaborator.' }];
  }
  if (e.status === 413) return [413, { error: e.message }];
  return [e.status && e.status < 500 ? e.status : 502, { error: e.message }];
}

module.exports = {
  REPO_OWNER, REPO, BRANCH, SESSION_COOKIE, STATE_COOKIE,
  isAllowed, requireEnv, parseCookies, setCookie, clearCookie,
  startSession, readSession, requireSession,
  gh, getFile, putFile, readJsonBody, describeGitHubError,
  validateCard, validateExperience, cardFilename, experienceFilename,
  collectionRoute,
};
