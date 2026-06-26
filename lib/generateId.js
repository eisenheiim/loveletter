const crypto = require('crypto');

function generateSiteId() {
  const suffix = crypto.randomBytes(4).toString('hex');
  return `v2026-${suffix}`;
}

module.exports = { generateSiteId };
