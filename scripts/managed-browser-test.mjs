import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { renderPxl } from '../server/pxl.ts';
import { mkdir } from 'node:fs/promises';

const pixels = await renderPxl(`sprite('floor',{w:64,h:64},rect(0,0,64,64,'#324d35')); sprite('strip',{w:32,h:8},rect(0,0,8,8,'#324d35'),rect(8,0,8,8,'#91a56c'),rect(16,0,8,8,'#72503b'),rect(24,0,8,8,'#4b372d'));`, ['floor','strip']);
assert.ok(pixels.ok, pixels.error);
const wav = Buffer.alloc(44 + 22050 * 2); wav.write('RIFF',0); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(22050,24); wav.writeUInt32LE(44100,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<22050;i++)wav.writeInt16LE(Math.round(Math.sin(i/22050*220*Math.PI*2)*2000),44+i*2);
const browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[],requests=[],loadedAudio=[]; let streamCount=0, resultCount=0, legacyCalls=0;
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.headers()['content-type']?.startsWith('audio/'))loadedAudio.push(r.status())});
const grid={mode:'Square',columns:4,rows:4,wallHeight:4};
const terrain=Array.from({length:4},()=>[0,.25,.5,.75]);
const scene={room:{preset:'forest',grid,openings:[],reverb:'outdoor',art:'agent-test',terrain},listener:{position:[0,1.6,0],yaw:0},objects:[
 {id:'oak',label:'Old oak',kind:'bed',sound:{query:'wind in oak leaves'},position:[1,1.5,0],volume:.3,model:'speaker',wall:null,scale:1,muted:false},
 {id:'birds',label:'Sparrows on branch',kind:'event',sound:{query:'sparrow chirps'},position:[0,2,-1.775],volume:.2,intervalSec:[20,30],model:'birds',wall:'north',scale:1,muted:false},
]};
const url=file=>`/api/world?action=asset&token=test-run-1&file=${file}`;
const result={response:{kind:'create',scene},assets:{envId:'agent-test',environment:{concept:'A forest clearing',shell:'#324d35',colors:['#324d35','#91a56c','#72503b','#4b372d'],openAir:true,terrain,textures:{floor:{url:url('floor'),w:64,h:64,frames:1,fps:10}}},sprites:scene.objects.map(o=>({objectId:o.id,label:o.label,query:o.sound.query,wall:o.wall,url:url('strip'),w:8,h:8,frames:4,fps:10})),sounds:scene.objects.map(o=>({objectId:o.id,query:o.sound.query,kind:o.kind,fileId:`file_${o.id}`,url:url(o.id)}))}};
await page.route('**/api/scene',route=>{const body=route.request().postDataJSON();requests.push(body);return route.fulfill({status:202,json:{kind:'managed',token:`test-run-${requests.length}`}})});
await page.route('**/api/environment',route=>{legacyCalls++;return route.fulfill({json:{}})});
await page.route('**/api/sprite',route=>{legacyCalls++;return route.fulfill({json:{}})});
await page.route('**/api/world*',async route=>{
 const request=route.request(), query=new URL(request.url()).searchParams;
 if(request.method()==='POST'){
  const body=request.postDataJSON();
  assert.equal(body.action,'result');
  if(body.token==='test-run-1'){
   assert.equal(body.scene,null);
   if(++resultCount===1)return route.fulfill({status:202,json:{pending:true}});
   return route.fulfill({json:result});
  }
  return route.fulfill({json:{response:{kind:'edit',ops:[{op:'set_volume',id:'oak',volume:.1}]},assets:{envId:'agent-test',sprites:[],sounds:[]}}});
 }
 if(query.get('action')==='stream'){
  const token=query.get('token');
  if(token==='test-run-3')return route.fulfill({contentType:'text/event-stream',body:'data: {"type":"error","error":"Claude could not finish this edit."}\n\n'});
  streamCount++;
  const events=[{type:'progress',id:'planning',message:'Claude is creating your environment…'},...(streamCount===1?[{type:'reconnect'}]:[{type:'complete'}])];
  return route.fulfill({contentType:'text/event-stream',body:events.map(e=>'data: '+JSON.stringify(e)).join('\r\n\r\n')+'\r\n\r\n'});
 }
 const file=query.get('file');
 if(file==='floor'||file==='strip')return route.fulfill({contentType:'image/png',body:Buffer.from(pixels.assets[file].png,'base64')});
 return route.fulfill({contentType:'audio/wav',body:wav});
});
try{
 await page.goto(process.env.TEST_URL??'http://localhost:5173');
 assert.equal(await page.locator('canvas').count(),0);
 await page.getByLabel('Prompt',{exact:true}).fill('An open forest');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Claude'}).waitFor();
 assert.equal(await page.locator('canvas').count(),0,'room stays hidden while Claude is working');
 await page.waitForFunction(()=>window.__pixelRoom?.().scene.objects.every(o=>o.sound.assetId?.startsWith('managed:')));
 await page.waitForFunction(()=>!window.__spawnBusy);
 assert.ok(streamCount>=2,'client reconnects without starting a second run');assert.equal(requests.length,1);assert.equal(requests[0].scene,null);
 assert.equal(legacyCalls,0,'managed output never calls the Gemini art pipeline');
 const frames=[];for(let i=0;i<8;i++){frames.push(await page.evaluate(()=>window.__pixelRoom().objects.find(o=>o.id==='oak').artFrame));await page.waitForTimeout(120)}
 assert.ok(new Set(frames).size>1,'sprite sheet animates');
 await page.evaluate(()=>window.__pixelRoomEdit([{op:'move',id:'oak',position:[-1,1.5,1]},{op:'set_muted',id:'oak',muted:true}]));
 const before=await page.evaluate(()=>window.__pixelRoom().scene.objects.find(o=>o.id==='oak'));
 const stopped=[];for(let i=0;i<4;i++){stopped.push(await page.evaluate(()=>window.__pixelRoom().objects.find(o=>o.id==='oak').artFrame));await page.waitForTimeout(120)}
 assert.equal(new Set(stopped).size,1,'muting freezes the animation');
 await page.getByLabel('Prompt',{exact:true}).fill('Make the oak quieter');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.waitForFunction(()=>window.__pixelRoom().scene.objects.find(o=>o.id==='oak').volume===.1);
 const after=await page.evaluate(()=>window.__pixelRoom().scene.objects.find(o=>o.id==='oak'));
 assert.deepEqual(after.position,before.position);assert.equal(after.muted,true);assert.equal(requests[1].sessionToken,'test-run-1');
 await page.getByLabel('Prompt',{exact:true}).fill('A failing edit');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'could not finish'}).waitFor();
 assert.equal(await page.getByLabel('Prompt',{exact:true}).inputValue(),'A failing edit');
 assert.deepEqual(await page.evaluate(()=>window.__pixelRoom().scene.objects.find(o=>o.id==='oak')),after);
 for(let i=0;i<30&&loadedAudio.length<2;i++)await page.waitForTimeout(200);
 assert.ok(loadedAudio.length>=2&&loadedAudio.every(status=>status===200),'chirp audio decodes through the existing engine');
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/managed-flow.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS managed reconnect, delayed files, real image/audio decoding, sprite animation/mute, follow-up context and safe edit failure');
}finally{await browser.close()}
