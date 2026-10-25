import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createFixtureRoom } from './create-fixture-room.mjs';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({headless:true, channel:process.env.PLAYWRIGHT_CHANNEL ?? 'chrome'});
const page = await browser.newPage({viewport:{width:1440,height:900}});
try {
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  assert.equal(await page.locator('.places-dock').isVisible(), false);
  const chips = await page.getByRole('group',{name:'Preloaded demo rooms'}).boundingBox();
  const prompt = await page.locator('.prompt-bar').boundingBox();
  assert.ok(chips.y + chips.height < prompt.y);
  await createFixtureRoom(page);
  await expect(page.locator('.places-panel .place-row')).toHaveCount(1,{timeout:15000});
  const name = await page.locator('.places-panel .place-row').innerText();
  await page.getByRole('region',{name:'Templates',exact:true}).getByRole('button',{name:'Beach',exact:true}).click();
  await page.waitForFunction(() => window.sceneStore.getState().scene.room.art === 'demo-beach');
  await page.waitForTimeout(1500);
  assert.deepEqual(await page.locator('.places-panel .place-row').allTextContents(), [name], 'template selection never adds a visited place');
  await page.getByRole('button',{name:'New Place',exact:true}).click();
  await expect(page.locator('.places-dock')).toBeHidden();
  const initial = page.locator('.initial-places');
  await expect(initial.getByRole('button',{name,exact:true})).toBeVisible();
  const list = await initial.boundingBox();
  const bar = await page.locator('.prompt-bar').boundingBox();
  assert.ok(list.y > bar.y + bar.height, 'history is below the prompt');
  assert.equal(await initial.locator('.places-beam').count(),0,'initial history is a plain list');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/initial-places.png'});
  await initial.getByRole('button',{name,exact:true}).click();
  await expect(page.locator('.places-panel .place-row')).toHaveCount(1);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.places-panel .place-row').count(),1,'reopening preserves the saved record');
  console.log('PASS: initial templates above prompt, visited list below, no initial sidebar, templates excluded from history, saved place reopens without duplication');
} finally { await browser.close(); }
