import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { renderPxl } from '../server/pxl.ts';

const rendered = await renderPxl(`
  pal({g:'#4c6844',G:'#324d35',b:'#72503b',B:'#4b372d',l:'#91a56c'});
  sprite('floor',{w:64,h:64},rect(0,0,64,64,'G'),rect(0,24,64,16,'b'),ellipse(44,18,18,10,'g'));
  sprite('wall',{w:64,h:64},rect(0,0,64,64,'G'),rect(12,0,9,64,'B'),rect(14,0,3,64,'b'),rect(46,0,7,64,'b'),ellipse(32,8,24,14,'g'));
  sprite('prop',{w:24,h:40},rect(10,14,5,26,'b'),ellipse(12,13,11,12,'G'),ellipse(10,9,8,7,'g'),line(11,22,1,16,'b',3));`, ['floor','wall','prop']);
assert.ok(rendered.ok, rendered.error);
const png = name => `data:image/png;base64,${rendered.assets[name].png}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {}) });
const page = await browser.newPage({viewport:{width:1440,height:900}});
const errors=[]; page.on('pageerror', e => errors.push(e.message));
let releaseSprites, releaseEnvironment, spriteRequests=0;
const spritesHeld = new Promise(resolve => { releaseSprites=resolve; });
const environmentHeld = new Promise(resolve => { releaseEnvironment=resolve; });
const grid={mode:'Square',columns:4,rows:4,wallHeight:4};
const terrain=[[0,.25,.5,.75],[0,.25,.5,.75],[0,.25,.5,.75],[0,.25,.5,.75]];
const scene={room:{preset:'forest',grid,openings:[],reverb:'outdoor'},listener:{position:[0,1.6,0],yaw:0},objects:[
  {id:'oak',label:'Wind in old oak',kind:'bed',sound:{query:'wind in trees'},position:[1,1,0],volume:.35,model:'speaker',wall:null,scale:1,muted:false},
  {id:'branch',label:'Branch with sparrows',kind:'event',sound:{query:'sparrow chirps'},position:[0,2,-1],volume:.2,intervalSec:[20,40],model:'birds',wall:'north',scale:1,muted:false},
]};
await page.route('**/api/scene',route=>route.fulfill({json:{kind:'create',scene}}));
await page.route('**/api/environment',async route=>{
  await environmentHeld;
  const events=[{type:'plan',id:'test-forest',title:'Whispers Beneath the Willow',concept:'An old forest with roots and uneven mossy ground.',shell:'#4b372d',colors:['#324d35','#4c6844','#72503b','#4b372d','#91a56c'],terrain},
    ...['floor','north','east','south','west'].map(surface=>({type:'texture',surface,png:png(surface==='floor'?'floor':'wall'),colors:[]})),{type:'done'}];
  await route.fulfill({contentType:'application/x-ndjson',body:events.map(e=>JSON.stringify(e)).join('\n')+'\n'});
});
await page.route('**/api/sprite',async route=>{spriteRequests++; await spritesHeld; await route.fulfill({json:{png:png('prop'),w:24,h:40}});});
await page.route('**/api/sound*',route=>route.fulfill({status:503,json:{error:'offline test'}}));
try {
  await page.goto(process.env.TEST_URL??'http://localhost:5173');
  assert.equal(await page.locator('canvas').count(),0,'no environment before a prompt');
  await page.getByLabel('Prompt',{exact:true}).fill('A mossy forest with birds on a branch');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Imagining'}).waitFor();
  assert.equal(spriteRequests,0,'no sprite generation before the environment');
  assert.equal(await page.locator('.room-rotation, .assets-panel').count(),0,'the loading shell has no room controls');
  assert.deepEqual(await page.evaluate(()=>window.sceneStore.getState().scene.objects),[],'the loading shell leaves the canonical scene empty');
  releaseEnvironment();
  await page.waitForFunction(()=>window.__pixelRoom?.().scene.room.art==='test-forest' && window.__pixelRoom().objects.length===2);
  await page.waitForFunction(()=>document.querySelectorAll('.sound-status').length===2 && window.__spawnBusy);
  assert.deepEqual(await page.evaluate(()=>window.__pixelRoom().scene.room.terrain),terrain);
  assert.ok((await page.evaluate(()=>window.__pixelRoom().scene.objects.find(o=>o.id==='oak').position[1]))>=1.25,'audio/source position is above raised ground');
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(()=>window.__spawnBusy),true,'portals stay open while sprites are pending');
  assert.equal(spriteRequests,2);
  await page.getByRole('button',{name:'Whispers Beneath the Willow',exact:true}).waitFor();
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/art-portals.png'});
  releaseSprites();
  await page.waitForFunction(()=>!window.__spawnBusy);
  await page.waitForFunction(()=>document.querySelectorAll('.sound-status').length===0);
  await page.waitForTimeout(150); // allow the final 10fps pixel frame to clear the closing portal
  await page.screenshot({path:'test-results/art-forest.png'});
  await page.getByRole('button',{name:'Rotate Right',exact:true}).click();
  await page.waitForFunction(()=>!window.__pixelRoom().rotating);
  assert.equal(await page.evaluate(()=>window.__pixelRoom().scene.objects.find(o=>o.id==='branch').wall),'north');
  assert.deepEqual(errors,[]);
  console.log('PASS environment renders before sprites; raised ground, waiting portals, source reveal and rotation');
} finally { releaseEnvironment(); releaseSprites(); await browser.close(); }
