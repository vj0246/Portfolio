/* GET /api/session
   Who, if anyone, is signed in, and whether the editor is configured at all.
   Safe to call unauthenticated: it reports the NAMES of missing variables,
   never a value, so the sign-in page can tell the owner what setup is left. */

'use strict';

const { readSession, missingEnv, REPO_OWNER, REPO, BRANCH } = require('./_lib');

module.exports = async (req, res) => {
  const missing = missingEnv();
  const session = missing.length ? null : readSession(req);
  res.status(200).json({
    signedIn: Boolean(session),
    login: session ? session.login : null,
    configured: missing.length === 0,
    missing,
    repo: `${REPO_OWNER}/${REPO}`,
    branch: BRANCH,
  });
};
