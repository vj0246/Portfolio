/* /api/cards
   GET     list every card file, parsed
   POST    create or update one card
   DELETE  remove one card

   Writes go straight to content/projects/ on the default branch using the
   signed-in user's own OAuth token. index.html is NOT written here: a GitHub
   Action rebuilds it from the JSON, so content/projects stays the single source
   of truth and the admin can never put the page out of sync with its data.

   Every payload is validated against the same rules as scripts/build.py before
   anything is committed. An invalid card would break the build and leave the
   site stale, so it is refused here rather than discovered later. */

'use strict';

const {
  requireSession, listDir, getFile, putFile, deleteFile,
  validateCard, cardFilename, readJsonBody,
} = require('./_lib');

const DIR = 'content/projects';

async function handleGet(res, token) {
  const entries = await listDir(DIR, token);
  const files = entries.filter((e) => e.type === 'file' && e.name.endsWith('.json') && !e.name.startsWith('_'));

  const cards = await Promise.all(files.map(async (entry) => {
    const file = await getFile(`${DIR}/${entry.name}`, token);
    try {
      return { file: entry.name, sha: file.sha, card: JSON.parse(file.content) };
    } catch (e) {
      return { file: entry.name, sha: file.sha, card: null, error: `invalid JSON: ${e.message}` };
    }
  }));

  cards.sort((a, b) => {
    const A = a.card || {}; const B = b.card || {};
    return String(A.section).localeCompare(String(B.section)) || (A.order || 0) - (B.order || 0);
  });

  res.status(200).json({ cards });
}

async function handlePost(req, res, token) {
  const body = await readJsonBody(req);
  const card = body.card;

  const errors = validateCard(card);
  if (errors.length) {
    res.status(400).json({ error: 'card failed validation', errors });
    return;
  }

  const target = cardFilename(card);
  const previousFile = typeof body.previousFile === 'string' ? body.previousFile : null;
  const content = Buffer.from(`${JSON.stringify(card, null, 2)}\n`, 'utf8').toString('base64');

  // Renaming section or order changes the filename, so the old file must go.
  const renamedFrom = previousFile && previousFile !== target.split('/').pop() ? previousFile : null;

  let sha = body.sha || null;
  if (renamedFrom) sha = null; // writing a new path, no sha to match
  if (!sha) {
    try {
      const existing = await getFile(target, token);
      sha = existing.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }

  await putFile(target, token, {
    contentBase64: content,
    message: `content(projects): ${sha ? 'update' : 'add'} ${card.id} card\n\nvia the admin`,
    sha,
  });

  if (renamedFrom) {
    const old = await getFile(`${DIR}/${renamedFrom}`, token).catch(() => null);
    if (old) {
      await deleteFile(`${DIR}/${renamedFrom}`, token, {
        message: `content(projects): remove ${renamedFrom}, renamed to ${target.split('/').pop()}`,
        sha: old.sha,
      });
    }
  }

  res.status(200).json({ ok: true, file: target, renamedFrom });
}

async function handleDelete(req, res, token) {
  const body = await readJsonBody(req);
  const name = String(body.file || '');
  if (!/^[a-z0-9][a-z0-9._-]*\.json$/i.test(name) || name.startsWith('_')) {
    res.status(400).json({ error: 'bad filename' });
    return;
  }

  const file = await getFile(`${DIR}/${name}`, token);
  await deleteFile(`${DIR}/${name}`, token, {
    message: `content(projects): remove ${name}\n\nvia the admin`,
    sha: file.sha,
  });

  res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') return await handleGet(res, session.token);
    if (req.method === 'POST') return await handlePost(req, res, session.token);
    if (req.method === 'DELETE') return await handleDelete(req, res, session.token);
    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message });
  }
};
