'use strict';

require('dotenv').config();
const { getBrowserDriver, buildCapabilities } = require('../utils/testmuConnect');
const matrix = require('../capabilities/matrix');

async function run(combo) {
  const testName = `Input Form Submit - ${combo.platform}/${combo.browserName}`;
  console.log(`[START] ${testName}`);

  const capabilities = buildCapabilities({ ...combo, name: testName });
  const wsEndpoint = `wss://cdp.lambdatest.com/playwright?capabilities=${encodeURIComponent(
    JSON.stringify(capabilities)
  )}`;

  const browser = await getBrowserDriver(combo.browserName).connect(wsEndpoint);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page    = await context.newPage();

  let passed     = false;
  let failReason = '';

  try {
    // Navigate to hub and into the Input Form Submit page
    await page.goto('https://www.testmuai.com/selenium-playground/');

    // Locator #1 — text= (link visible text)
    // Sticky header occludes links after scroll in some browsers; use a native JS click
    // via evaluate() to bypass Playwright's viewport-position actionability check.
    const formHubLink = page.locator('text=Input Form Submit').first();
    await formHubLink.scrollIntoViewIfNeeded();
    await formHubLink.evaluate(el => el.click());

    // --- Step 3: Submit empty form ---
    // Locator #2 — getByRole (ARIA role + accessible name)
    const submitBtn = page.getByRole('button', { name: 'Submit' });
    await submitBtn.click();

    // --- Step 4: Validation check ---
    // The app may rely on the browser's native HTML5 constraint validation rather than
    // rendering a custom DOM message. Native tooltip text differs across browsers:
    //   Chrome/Edge  → "Please fill out this field"
    //   Firefox      → "Please fill out this field." (period) or localised
    //   WebKit/Safari → "Fill out this field"
    // We probe checkValidity() on #name (the first required field) to confirm native
    // validation fired, then also attempt to read any custom validation message the
    // app may have injected into the DOM, logging whichever path was taken.
    const validationResult = await page.evaluate(() => {
      const nameInput = document.querySelector('#name');
      if (!nameInput) return { found: false };

      const nativeInvalid   = !nameInput.checkValidity();
      const validationMsg   = nameInput.validationMessage; // browser-supplied text
      const customMsgEl     = document.querySelector('.alert, .error, [class*="error"], [class*="invalid"]');
      const customMsgText   = customMsgEl ? customMsgEl.innerText.trim() : null;

      return { found: true, nativeInvalid, validationMsg, customMsgText };
    });

    console.log(`[INFO] ${testName} — validation probe:`, JSON.stringify(validationResult));

    if (!validationResult.found) {
      throw new Error('Could not locate #name input to probe validation state');
    }

    if (!validationResult.nativeInvalid) {
      // Form reported valid on empty submission — unexpected; fail loudly
      throw new Error(
        'Empty-form submission did not trigger validation — #name.checkValidity() returned true'
      );
    }
    // Validation fired correctly. We assert checkValidity() === false rather than
    // matching a browser-specific tooltip string, keeping the check cross-browser safe.
    console.log(
      `[INFO] ${testName} — validation confirmed via checkValidity()=false` +
      (validationResult.customMsgText
        ? `; custom DOM message: "${validationResult.customMsgText}"`
        : `; native tooltip: "${validationResult.validationMsg}"`)
    );

    // --- Step 5: Fill all form fields (CSS ID selectors — locator #3) ---
    await page.fill('#name',           'TestMu AI User');
    await page.fill('#inputEmail4',    'testmu@example.com');
    await page.fill('#inputPassword4', 'Passw0rd!');
    await page.fill('#company',        'TestMu AI Inc.');
    await page.fill('#websitename',    'https://www.testmuai.com');

    // --- Step 6: Country dropdown — attribute selector + label match (locator #4) ---
    await page.selectOption('select[name="country"]', { label: 'United States' });

    await page.fill('#inputCity',     'San Francisco');
    await page.fill('#inputAddress1', '100 Market Street');
    await page.fill('#inputAddress2', 'Suite 300');
    await page.fill('#inputState',    'California');
    await page.fill('#inputZip',      '94105');

    // --- Step 7: Submit the filled form ---
    await submitBtn.click();

    // --- Step 8: Screenshot ---
    await page.screenshot({
      path: `screenshots/input-form-${combo.browserName}.png`,
      fullPage: true,
    });

    // --- Step 9: Assert success message via text= locator (locator #5) ---
    const successLocator = page.locator(
      'text=Thanks for contacting us, we will get back to you shortly.'
    );
    // waitForSelector-style check: gives the app time to render the message
    await successLocator.waitFor({ state: 'visible', timeout: 10_000 });

    const successText = (await successLocator.textContent()).trim();
    if (!successText.includes('Thanks for contacting us')) {
      throw new Error(`Success message assertion failed — got: "${successText}"`);
    }

    passed = true;
    console.log(`[PASS] ${testName}`);
  } catch (err) {
    failReason = err.message;
    console.error(`[FAIL] ${testName} — ${failReason}`);
    throw err;
  } finally {
    // Report result to LambdaTest dashboard before closing the session
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
