// CommonJS view of lib/oura-models/model-files.json, for scripts that cannot import TypeScript.
// One source of truth — see that file's comment.
const {
  required,
  bucketPrefix,
  constantsRequired,
  constantsPrefix,
} = require('../lib/oura-models/model-files.json')
module.exports = {
  REQUIRED_MODEL_FILES: required,
  BUCKET_PREFIX: bucketPrefix,
  REQUIRED_CONSTANTS_FILES: constantsRequired,
  CONSTANTS_BUCKET_PREFIX: constantsPrefix,
}
