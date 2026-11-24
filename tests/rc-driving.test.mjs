import { test } from 'node:test';
import assert from 'node:assert/strict';
import {advanceDrive,resetDrive} from '../site/rc-driving.js';
const car=(speed=0)=>({x:0,z:0,heading:0,speed,steer:0,fuel:1});
const controls=(overrides={})=>({up:false,down:false,left:false,right:false,brake:false,boost:false,...overrides});
function run(c,keys,seconds,dt=.01,options={}){
  for(let time=0;time<seconds-1e-9;time+=dt)advanceDrive(c,keys,Math.min(dt,seconds-time),options);
  return c;
}
test('accelerate forward to normal speed cap, without sideways motion',()=>{
  const c=run(car(),controls({up:true}),8);assert.equal(c.speed,69);assert.ok(c.z< -250);assert.equal(c.x,0);
});
test('boost, pit, and runoff have distinct speed limits',()=>{
  assert.ok(run(car(),controls({up:true}),8,.01,{boosting:true}).speed>90);
  assert.equal(run(car(),controls({up:true}),8,.01,{pitLane:true}).speed,35);
  assert.equal(run(car(),controls({up:true}),8,.01,{offRoad:true}).speed,29);
});
test('braking from forward and reverse stops without changing direction',()=>{
  for(const v of [69,-19]){const c=run(car(v),controls({up:true,brake:true}),2);assert.equal(c.speed,0);assert.equal(c.heading,0);}
});
test('reverse is bounded and switches direction only after braking',()=>{
  const c=run(car(30),controls({down:true}),.25);assert.ok(c.speed>0);
  run(c,controls({down:true}),5);assert.equal(c.speed,-19);
});
test('stationary steering cannot spin or translate a car',()=>{
  const c=run(car(),controls({right:true}),3);assert.equal(c.heading,0);assert.equal(c.z,0);assert.equal(c.x,0);
});
test('left and right turns mirror, slip is bounded, steering settles',()=>{
  const l=run(car(),controls({up:true,left:true}),4),r=run(car(),controls({up:true,right:true}),4);
  assert.ok(r.heading>0&&l.heading<0);assert.ok(Math.abs(r.heading+l.heading)<1e-9);assert.ok(Math.abs(l.x+r.x)<1e-9);assert.ok(Math.abs(r.slip)<=.19);
  run(r,controls({up:true}),2);assert.ok(Math.abs(r.yawRate)<.001);assert.ok(Math.abs(r.slip)<.001);
});
test('substep sensitivity stays small across 30 and 60 FPS-equivalent steps',()=>{
  const a=run(car(),controls({up:true,right:true}),5,1/60),b=run(car(),controls({up:true,right:true}),5,1/120);
  assert.ok(Math.abs(a.speed-b.speed)<.2);assert.ok(Math.abs(a.heading-b.heading)<.015);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<2);
});
test('empty fuel does not accelerate; reset clears yaw and slip',()=>{
  const c={...car(),fuel:0,slip:.1,yawRate:.4};resetDrive(c);assert.equal(c.slip,0);assert.equal(c.yawRate,0);run(c,controls({up:true}),5);assert.equal(c.speed,0);
});

test('handbrake initiates a real slide, mirrors left and right and recovers on release',()=>{
 const l=run(car(60),controls({up:true,left:true,drift:true}),1),r=run(car(60),controls({up:true,right:true,drift:true}),1);
 const regular=run(car(60),controls({up:true,right:true}),1);
 assert.ok(r.drifting&&Math.abs(r.slip)>.25&&Math.abs(r.slip)>Math.abs(regular.slip));assert.ok(r.heading>regular.heading);assert.ok(Math.abs(l.slip+r.slip)<1e-9);assert.ok(Math.abs(l.heading+r.heading)<1e-9);assert.ok(r.speed<regular.speed);
 run(r,controls({up:true}),2);assert.equal(r.drifting,false);assert.ok(Math.abs(r.slip)<.01);
});
test('current handling rating controls drift speed retention, slide and recovery',()=>{
 const low={stats:[4,4,2,4]},high={stats:[3,3,5,3]};const k=controls({up:true,right:true,drift:true});
 const l=run(car(60),k,1,.01,low),h=run(car(60),k,1,.01,high);
 assert.ok(h.speed>l.speed);assert.ok(h.heading>l.heading);assert.ok(Math.abs(l.slip)>Math.abs(h.slip));
 run(l,controls({up:true}),.5,.01,low);run(h,controls({up:true}),.5,.01,high);
 assert.ok(Math.abs(h.slip)<Math.abs(l.slip));assert.ok(h.driftAmount<l.driftAmount);
});
test('handbrake stops straight-line driving and does not drift in pits, reverse or at rest',()=>{
 for(const [v,o,k] of [[60,{},{}],[30,{pitLane:true},{right:true}],[30,{offRoad:true},{right:true}],[-19,{}, {right:true}],[0,{}, {right:true}]]){
  const c=run(car(v),controls({up:true,drift:true,...k}),2,.01,o);assert.equal(c.speed,0);assert.equal(c.drifting,false);
 }
});
