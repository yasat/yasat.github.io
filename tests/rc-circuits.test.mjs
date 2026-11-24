import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CIRCUITS,circuitId,minimapProjection} from '../site/rc-circuits.js';
import {RaceAudio} from '../site/rc-audio.js';
test('map ids validated and pit counts distinct',()=>{assert.equal(circuitId('coastal'),'coastal');assert.equal(circuitId('bad'),'stadium');assert.equal(CIRCUITS.coastal.pitCount,2);assert.equal(CIRCUITS.stadium.pitCount,1);});
test('minimap uses +X right and +Z down; heading agrees with the road',()=>{const at=minimapProjection([{x:-100,z:-100},{x:100,z:100}],260,182);const [x,y]=at({x:0,z:0});for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const [a,b]=at({x:Math.sin(angle)*20,z:-Math.cos(angle)*20});assert.ok(Math.abs((a-x)/15.8-Math.sin(angle))<1e-9);assert.ok(Math.abs((b-y)/15.8+Math.cos(angle))<1e-9);}});
test('audio modes cycle and unsupported audio remains nonfatal',()=>{globalThis.window={};const a=new RaceAudio();assert.equal(a.mode,'all');assert.equal(a.cycle(),'engine');assert.equal(a.cycle(),'off');assert.equal(a.cycle(),'all');a.update({running:true,speed:40});a.cue('go');});
test('procedural audio graph responds to throttle/brake and mutes music independently',()=>{
 class Param{constructor(){this.value=0;}setTargetAtTime(v){this.value=v;}setValueAtTime(v){this.value=v;}linearRampToValueAtTime(v){this.value=v;}exponentialRampToValueAtTime(v){this.value=v;}}
 class Node{constructor(){for(const k of ['gain','frequency','Q'])this[k]=new Param();}connect(n){return n;}start(){}stop(){}disconnect(){}}
 class AudioContext{constructor(){this.sampleRate=8000;this.currentTime=0;this.state='running';this.destination=new Node();}createGain(){return new Node();}createOscillator(){return new Node();}createBiquadFilter(){return new Node();}createBuffer(n,len){return {getChannelData:()=>new Float32Array(len)};}createBufferSource(){return new Node();}}
 globalThis.window={AudioContext};const a=new RaceAudio();a.unlock();a.update({running:true,speed:0});const idle=a.motor.frequency.value;a.update({running:true,speed:60,throttle:true,brake:true});assert.ok(a.motor.frequency.value>idle);assert.ok(a.brakeGain.gain.value>0);assert.ok(a.musicGain.gain.value>0);a.cycle();a.update({running:true,speed:60});assert.equal(a.musicGain.gain.value,0);assert.ok(a.engineGain.gain.value>0);a.cycle();a.update({running:true,speed:60});assert.equal(a.engineGain.gain.value,0);assert.equal(a.brakeGain.gain.value,0);delete globalThis.window;
});

test('local audio files unlock, respond to driving, and mute independently',async()=>{
 class Media{constructor(src){this.src=src;this.paused=true;this.volume=0;}play(){this.paused=false;return Promise.resolve();}}
 globalThis.window={Audio:Media};const a=new RaceAudio();assert.equal(a.status,'blocked');a.unlock();await new Promise(resolve=>setImmediate(resolve));assert.equal(a.status,'playing');assert.equal(a.files.length,3);a.update({running:true,speed:60,throttle:true,brake:true});assert.ok(a.files[0].volume>0);for(let i=0;i<30;i++)a.update({running:true,speed:60,throttle:true,brake:true});assert.ok(a.files[0].playbackRate>1);assert.ok(a.files[1].volume>0);assert.ok(a.files[2].volume>0);a.cycle();for(let i=0;i<30;i++)a.update({running:true,speed:60});assert.ok(a.files[2].volume<.0001);a.cycle();assert.ok(a.files.every(f=>f.volume===0));delete globalThis.window;
});
test('rejected local audio playback reports enable state instead of false on',async()=>{
 class Media{constructor(){this.paused=true;}play(){return Promise.reject(new Error('gesture needed'));}}
 globalThis.window={Audio:Media};const a=new RaceAudio();a.unlock();await new Promise(resolve=>setImmediate(resolve));assert.equal(a.status,'blocked');delete globalThis.window;
});

