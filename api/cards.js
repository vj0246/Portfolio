/* /api/cards — list, save and delete project cards in content/projects/.
   The route logic, validation and security model live in _lib.js. */

'use strict';

const { collectionRoute, validateCard, cardFilename } = require('./_lib');

module.exports = collectionRoute({
  dir: 'content/projects',
  noun: 'projects',
  validate: validateCard,
  filename: cardFilename,
});
