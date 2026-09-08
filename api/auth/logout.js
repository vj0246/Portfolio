/* POST /api/auth/logout — drop the session cookie. */

'use strict';

const { clearCookie, SESSION_COOKIE } = require('../_lib');

module.exports = async (req, res) => {
  clearCookie(res, SESSION_COOKIE);
  res.status(200).json({ ok: true });
};
