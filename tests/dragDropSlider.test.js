'use strict';

require('dotenv').config();
const { getBrowserDriver, buildCapabilities } = require('../utils/testmuConnect');
const matrix = require('../capabilities/matrix');

const TARGET_VALUE = 95;

async function run(combo) {
  const testName = `Drag Drop Slider - ${combo.platform}/${combo.browserName}`;
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
    // Navigate to hub then into the Drag & Drop Sliders page
    await page.goto('https://www.testmuai.com/selenium-playground/');

    // Locator #1 — text= (link visible text)
    // Sticky header occludes links after scroll in some browsers; use a native JS click
    // via evaluate() to bypass Playwright's viewport-position actionability check.
    const sliderHubLink = page.locator('text=Drag & Drop Sliders').first();
    await sliderHubLink.scrollIntoViewIfNeeded();
    await sliderHubLink.evaluate(el => el.click());

    // --- Runtime locator discovery ---
    // List every range input's id, name, and current value so we can confirm
    // which one is the "Default value 15" slider without hardcoding assumptions.
    const sliderMeta = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input[type="range"]')).map((el, i) => ({
        index : i,
        id    : el.id    || '(none)',
        name  : el.name  || '(none)',
        value : el.value,
        min   : el.min,
        max   : el.max,
      }))
    );
    console.log(`[INFO] ${testName} — range inputs found:`, JSON.stringify(sliderMeta, null, 2));

    // Pin to value="15" when the attribute is present; fall back to nth-match position.
    // The "Default value 15" slider is the only one that starts at 15 on this page.
    const hasByValue = sliderMeta.some(s => s.value === '15');
    const sliderLocator = hasByValue
      ? page.locator('input[type="range"][value="15"]').first()
      : page.locator('input[type="range"]').nth(
          sliderMeta.findIndex(s => s.id === '' || s.index === 0) ?? 0
        );

    // --- Keyboard-driven slider movement (no flaky mouse dragging) ---
    await sliderLocator.focus();

    // Press Home to reset to min, then read the actual min via evaluate()
    await sliderLocator.press('Home');
    const sliderMin = await sliderLocator.evaluate(el => Number(el.min));
    console.log(`[INFO] ${testName} — slider min=${sliderMin}, pressing ArrowRight ${TARGET_VALUE - sliderMin} times`);

    // Arrow-key each step from min up to TARGET_VALUE
    const steps = TARGET_VALUE - sliderMin;
    for (let i = 0; i < steps; i++) {
      await sliderLocator.press('ArrowRight');
    }

    // Brief settle before reading the output
    await page.waitForTimeout(400);

    // Locator #2 — CSS ID: #rangeSuccess (the output label for the "Default value 15" slider)
    const outputText = (await page.textContent('#rangeSuccess')).trim();
    if (outputText !== String(TARGET_VALUE)) {
      throw new Error(
        `#rangeSuccess assertion failed — expected "${TARGET_VALUE}", got "${outputText}"`
      );
    }

    // Screenshot after the slider is in position
    await page.screenshot({
      path: `screenshots/slider-${combo.browserName}.png`,
      fullPage: true,
    });

    // Locator #3 — ARIA role "slider" (cross-validates that ArrowRight actually moved the thumb)
    // If the element exposes the role, getByRole() will find it; otherwise we fall back to an
    // nth CSS selector so the third locator strategy is always exercised.
    // Locator #3 — ARIA role "slider" (cross-validates that ArrowRight actually moved the thumb)
    // IMPORTANT: getAttribute('value') returns the INITIAL HTML attribute and never updates after
    // keyboard interaction — use evaluate(el => el.value) to read the live DOM property instead.
    let sliderValueAttr;
    const roleMatches = await page.getByRole('slider').all();
    if (roleMatches.length > 0) {
      for (const handle of roleMatches) {
        const v = await handle.evaluate(el => el.value);
        if (v === String(TARGET_VALUE)) {
          sliderValueAttr = v;
          break;
        }
      }
      if (sliderValueAttr === undefined) {
        // Still exercises the locator strategy even if our specific slider isn't found by value
        sliderValueAttr = await roleMatches[0].evaluate(el => el.value);
      }
    } else {
      // nth-of-type CSS fallback when no ARIA role is exposed
      const nthIndex = hasByValue
        ? sliderMeta.findIndex(s => s.value === '15')
        : 0;
      sliderValueAttr = await page
        .locator(`input[type="range"]:nth-of-type(${nthIndex + 1})`)
        .evaluate(el => el.value);
    }

    if (sliderValueAttr !== String(TARGET_VALUE)) {
      throw new Error(
        `Slider value attribute assertion failed — expected "${TARGET_VALUE}", got "${sliderValueAttr}"`
      );
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
