/* GET /api/auth/login
   Starts the GitHub OAuth flow.

   A random state value is stored in a short-lived cookie and echoed back by
   GitHub, so a callback that did not originate here is rejected. Scope is
   public_repo, the narrowest scope that can commit to a public repository. */

'use strict';

const crypto = require('crypto');
const { requireEnv, setCookie, STATE_COOKIE } = require('../_lib');

module.exports = async (req, res) => {
  try {
    const clientId = requireEnv('GITHUB_CLIENT_ID');
    const state = crypto.randomBytes(24).toString('base64url');

    setCookie(res, STATE_COOKIE, state, { maxAge: 600 });

    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const redirectUri = `${proto}://${req.headers.host}/api/auth/callback`;

    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'public_repo');
    url.searchParams.set('state', state);
    url.searchParams.set('allow_signup', 'false');

    res.writeHead(302, { Location: url.toString() });
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
