import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-gl=angle','--enable-gpu','--ignore-gpu-blocklist','--use-angle=vulkan']});
const p = await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[]; p.on('pageerror',e=>errors.push(String(e))); p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await p.goto(process.env.SITE_URL+'/index.html?shot=default');
await p.waitForFunction(()=>window.game);
await p.evaluate(()=>{document.querySelectorAll('style').forEach(s=>{if(s.textContent.includes('visibility: hidden !important'))s.remove();});game.audio.setMuted(true);});
await p.getByText('Begin',{exact:false}).first().click({timeout:5000});
await p.evaluate(()=>{game.speed=4; game.pace?.choose('stay'); game.dayTime=0.3; const v=game.villages[0]; v.worshipFraction=0; v.store.food=300; v.store.wood=0; for(const x of v.villagers)game.disciples.assign(x,'worshipper'); const x=v.villagers[0]; window.worker=x; game.disciples.assign(x,'forester'); window.woodBefore=v.store.wood; window.timeBefore=game.time;});
if(process.argv.includes('fast')) await p.evaluate(()=>game.advance(240));
else await p.waitForTimeout(60000);
const forester=await p.evaluate(()=>({before:woodBefore,after:game.villages[0].store.wood,elapsed:game.time-timeBefore,task:worker.task.type,job:worker.disciple}));
if(forester.after<=forester.before)throw Error('forester did not raise wood '+JSON.stringify(forester));
const builderBefore=await p.evaluate(()=>{const v=game.villages[0];game.projectSystem.startNow(v);v.store.wood=300;v.store.food=300;for(const x of v.villagers)game.disciples.assign(x,'builder');const s=v.projectSite; window.testSite=s; s.have.wood=0;s.have.stone=0;s.have.food=0;window.builderDeliveries={wood:0,food:0,stone:0}; const deliver=s.deliver.bind(s);s.deliver=(g,v,r,a)=>{builderDeliveries[r]+=a;return deliver(g,v,r,a);};return {fraction:s.fraction,stone:s.have.stone,have:{...s.have}};});
if(process.argv.includes('fast')) await p.evaluate(()=>game.advance(240));
else await p.waitForTimeout(60000);
const builder=await p.evaluate(()=>({fraction:testSite.fraction,stone:testSite.have.stone,have:{...testSite.have},deliveries:builderDeliveries,tasks:game.villages[0].villagers.map(v=>v.task.type)}));
if(builder.fraction<=builderBefore.fraction||builder.stone<=builderBefore.stone||builder.deliveries.stone<2||builder.deliveries.wood<1)throw Error('builder failed '+JSON.stringify(builder));
await writeFile(process.env.OUT_DIR+'/work-numbers.json',JSON.stringify({forester,builderBefore,builder},null,2));
const checks=await p.evaluate(()=>{game.paused=true; const v=game.villages[0],x=v.villagers[0],f=v.fields[0]; x.pos.copy(f.pos);game.events.emit('place',{entity:x,x:f.pos.x,z:f.pos.z});const drop=x.disciple;game.disciples.assign(x,'forester');let ground=null;for(let dx=-25;dx<25&&!ground;dx+=2)for(let dz=-25;dz<25;dz+=2){const a=v.center.x+dx,b=v.center.z+dz;game.events.emit('place',{entity:x,x:a,z:b});if(x.disciple===null){ground={x:a,z:b};break;}}const clear=x.disciple;const other=game.villages.find(v=>v.owner!=='player').villagers[0];const refused=game.disciples.assign(other,'builder');game.disciples.assign(x,'fisher');game.saves.save();const save=JSON.parse(localStorage.getItem('godgame.save.v1'));return {drop,clear,ground,refused,saveRow:save.villagers.find(r=>r[1]===x.seed)};});
if(checks.drop!=='farmer'||checks.clear!==null||checks.refused!==false||checks.saveRow.length!==13)throw Error('assignment/save failed '+JSON.stringify(checks));
const workChecks=await p.evaluate(()=>{
  const v=game.villages[0],x=v.villagers[0];v.store.food=20;for(const a of v.villagers){a.hunger=0;game.disciples.assign(a,'worshipper');a.held=a!==x;}
  x.carry(null,0);x.hunger=0.8;game.disciples.assign(x,'farmer');game.advance(0.1);
  const hungryTask=x.task.type;game.advance(25);const fedHunger=x.hunger;
  const f=v.fields[0]; f.claimedBy=0;f.restore(1,0); x.carry(null,0);x.hunger=0;x.pos.copy(f.pos);x.object.position.copy(x.pos);game.disciples.assign(x,'farmer');const before=v.store.food;game.advance(15);const farmerFood=v.store.food-before;
  game.disciples.assign(x,'forester');v.worshipFraction=1;game.advance(2);const protectedRole=x.role;
  // Locate a shoreline from the actual terrain, then let the fisher select it again.
  let shore=null;
  for(let dx=-240;dx<=240&&!shore;dx+=2)for(let dz=-240;dz<=240;dz+=2){
    const a=v.center.x+dx,b=v.center.z+dz,y=game.terrain.heightAt(a,b);
    // SEA_LEVEL is zero in this world.
    if(y>=0.15&&y<=1.5&&game.terrain.heightAt(a,b+2)<=0&&game.terrain.heightAt(a,b+12)<=0){shore={x:a,z:b,y};break;}
  }
  if(!shore)throw Error('no shore found');
  x.carry(null,0);x.hunger=0;x.pos.set(shore.x,shore.y,shore.z);game.disciples.assign(x,'fisher');
  const fishBefore=v.store.food;game.advance(0.1);const fishTask=x.task.type;game.advance(50);const fisherFood=v.store.food-fishBefore;
  for(const a of v.villagers)a.held=false;
  return {hungryTask,fedHunger,farmerFood,protectedRole,fishTask,fisherFood,shore};
});
if(workChecks.hungryTask!=='eat'||workChecks.fedHunger>0.62||workChecks.farmerFood<=0||workChecks.protectedRole!=='work'||workChecks.fishTask!=='fish'||workChecks.fisherFood<=0)throw Error('work checks failed '+JSON.stringify(workChecks));
await p.evaluate(()=>{const style=document.createElement('style');style.textContent='body > *:not(#app), #app > *:not(canvas) { visibility: hidden !important; }';document.head.append(style);game.hand.update=()=>{game.hand.model.root.visible=false;};game.villages[0].projectSite && (game.villages[0].projectSite.object.visible=false);game.shrines.setStage(0,'totem',false);});
for(const job of ['forester','builder','farmer','fisher','worshipper']){
  await p.evaluate(({job,shore})=>{
    const v=game.villages[0],x=v.villagers[0];
    game.dayTime=0.3;x.hunger=0;x.carry(null,0);
    x.pos.copy(v.center);x.pos.x+=12;
    if(job==='fisher') x.pos.set(shore.x,shore.y,shore.z);
    if(job==='worshipper'){x.pos.copy(v.worship.pos);x.pos.z+=10;}
    x.pos.y=game.terrain.heightAt(x.pos.x,x.pos.z);
    game.disciples.assign(x,job);
    x.task={type:'idle',t:99999};
    game.advance(0.05);
    if(job==='worshipper'){x.task={type:'worship',dancing:true};x.pose('dance');}
    x.object.position.copy(x.pos);x.object.rotation.set(0,0,0);
    game.fx.update(2);
    game.godCam.setPose({x:x.pos.x,z:x.pos.z,distance:16,pitch:0.45,yaw:0},true,game.terrain);
  },{job,shore:workChecks.shore});
  await p.waitForTimeout(600);
  await p.screenshot({path:process.env.OUT_DIR+'/'+job+'.png'});
}
const persistence=await p.evaluate(()=>{const x=game.villages[0].villagers[0];game.disciples.assign(x,'fisher');game.saves.save();return {seed:x.seed,job:x.disciple};});
await p.reload();await p.waitForFunction(()=>window.game);
const restored=await p.evaluate(seed=>game.villages[0].villagers.find(v=>v.seed===seed).disciple,persistence.seed);
if(restored!==persistence.job)throw Error('job failed to restore');
await p.evaluate(()=>{game.saves.suppress=true;const d=JSON.parse(localStorage.getItem('godgame.save.v1'));d.villagers=d.villagers.map(r=>r.slice(0,10));localStorage.setItem('godgame.save.v1',JSON.stringify(d));});
await p.reload();await p.waitForFunction(()=>window.game);
const legacy=await p.evaluate(()=>({loaded:!!game.saves.loaded,allClear:game.villages.every(v=>v.villagers.every(x=>x.disciple===null))}));
if(!legacy.loaded||!legacy.allClear)throw Error('old save failed');
await writeFile(process.env.OUT_DIR+'/results.json',JSON.stringify({forester,builderBefore,builder,checks,workChecks,persistence,restored,legacy,errors},null,2));
if(errors.length)throw Error('console errors '+errors.join('\n'));
await browser.close();
