/* GET /api/session — who, if anyone, is signed in. Safe to call unauthenticated. */

'use strict';

const { readSession, ALLOWED_LOGIN, REPO, BRANCH } = require('./_lib');

module.exports = async (req, res) => {
  const session = readSession(req);
  res.status(200).json({
    signedIn: Boolean(session),
    login: session ? session.login : null,
    repo: `${ALLOWED_LOGIN}/${REPO}`,
    branch: BRANCH,
  });
};
