/* GET /api/session — who, if anyone, is signed in. Safe to call unauthenticated. */

'use strict';

const { readSession, REPO_OWNER, REPO, BRANCH } = require('./_lib');

module.exports = async (req, res) => {
  const session = readSession(req);
  res.status(200).json({
    signedIn: Boolean(session),
    login: session ? session.login : null,
    repo: `${REPO_OWNER}/${REPO}`,
    branch: BRANCH,
  });
};
