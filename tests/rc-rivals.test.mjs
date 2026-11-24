import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CARS,ITEMS,config,validStats,preTune,transferCost,newRecord,award,nextLap,tune,claimBox,pickItem,draftEligible,mode} from '../site/rc-rivals.js';
import {advanceDrive} from '../site/rc-driving.js';
test('all 125 chassis/tuning combinations retain 14 and chassis limits',()=>{
 for(const id of Object.keys(CARS))for(let gear=-2;gear<=2;gear++)for(let susp=-2;susp<=2;susp++){const s=preTune(id,gear,susp);assert.ok(validStats(id,s));}
 assert.equal(config({chassis:'bad',colour:'bad',stats:[5,5,5,5]}).chassis,'apex');assert.equal(mode('bad'),'arcade');
 assert.equal(validStats('velocity',[2,5,5,2]),false);assert.equal(validStats('apex',[4.1,3.9,3,3]),false);
});
test('shared mystery box cooldown and one held item per player',()=>{
 const boxes=Array(12).fill(0),a=newRecord(),b=newRecord();assert.equal(claimBox(boxes,a,0,1000,0,true,()=>0),'turbo');
 assert.equal(claimBox(boxes,b,0,1001,100,true,()=>0),null);assert.equal(claimBox(boxes,a,1,1002,0,true,()=>0),null);
 assert.equal(claimBox(boxes,b,0,10999,100,true,()=>0),null);assert.equal(claimBox(boxes,b,0,11000,100,true,()=>0),'turbo');
});
test('equal multiplayer item distribution regardless of gap; equal solo self-use items',()=>{
 for(const gap of [0,50,150]){const counts={};for(let i=0;i<600;i++){const item=pickItem(gap,true,()=> (i+.5)/600);counts[item]=(counts[item]||0)+1;}assert.equal(Object.keys(counts).length,6);for(const id of Object.keys(ITEMS))assert.equal(counts[id],100);}
 const counts={};for(let i=0;i<300;i++){const id=pickItem(0,false,()=> (i+.5)/300);counts[id]=(counts[id]||0)+1;}assert.deepEqual(counts,{turbo:100,grip:100,recharge:100});
});
test('skill cap, combat cap, duplicate events and round reset',()=>{
 const r=newRecord();assert.ok(award(r,'hit','combat'));assert.equal(award(r,'shield','combat'),false);assert.equal(award(r,'hit'),false);assert.ok(award(r,'clean'));assert.ok(award(r,'corner'));assert.equal(r.rep,1);assert.equal(award(r,'extra'),false);nextLap(r,1);assert.ok(award(r,'clean'));assert.equal(r.rep,1);assert.equal(newRecord().rep,0);
});
test('pit cost, valid total, fractional transfers, caps and one visit per lap',()=>{
 const r=newRecord();r.rep=2;const setup=[5,3.5,3,2.5];assert.equal(transferCost(r.setup.stats,setup),1.5);
 assert.equal(tune(r,[5,5,5,5],0,100),false);assert.ok(tune(r,setup,0,100));assert.equal(r.rep,.5);assert.equal(r.serviceUntil,2100);
 assert.equal(tune(r,[4.5,4,3,2.5],0,2200),false);nextLap(r,1);assert.equal(tune(r,[4.5,4,3,2.5],1,1500),false);assert.ok(tune(r,[4.5,4,3,2.5],1,2200));assert.equal(r.rep,0);
});
test('fractional earned balance never exceeds 3 REP',()=>{const r=newRecord();r.rep=2.5;for(const key of ['a','b','c'])award(r,key);assert.equal(r.rep,3);assert.equal(award(r,'d'),false);});
test('slipstream requires following a nearby aligned moving car',()=>{const car={x:0,z:0,heading:0,speed:50},other={x:0,z:-40,heading:0,speed:48};assert.ok(draftEligible(car,other));assert.equal(draftEligible(car,{...other,z:40}),false);assert.equal(draftEligible(car,{...other,heading:Math.PI}),false);assert.equal(draftEligible(car,{...other,z:-120}),false);});
function run(chassis,options={},duration=10,start=0,keys={up:true}){const c={x:0,z:0,heading:0,speed:start,steer:0,fuel:1};for(let t=0;t<duration;t+=.01)advanceDrive(c,{up:false,down:false,left:false,right:false,brake:false,...keys},.01,{stats:CARS[chassis].stats,...options});return c;}
test('chassis statistics affect real acceleration, speed, braking and handling',()=>{assert.ok(run('velocity').speed>run('apex').speed);assert.ok(run('volt',{},1).speed>run('sentinel',{},1).speed);assert.ok(run('sentinel',{},.4,60,{brake:true}).speed<run('velocity',{},.4,60,{brake:true}).speed);assert.ok(run('switchback',{},2,45,{up:true,right:true}).heading>run('velocity',{},2,45,{up:true,right:true}).heading);});
test('boost, draft and slow effects affect actual speed with no stacking',()=>{assert.ok(run('apex',{drafting:true}).speed>run('apex').speed);assert.ok(run('apex',{turbo:true}).speed>run('apex',{drafting:true}).speed);assert.equal(run('apex',{turbo:true,drafting:true,boosting:true}).speed,run('apex',{turbo:true}).speed);assert.ok(run('apex',{slowed:true}).speed<run('apex').speed);assert.equal(run('apex',{pitLane:true,turbo:true}).speed,35);});
