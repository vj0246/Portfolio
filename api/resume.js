/* POST /api/resume
   Replace one of the three resume PDFs.

   Body: { "slot": "quant" | "aiml" | "swe", "contentBase64": "..." }

   The slot is an allow-list rather than a path, so a caller cannot aim this at
   an arbitrary file in the repository. The payload must actually be a PDF: the
   first bytes are checked for %PDF- before anything is committed. */

'use strict';

const { requireSession, getFile, putFile, readJsonBody } = require('./_lib');

const SLOTS = {
  quant: 'resumes/resume-quant.pdf',
  aiml: 'resumes/resume-aiml.pdf',
  swe: 'resumes/resume-swe.pdf',
};

const MAX_BYTES = 6 * 1024 * 1024;

module.exports = async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const target = SLOTS[body.slot];
    if (!target) {
      res.status(400).json({ error: `slot must be one of ${Object.keys(SLOTS).join(', ')}` });
      return;
    }

    const base64 = String(body.contentBase64 || '');
    let bytes;
    try {
      bytes = Buffer.from(base64, 'base64');
    } catch {
      res.status(400).json({ error: 'contentBase64 is not valid base64' });
      return;
    }

    if (!bytes.length) { res.status(400).json({ error: 'file is empty' }); return; }
    if (bytes.length > MAX_BYTES) {
      res.status(413).json({ error: `file is ${(bytes.length / 1e6).toFixed(1)}MB, limit is 6MB` });
      return;
    }
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      res.status(400).json({ error: 'that file is not a PDF' });
      return;
    }

    const existing = await getFile(target, session.token).catch((e) => {
      if (e.status === 404) return null;
      throw e;
    });

    await putFile(target, session.token, {
      contentBase64: bytes.toString('base64'),
      message: `chore(resume): update ${body.slot} resume\n\nvia the admin`,
      sha: existing ? existing.sha : null,
    });

    res.status(200).json({ ok: true, file: target, bytes: bytes.length });
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message });
  }
};
