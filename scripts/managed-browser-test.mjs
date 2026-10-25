import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { renderPxl } from '../server/pxl.ts';
import { mkdir } from 'node:fs/promises';

const pixels = await renderPxl(`sprite('floor',{w:64,h:64},rect(0,0,64,64,'#324d35')); sprite('wall',{w:64,h:64},rect(0,0,64,64,'#ff55cc')); sprite('strip',{w:32,h:8},rect(0,0,8,8,'#324d35'),rect(8,0,8,8,'#91a56c'),rect(16,0,8,8,'#72503b'),rect(24,0,8,8,'#4b372d'));`, ['floor','wall','strip']);
assert.ok(pixels.ok, pixels.error);
const wav = Buffer.alloc(44 + 22050 * 2); wav.write('RIFF',0); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(22050,24); wav.writeUInt32LE(44100,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<22050;i++)wav.writeInt16LE(Math.round(Math.sin(i/22050*220*Math.PI*2)*2000),44+i*2);
const browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const imageLoads=new Map(); let releaseDuplicates; const duplicateImages=new Promise(resolve=>{releaseDuplicates=resolve});
const errors=[],requests=[],loadedAudio=[]; let streamCount=0, resultCount=0, legacyCalls=0;
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.headers()['content-type']?.startsWith('audio/'))loadedAudio.push(r.status())});
const grid={mode:'Square',columns:4,rows:4,wallHeight:4};
const terrain=Array.from({length:4},()=>[0,.25,.5,.75]);
const scene={room:{preset:'forest',grid,openings:[],reverb:'outdoor',art:'agent-test',terrain},listener:{position:[0,1.6,0],yaw:0},objects:[
 {id:'oak',label:'Old oak',kind:'bed',sound:{query:'wind in oak leaves'},position:[1,1.5,0],volume:.3,model:'speaker',wall:null,scale:1,muted:false},
 {id:'birds',label:'Sparrows on branch',kind:'event',sound:{query:'sparrow chirps'},position:[0,2,-1.775],volume:.2,intervalSec:[1,2],model:'birds',wall:'north',scale:1,muted:false},
]};
const url=file=>`/api/world?action=asset&token=test-run-1&file=${file}`;
const result={response:{kind:'create',scene},assets:{envId:'agent-test',environment:{concept:'A forest clearing',shell:'#324d35',colors:['#324d35','#91a56c','#72503b','#4b372d','#ff55cc'],openAir:true,terrain,textures:{floor:{url:url('floor'),w:64,h:64,frames:1,fps:10},north:{url:url('wall'),w:64,h:64,frames:1,fps:10},west:{url:url('wall'),w:64,h:64,frames:1,fps:10}}},sprites:scene.objects.map(o=>({objectId:o.id,label:o.label,query:o.sound.query,wall:o.wall,url:url('strip'),w:8,h:8,frames:4,fps:10})),sounds:scene.objects.map(o=>({objectId:o.id,query:o.sound.query,kind:o.kind,fileId:`file_${o.id}`,url:url(o.id)}))}};
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
 if(['floor','wall','strip'].includes(file)){
  imageLoads.set(file,(imageLoads.get(file)??0)+1);
  if(imageLoads.get(file)>1)await duplicateImages;
  return route.fulfill({contentType:'image/png',body:Buffer.from(pixels.assets[file].png,'base64')});
 }
 return route.fulfill({contentType:'audio/wav',body:wav});
});
try{
 await page.goto(process.env.TEST_URL??'http://localhost:5173');
 assert.equal(await page.locator('canvas').count(),0);
 assert.deepEqual(await page.evaluate(()=>window.sceneStore.getState().scene.objects),[]);
 await page.getByLabel('Prompt',{exact:true}).fill('An open forest');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Claude'}).waitFor();
 assert.equal(await page.locator('canvas').count(),0,'room stays hidden while Claude is working');
 await page.waitForFunction(()=>window.__pixelRoom?.().scene.objects.every(o=>o.sound.assetId?.startsWith('managed:')));
 await page.waitForFunction(()=>!window.__spawnBusy);
 assert.ok(streamCount>=2,'client reconnects without starting a second run');assert.equal(requests.length,1);assert.equal(requests[0].scene,null);
 assert.equal(legacyCalls,0,'managed output never calls the Gemini art pipeline');
 const [x,y]=await page.evaluate(()=>window.__pixelRoomProject([0,3,-1.78]));
 const wallPixels=await page.screenshot({clip:{x:Math.round(x)-15,y:Math.round(y)-15,width:30,height:30}});
 const pink=await page.evaluate(async base64=>{
  const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=30;
  const context=canvas.getContext('2d');context.drawImage(image,0,0);
  const data=context.getImageData(0,0,30,30).data;let count=0;
  for(let i=0;i<data.length;i+=4)if(data[i]>data[i+1]*1.3 && data[i+2]>data[i+1]*1.3)count++;
  return count;
 },wallPixels.toString('base64'));
 assert.ok(pink>600,`generated wall pixels must be visible on reveal, without downloading images twice (pink=${pink})`);
 assert.ok([...imageLoads.values()].every(count=>count===1),'one decoded image per URL serves preload and every mesh');
 releaseDuplicates();

 // Even an older openAir=true result must paint a complete physical shell.
 for(let turn=0;turn<4;turn++){
  const state=await page.evaluate(()=>window.__pixelRoom());
  assert.ok(state.shell.walls.every(wall=>wall.bodyVisible && wall.thickness===.42),'all walls keep their solid 0.42-block slabs');
  assert.ok(state.walls.every(wall=>wall.modules===16),'four complete walls, without dummy window cutouts');
  assert.equal(state.walls.filter(wall=>wall.opacity===1).length,2,'manual view still fades only the near walls');
  for(const wall of state.walls)for(const column of [0,3])for(const level of [0,3])
   assert.equal(await page.evaluate(([id,column,level])=>window.__pixelRoomWallSolid(id,column,level),[wall.id,column,level]),true,'complete solid corner segments');
  if(turn===0){await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/managed-solid-shell.png'})}
  await page.getByRole('button',{name:'Rotate Right',exact:true}).click();
  await page.waitForFunction(()=>!window.__pixelRoom().rotating);
 }

 const frames=[];for(let i=0;i<8;i++){frames.push(await page.evaluate(()=>window.__pixelRoom().objects.find(o=>o.id==='oak').artFrame));await page.waitForTimeout(120)}
 assert.ok(new Set(frames).size>1,'sprite sheet animates');
 await page.evaluate(()=>window.__pixelRoomEdit([{op:'move',id:'oak',position:[-1,1.5,1],wall:'west'},{op:'set_muted',id:'oak',muted:true}]));
 const before=await page.evaluate(()=>window.__pixelRoom().scene.objects.find(o=>o.id==='oak'));
 assert.equal(await page.evaluate(()=>typeof window.__pixelRoom().objects.find(o=>o.id==='oak').artFrame),'number','managed sprite survives a wall/floor move without a stock prop');
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
 console.log('PASS managed reconnect, delayed files, real image/audio decoding, solid slabs/corners, sprite animation/mute/movement, follow-up context and safe edit failure');
}finally{releaseDuplicates();await browser.close()}
