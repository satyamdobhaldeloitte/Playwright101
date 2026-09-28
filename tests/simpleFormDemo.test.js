'use strict';

require('dotenv').config();
const { getBrowserDriver, buildCapabilities } = require('../utils/testmuConnect');
const matrix = require('../capabilities/matrix');

async function run(combo) {
  const testName = `Simple Form Demo - ${combo.platform}/${combo.browserName}`;
  console.log(`[START] ${testName}`);

  const capabilities = buildCapabilities({ ...combo, name: testName });
  const wsEndpoint = `wss://cdp.lambdatest.com/playwright?capabilities=${encodeURIComponent(
    JSON.stringify(capabilities)
  )}`;

  // Step 1 — connect using getBrowserDriver, not the connectBrowser shorthand,
  // so the wsEndpoint construction is explicit per the spec.
  const browser = await getBrowserDriver(combo.browserName).connect(wsEndpoint);

  // Explicit viewport prevents remote Firefox from defaulting to a tiny window
  // that causes elements to be "outside of the viewport" even after scrolling.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page    = await context.newPage();

  let passed    = false;
  let failReason = '';

  try {
    // Step 2 — navigate to the Selenium Playground hub
    await page.goto('https://www.testmuai.com/selenium-playground/');

    // Step 3 — locator strategy #1: text= (link visible text)
    // The hub page has a sticky header that occludes links after scroll in some browsers.
    // A native JS click via evaluate() bypasses Playwright's viewport-position check
    // while still exercising the text= locator to find the element.
    const hubLink = page.locator('text=Simple Form Demo').first();
    await hubLink.scrollIntoViewIfNeeded();
    await hubLink.evaluate(el => el.click());

    // Step 4 — URL assertion
    const url = page.url();
    if (!url.includes('simple-form-demo')) {
      throw new Error(`URL assertion failed — expected "simple-form-demo" in "${url}"`);
    }

    // Step 5
    const message = 'Welcome to TestMu AI';

    // Step 6 — locator strategy #2: CSS ID selector
    await page.fill('#user-message', message);

    // Step 7 — click "Get Checked Value".
    // The page renders <button id="showInput"> — the id IS the button, not a wrapper div.
    // Use evaluate(el => el.click()) to avoid Firefox's viewport-occlusion actionability block.
    const checkedBtn = page.getByRole('button', { name: /get checked value/i });
    const checkedBtnCount = await checkedBtn.count();
    if (checkedBtnCount > 0) {
      await checkedBtn.first().evaluate(el => el.click());
    } else {
      await page.locator('#showInput').evaluate(el => el.click());
    }

    // Step 8 — screenshot before reading the result
    await page.screenshot({
      path: `screenshots/simple-form-${combo.browserName}.png`,
      fullPage: true,
    });

    // Step 9 — assert displayed text via CSS ID
    const displayedText = await page.textContent('#message');
    if (displayedText !== message) {
      throw new Error(
        `#message assertion failed — expected "${message}", got "${displayedText}"`
      );
    }

    // Step 10 — locator strategy #3: XPath, re-verify the same element
    // Use * (any tag) because the element may not be a <div> — e.g. a <p> or <span>.
    const xpathText = await page
      .locator("xpath=//*[@id='message']")
      .textContent();
    if (xpathText !== message) {
      throw new Error(
        `XPath assertion failed — expected "${message}", got "${xpathText}"`
      );
    }

    passed = true;
    console.log(`[PASS] ${testName}`);
  } catch (err) {
    failReason = err.message;
    console.error(`[FAIL] ${testName} — ${failReason}`);
    throw err;
  } finally {
    // Step 11 — report pass/fail to LambdaTest dashboard before closing
    try {
      await page.evaluate(
        ({ status, remark }) => {
          // lambdatest_action is injected by the LambdaTest CDP proxy at runtime
          // eslint-disable-next-line no-undef
          lambdatest_action(
            JSON.stringify({ action: 'setTestStatus', arguments: { status, remark } })
          );
        },
        {
          status: passed ? 'passed' : 'failed',
          remark: passed ? 'All assertions passed' : failReason,
        }
      );
    } catch (_) {
      // setTestStatus is best-effort; don't mask the real test error
    }
    await browser.close();
  }
}

(async () => {
  const results = await Promise.allSettled(matrix.map(run));

  const failures = results.filter(r => r.status === 'rejected');
  failures.forEach(f => console.error('[ERROR]', f.reason?.message ?? f.reason));

  if (failures.length > 0) process.exit(1);
})();
