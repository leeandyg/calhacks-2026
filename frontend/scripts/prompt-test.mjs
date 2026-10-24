import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], submissions = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'log') submissions.push(message.text()); });
try {
  await mkdir('test-results', { recursive: true });
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  await page.waitForFunction(() => window.__pixelRoom?.().rendering);
  const input = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const send = page.getByRole('button', { name: 'Send', exact: true });
  const rotate = page.getByRole('button', { name: 'Rotate Right', exact: true });
  assert.equal(await page.locator('[data-beam]').count(), 1);
  assert.equal(await page.locator('form').count(), 1);
  assert.equal(await page.locator('input[type=text]').count(), 1);
  assert.equal(await page.locator('textarea').count(), 0);
  assert.equal(await rotate.innerText(), '');
  const left = page.getByRole('button', { name: 'Rotate Left', exact: true });
  assert.equal(await left.innerText(), '');
  assert.equal(await page.getByRole('button').count(), 3);
  assert.equal(await input.getAttribute('placeholder'), 'Generate anything...');
  assert.ok(await send.isDisabled());
  await input.fill('   '); await input.press('Enter');
  assert.ok(await send.isDisabled());
  assert.equal(submissions.length, 0);
  await input.fill('  A quiet forest room  '); await send.click();
  assert.equal(await input.inputValue(), '');
  assert.deepEqual(submissions, ['A quiet forest room']);
  assert.ok(await send.isDisabled());
  await input.fill('  Rain on the window  '); await input.press('Enter');
  assert.equal(await input.inputValue(), '');
  assert.deepEqual(submissions, ['A quiet forest room', 'Rain on the window']);
  const before = await page.evaluate(() => window.__pixelRoom().orientation);
  await rotate.click(); await page.waitForFunction(() => !window.__pixelRoom().rotating);
  assert.equal(await page.evaluate(() => window.__pixelRoom().orientation), (before + 3) % 4);
  await left.click(); await page.waitForFunction(() => !window.__pixelRoom().rotating);
  assert.equal(await page.evaluate(() => window.__pixelRoom().orientation), before, 'left reverses right');
  await input.fill('Hover check'); await send.hover(); await page.waitForTimeout(180);
  assert.ok(await send.evaluate(button => new DOMMatrix(getComputedStyle(button).transform).m42 < 0));
  await input.fill(''); await page.mouse.move(10, 10);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 780 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(180);
    const layout = await page.evaluate(() => {
      const bar = document.querySelector('.prompt-bar'), input = bar.querySelector('input'), send = bar.querySelector('.prompt-send'), arrows = [...document.querySelectorAll('.rotate-room')];
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
      return { bar: rect(bar), send: rect(send), arrows: arrows.map(rect), arrowStyles: arrows.map(button => ({ border: getComputedStyle(button).borderWidth, background: getComputedStyle(button).backgroundColor })), color: getComputedStyle(input).color, background: getComputedStyle(bar).backgroundColor, radius: getComputedStyle(bar).borderRadius, fontSize: getComputedStyle(input).fontSize, placeholder: getComputedStyle(input, '::placeholder').color, opacity: getComputedStyle(send).opacity, bounds: window.__pixelRoom().bounds, overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
    });
    assert.ok(Math.abs(layout.bar.width - Math.min(640, viewport.width * .92)) < 1);
    assert.equal(layout.bar.height, 76); assert.equal(layout.radius, '999px');
    assert.deepEqual([layout.send.width, layout.send.height], [44, 44]);
    assert.equal(layout.background, 'rgb(42, 44, 51)');
    assert.equal(layout.color, 'rgb(232, 232, 240)');
    assert.equal(layout.fontSize, '22px');
    assert.equal(layout.placeholder, 'rgb(122, 122, 144)');
    assert.equal(layout.opacity, '0.45');
    assert.ok(layout.bounds.bottom < layout.bar.y, 'room clears the taller prompt');
    assert.ok(layout.arrows[0].right < layout.bounds.left && layout.arrows[1].x > layout.bounds.right, 'arrows flank the room without overlapping it');
    assert.ok(layout.arrows.every(arrow => arrow.x >= 0 && arrow.right <= viewport.width && arrow.y > layout.bounds.top && arrow.bottom < layout.bounds.bottom));
    assert.ok(layout.arrowStyles.every(style => style.border === '0px' && style.background === 'rgba(0, 0, 0, 0)'));
    assert.equal(layout.overflow, false);
    await page.screenshot({ path: `test-results/prompt-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: one BorderBeam pill, specified dimensions/colors, blank input guard, trimmed click/Enter submission, clearing, icon rotation, desktop/mobile/landscape clearance and no browser errors');
} finally { await browser.close(); }
