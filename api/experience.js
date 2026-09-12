/* /api/experience — list, save and delete entries in content/experience/.
   The route logic, validation and security model live in _lib.js. */

'use strict';

const { collectionRoute, validateExperience, experienceFilename } = require('./_lib');

module.exports = collectionRoute({
  dir: 'content/experience',
  noun: 'experience',
  validate: validateExperience,
  filename: experienceFilename,
});