test('a pending tyre file cannot suppress a working motor or music',async()=>{
 class Media{constructor(src){this.src=src;this.paused=true;this.volume=0;this.readyState=4;}play(){if(this.src.includes('tyre-loop'))return new Promise(()=>{});this.paused=false;return Promise.resolve();}}
 globalThis.window={Audio:Media};const a=new RaceAudio();a.unlock();await new Promise(resolve=>setImmediate(resolve));assert.equal(a.status,'playing');a.update({running:true,speed:40,throttle:true});assert.ok(a.files[0].volume>.1);assert.ok(a.files[2].volume>0);assert.equal(a.isPlaying(1),false);delete globalThis.window;
});
test('enable sound recovers from a blocked attempt without preview playback',async()=>{
 let allowed=false;class Media{constructor(src){this.src=src;this.paused=true;this.volume=0;}play(){if(!allowed)return Promise.reject(new Error('blocked'));this.paused=false;return Promise.resolve();}}
 globalThis.window={Audio:Media};const a=new RaceAudio();a.unlock();await new Promise(resolve=>setImmediate(resolve));assert.equal(a.status,'blocked');allowed=true;a.unlock();await new Promise(resolve=>setImmediate(resolve));assert.equal(a.status,'playing');a.update({running:false});assert.equal(a.files[0].volume,0);a.update({running:true,speed:40});assert.ok(a.files[0].volume>0);a.setMode('off');assert.ok(a.files.every(f=>f.volume===0));delete globalThis.window;
});
test('decoded loops use continuous buffer sources, smoothed rate, independent gains and no media restart',async()=>{
 class Param{constructor(){this.value=0;}setTargetAtTime(v){this.value=v;}setValueAtTime(v){this.value=v;}linearRampToValueAtTime(v){this.value=v;}exponentialRampToValueAtTime(v){this.value=v;}}
 class Node{constructor(){for(const k of ['gain','frequency','Q','playbackRate'])this[k]=new Param();this.starts=0;}connect(n){return n;}start(){this.starts++;}stop(){}disconnect(){}}
 class AudioContext{constructor(){this.sampleRate=8000;this.currentTime=0;this.state='running';this.destination=new Node();}createGain(){return new Node();}createOscillator(){return new Node();}createBiquadFilter(){return new Node();}createBuffer(n,len){return {getChannelData:()=>new Float32Array(len)};}createBufferSource(){return new Node();}decodeAudioData(){return Promise.resolve({duration:2});}}
 const prev=globalThis.fetch;globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});globalThis.window={AudioContext,Audio:class{constructor(){throw Error('media not needed');}}};
 try{const a=new RaceAudio();a.unlock();await new Promise(resolve=>setImmediate(resolve));assert.equal(a.buffers.filter(Boolean).length,3);for(const b of a.buffers){assert.equal(b.source.loop,true);assert.equal(b.source.loopEnd,2);assert.equal(b.source.starts,1);}a.update({running:true,speed:0});const idle=a.buffers[0].source.playbackRate.value;for(let i=0;i<60;i++)a.update({running:true,speed:60,throttle:true,drifting:true});assert.ok(a.buffers[0].source.playbackRate.value>idle);assert.ok(a.buffers[1].gain.gain.value>0);assert.equal(a.engineGain.gain.value,0);a.cycle();a.update({running:true});assert.equal(a.buffers[2].gain.gain.value,0);a.cycle();assert.ok(a.buffers.every(b=>b.gain.gain.value===0));a.unlock();assert.ok(a.buffers.every(b=>b.source.starts===1));}finally{globalThis.fetch=prev;delete globalThis.window;}
});
