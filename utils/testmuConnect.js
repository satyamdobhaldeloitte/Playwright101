'use strict';

require('dotenv').config();
const { chromium, firefox, webkit } = require('playwright');

function getBrowserDriver(browserName) {
  if (browserName === 'pw-firefox') return firefox;
  if (browserName === 'pw-webkit') return webkit;
  return chromium;
}

function buildCapabilities({ browserName, platform, name }) {
  return {
    browserName,
    browserVersion: 'latest',
    'LT:Options': {
      platform,
      build: 'Selenium Playground Automation',
      name,
      user: process.env.LT_USERNAME,
      accessKey: process.env.LT_ACCESS_KEY,
      network: true,
      video: true,
      console: true,
      w3c: true,
    },
  };
}

async function connectBrowser({ browserName, platform, name }) {
  const driver = getBrowserDriver(browserName);
  const capabilities = buildCapabilities({ browserName, platform, name });
  const wsUrl = `wss://cdp.lambdatest.com/playwright?capabilities=${encodeURIComponent(
    JSON.stringify(capabilities)
  )}`;
  return driver.connect(wsUrl);
}

module.exports = { getBrowserDriver, buildCapabilities, connectBrowser };
