/* GET /api/auth/callback
   Finishes the OAuth flow.

   Three things must hold before a session is issued: the state matches the
   cookie set by /api/auth/login, GitHub returns a token, and the account that
   token belongs to is ALLOWED_LOGIN. Anyone else is refused here, after the
   token exchange, which is the point at which we can actually know who they
   are. */

'use strict';

const crypto = require('crypto');
const {
  requireEnv, parseCookies, clearCookie, startSession,
  ALLOWED_LOGIN, STATE_COOKIE, gh,
} = require('../_lib');

const deny = (res, reason) => {
  res.writeHead(302, { Location: `/admin/?error=${encodeURIComponent(reason)}` });
  res.end();
};

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const expected = parseCookies(req)[STATE_COOKIE];

    clearCookie(res, STATE_COOKIE);

    if (!code || !state || !expected) return deny(res, 'missing code or state');

    // Constant-time compare so a mismatch leaks nothing through timing
    const a = Buffer.from(state);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return deny(res, 'state mismatch');
    }

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: requireEnv('GITHUB_CLIENT_ID'),
        client_secret: requireEnv('GITHUB_CLIENT_SECRET'),
        code,
      }),
    });
    const tokenBody = await tokenResponse.json();
    const token = tokenBody && tokenBody.access_token;
    if (!token) return deny(res, 'token exchange failed');

    const user = await gh('/user', token);
    if (!user || user.login !== ALLOWED_LOGIN) {
      return deny(res, 'this account is not permitted');
    }

    startSession(res, { login: user.login, token });
    res.writeHead(302, { Location: '/admin/' });
    res.end();
  } catch (e) {
    deny(res, e.message || 'sign-in failed');
  }
};
