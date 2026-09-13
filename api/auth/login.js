/* GET /api/auth/login
   Starts the GitHub OAuth flow.

   A random state value is stored in a short-lived cookie and echoed back by
   GitHub, so a callback that did not originate here is rejected. Scope is
   public_repo, the narrowest scope that can commit to a public repository.

   If the editor is not configured, this sends the visitor back to the sign-in
   page with the list of missing variables instead of a raw JSON error. */

'use strict';

const crypto = require('crypto');
const { missingEnv, setCookie, STATE_COOKIE } = require('../_lib');

const redirect = (res, location) => {
  res.writeHead(302, { Location: location });
  res.end();
};

module.exports = async (req, res) => {
  const missing = missingEnv();
  if (missing.length) {
    const message = `The editor is not set up yet. Vercel is missing: ${missing.join(', ')}. `
      + 'Add them under Settings, Environment Variables, then redeploy.';
    return redirect(res, `/admin/?error=${encodeURIComponent(message)}`);
  }

  const state = crypto.randomBytes(24).toString('base64url');
  setCookie(res, STATE_COOKIE, state, { maxAge: 600 });

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const redirectUri = `${proto}://${req.headers.host}/api/auth/callback`;

  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'public_repo');
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');

  return redirect(res, url.toString());
};
