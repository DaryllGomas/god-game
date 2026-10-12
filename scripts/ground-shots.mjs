// node scripts/ground-shots.mjs <url> <cdpPort> <outPrefix> '<json poses: [{name,x,z,d,pitch,yaw}]>' [prepJs]
import { spawn } from 'node:child_process'; import { mkdtempSync, writeFileSync } from 'node:fs';
const [url, port, out, poses, prep] = process.argv.slice(2);
const ch = spawn('chromium', ['--headless=new','--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist','--mute-audio','--no-first-run',`--user-data-dir=${mkdtempSync('/tmp/gs-')}`,`--remote-debugging-port=${port}`,'--window-size=1920,1080','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let ws;
for(let i=0;i<60;i++){try{const l=await (await fetch(`http://127.0.0.1:${port}/json`)).json();const p=l.find(x=>x.type==='page');if(p){ws=new WebSocket(p.webSocketDebuggerUrl);break;}}catch{}await sleep(200);}
await new Promise(r=>ws.onopen=r); let id=0; const pend=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true}); return r.result?.exceptionDetails ? 'ERR '+r.result.exceptionDetails.exception?.description : r.result?.result?.value;};
await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:"try{localStorage.setItem('godgame.intro.v1','1')}catch(e){}"});
await send('Page.navigate',{url}); await sleep(8000);
await ev('game.hud.toggleHelp(false)'); await sleep(2500);
if (prep) console.log('prep', await ev(prep));
await sleep(2500);
await ev(`document.querySelectorAll('body *').forEach(e=>{ if(e.tagName!=='CANVAS' && !e.querySelector('canvas')) e.style.visibility='hidden'; }); 1`);
for (const p of JSON.parse(poses)) {
  await ev(`game.godCam.setPose({x:${p.x}, z:${p.z}, distance:${p.d}, pitch:${p.pitch}, yaw:${p.yaw ?? 0.5}}, true)`);
  await sleep(2200);
  const s=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(`${out}-${p.name}.png`,Buffer.from(s.result.data,'base64'));
}
ws.close(); ch.kill();
