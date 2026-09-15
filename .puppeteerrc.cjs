const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Save Chrome inside the local project folder so Render packages it
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
