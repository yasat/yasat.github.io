/* Mathematical test doubles for the road mesh; no browser or Three.js required.
 * These tests exercise the actual ribbon/kerb functions, not the GPU renderer. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {coastalNodes,coastalPits,coastalTunnels,minimapProjection} from '../site/rc-circuits.js';
const source=fs.readFileSync(new URL('../site/rc-race.js',import.meta.url),'utf8');
class V {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  clone(){return new V(this.x,this.y,this.z);}
  addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;}
  sub(v){return this.addScaledVector(v,-1);}
  normalize(){let n=Math.hypot(this.x,this.y,this.z)||1;return this.multiplyScalar(1/n);}
  multiplyScalar(n){this.x*=n;this.y*=n;this.z*=n;return this;}
  distanceToSquared(v){return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2;}
  lerp(v,t){return this.addScaledVector(v.clone().sub(this),t);}
  dot(v){return this.x*v.x+this.y*v.y+this.z*v.z;}
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function curve(point,closed=false){
  const samples=Array.from({length:1001},(_,i)=>point(i/1000)),lengths=[0];
  for(let i=1;i<samples.length;i++)lengths.push(lengths[i-1]+Math.sqrt(samples[i].distanceToSquared(samples[i-1])));
  function at(u){const d=clamp(u,0,1)*lengths.at(-1);let lo=0,hi=1000;while(hi-lo>1){const m=(lo+hi)>>1;if(lengths[m]<=d)lo=m;else hi=m;}return point((lo+(d-lengths[lo])/(lengths[hi]-lengths[lo]||1))/1000);}
  function tangent(u){const a=closed?(u-1e-5+1)%1:Math.max(0,u-1e-5),b=closed?(u+1e-5)%1:Math.min(1,u+1e-5);return at(b).sub(at(a)).normalize();}
  return {getPointAt:at,getTangentAt:tangent};
}
const nodes=JSON.parse(source.match(/const trackNodes = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/g,']')).map(([x,z])=>new V(x*1.8,0,z*1.8));
const makeTrack=nodes=>curve(t=>{const n=nodes.length,f=t*n,i=Math.floor(f),u=f-i,at=j=>nodes[(j+n)%n],a=at(i),b=at(i+1),m0=at(i+1).clone().sub(at(i-1)).multiplyScalar(.38),m1=at(i+2).clone().sub(at(i)).multiplyScalar(.38);return a.clone().multiplyScalar(2*u**3-3*u*u+1).addScaledVector(m0,u**3-2*u*u+u).addScaledVector(b,-2*u**3+3*u*u).addScaledVector(m1,u**3-u*u);},true);
const track=makeTrack(nodes),defaultTrack=track;
const points=Array.from({length:841},(_,i)=>track.getPointAt(i/840)),tangents=Array.from({length:841},(_,i)=>track.getTangentAt(i/840));
class Geo{attributes={};setAttribute(k,v){this.attributes[k]=v;}setIndex(v){this.indices=v;}computeVertexNormals(){}}
class Attr{constructor(a,n){this.array=new Float32Array(a);this.itemSize=n;}}
class Mesh{constructor(g,m){this.geometry=g;this.material=m;}}
const THREE={Vector3:V,BufferGeometry:Geo,Float32BufferAttribute:Attr,Mesh,MeshStandardMaterial:class{constructor(o){Object.assign(this,o);}},Color:class{constructor(c){this.r=(c>>16&255)/255;this.g=(c>>8&255)/255;this.b=(c&255)/255;}}};
const shared=source.slice(source.indexOf('const ribbonNormals ='),source.indexOf('function addRibbon('));
const kerb=source.slice(source.indexOf('function addKerb('),source.indexOf('function addTyreMarks('));
function pitPaths(count,track=defaultTrack,centres=null){return Array.from({length:count},(_,i)=>{const t=centres?centres[i]:(i+.5)/count,span=centres ? .045 : Math.min(.067,.80/count),a=track.getPointAt(t-span/2),b=track.getPointAt(t+span/2),ta=track.getTangentAt(t-span/2),tb=track.getTangentAt(t+span/2),mid=track.getPointAt(t),tm=track.getTangentAt(t),n=new V(tm.z,0,-tm.x);n.multiplyScalar(mid.dot(n)>=0?1:-1);const c1=a.clone().addScaledVector(ta,112).addScaledVector(n,175),c2=b.clone().addScaledVector(tb,-112).addScaledVector(n,175);const c=curve(u=>a.clone().multiplyScalar((1-u)**3).addScaledVector(c1,3*(1-u)**2*u).addScaledVector(c2,3*(1-u)*u*u).addScaledVector(b,u**3));return {points:Array.from({length:121},(_,j)=>c.getPointAt(j/120))};});}
function env(count,pts=points,tans=tangents,paths=pitPaths(count)){const objects=[],ctx=vm.createContext({THREE,clamp,trackPoints:pts,trackTangents:tans,ROAD_HALF:23,PIT_HALF:12,stationData:paths,worldObjects:{add:m=>objects.push(m)}});vm.runInContext(shared+'\n'+kerb,ctx);return {ctx,objects};}
function checkJoins(mesh,n,closed){const p=mesh.geometry.attributes.position.array,uv=mesh.geometry.attributes.uv.array;assert.equal(p.length,n*12);for(let i=0;i<n-(closed?0:1);i++){const j=(i+1)%n;for(const [a,b] of [[i*4+2,j*4+1],[i*4+3,j*4]]){assert.deepEqual([...p.slice(a*3,a*3+3)],[...p.slice(b*3,b*3+3)]);assert.deepEqual([...uv.slice(a*2,a*2+2)],[...uv.slice(b*2,b*2+2)]);}}assert.ok(p.every(Number.isFinite));}
for(const count of [1,11])test(`${count}-pit circuit: continuous asphalt UVs and raised merge-safe kerbs`,()=>{
  const {ctx,objects}=env(count);const main=vm.runInContext('createRibbon(trackPoints,-23,23,.07,0x7c8283)',ctx);checkJoins(main,840,true);
  for(const pit of ctx.stationData){ctx.pit=pit;const mesh=vm.runInContext('createRibbon(pit.points,-12,12,.045,0x7c8283)',ctx);checkJoins(mesh,120,false);}
  vm.runInContext('addKerb(-1,p=>clearOfPits(p,1));addKerb(1,p=>clearOfPits(p,1));',ctx);
  for(const mesh of objects){const p=mesh.geometry.attributes.position.array;assert.ok(p.length>0);let high=0;for(let i=0;i<p.length;i+=3){high=Math.max(high,p[i+1]);ctx.q=new V(p[i],0,p[i+2]);assert.ok(vm.runInContext('clearOfPits(q,.98)',ctx));}assert.ok(Math.abs(high-.34)<1e-5);}
});

test('coastal circuit: continuous main/pit ribbons, clear engineering boxes and safe kerbs',()=>{
 const t=makeTrack(coastalNodes.map(([x,z])=>new V(x*1.8,0,z*1.8))),n=1440,pts=Array.from({length:n+1},(_,i)=>t.getPointAt(i/n)),tans=Array.from({length:n+1},(_,i)=>t.getTangentAt(i/n));
 const paths=pitPaths(2,t,coastalPits),{ctx,objects}=env(2,pts,tans,paths);
 checkJoins(vm.runInContext('createRibbon(trackPoints,-23,23,.07,0x7c8283)',ctx),n,true);
 for(const pit of paths){ctx.pit=pit;checkJoins(vm.runInContext('createRibbon(pit.points,-12,12,.045,0x7c8283)',ctx),120,false);
  for(const q of pit.points.slice(53,68)){ctx.q=q;assert.ok(vm.runInContext('clearOfMain(q,20)',ctx));}
 }
 vm.runInContext('addKerb(-1,p=>clearOfPits(p,1));addKerb(1,p=>clearOfPits(p,1));',ctx);
 for(const mesh of objects){const p=mesh.geometry.attributes.position.array;for(let i=0;i<p.length;i+=3){ctx.q=new V(p[i],0,p[i+2]);assert.ok(vm.runInContext('clearOfPits(q,.98)',ctx));}}
 for(const [from,to] of coastalTunnels){for(let i=Math.ceil(from*n);i<=Math.floor(to*n);i++){ctx.q=pts[i];assert.ok(vm.runInContext('clearOfPits(q,45)',ctx));}}
 const at=minimapProjection([...pts,...paths.flatMap(p=>p.points)],260,182);for(const p of [...pts,...paths.flatMap(p=>p.points)]){const [x,y]=at(p);assert.ok(x>=11.99&&x<=248.01&&y>=11.99&&y<=170.01);}
 assert.ok(pts.every(p=>Math.abs(p.x)<1700&&Math.abs(p.z)<1300));
 for(let i=0;i<n;i++){const a=pts[(i+n-1)%n],b=pts[i],c=pts[(i+1)%n],x=b.x-a.x,z=b.z-a.z,xx=c.x-b.x,zz=c.z-b.z,cross=Math.abs(x*zz-z*xx);if(cross>1e-9){const radius=Math.hypot(x,z)*Math.hypot(xx,zz)*Math.hypot(x+xx,z+zz)/(2*cross);assert.ok(radius>42,`Runoff too wide at sample ${i}: ${radius}`);}}
});

test('long countryside mountain tunnel has an open bore and stays clear of pit lanes',async()=>{
 const {tunnelInterior,mountainProfile}=await import('../site/rc-circuits.js');
 const t=makeTrack(coastalNodes.map(([x,z])=>new V(x*1.8,0,z*1.8))),n=1440,pts=Array.from({length:n+1},(_,i)=>t.getPointAt(i/n)),tans=Array.from({length:n+1},(_,i)=>t.getTangentAt(i/n));
 const paths=pitPaths(2,t,coastalPits),{ctx}=env(2,pts,tans,paths),[a,b]=coastalTunnels[0];
 assert.equal(coastalTunnels.length,1);assert.ok(a>.78&&b-a>.08);assert.ok(tunnelInterior[0][0]<-23&&tunnelInterior.at(-1)[0]>23&&tunnelInterior[4][1]>40);
 for(let i=Math.ceil(a*n);i<=Math.floor(b*n);i++){
  const p=pts[i],t=tans[i],normal=new V(t.z,0,-t.x),profile=mountainProfile((i/n-a)/(b-a));
  for(const [off,y] of profile){assert.ok(Number.isFinite(y));ctx.q=p.clone().addScaledVector(normal,off);assert.ok(vm.runInContext('clearOfPits(q,4)',ctx));}
  for(const off of [-78,78]){const q=p.clone().addScaledVector(normal,off);for(let j=0;j<n;j+=3){const delta=Math.min(Math.abs(j-i),n-Math.abs(j-i));if(delta>45)assert.ok(q.distanceToSquared(pts[j])>27**2,`mountain overlaps another part of track at ${i},${j}`);}}
 }
});
