/* RC Grand Prix — standalone Three.js / PeerJS game, deployable on GitHub Pages. */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { CompatibilityTrackRenderer } from './rc-compatibility.js?v=13';
import { CIRCUITS, coastalNodes, coastalPits, coastalTunnels, tunnelInterior, mountainProfile, circuitId, minimapProjection } from './rc-circuits.js?v=2';
import { RaceAudio } from './rc-audio.js?v=4';
import { advanceDrive, resetDrive } from './rc-driving.js?v=3';
import {ATTRIBUTES,CARS,PAINTS,MODES,ITEMS,config,mode,validStats,transferCost,newRecord,award,nextLap,tune,claimBox,draftEligible} from './rc-rivals.js?v=2';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const TWO_PI = Math.PI * 2;
const ROAD_HALF = 23;
const PIT_HALF = 12;
const PINE_GREEN = 0x244d42;
const CAR_COLOURS = [0xdbf169, 0xff8871, 0x64cce2, 0xf4bf73, 0xc4a4fb, 0xf5e3c2, 0x84f3ae, 0xf9a8d3];
const LOGO_FONT = '900 68px Arial, sans-serif';
const viewport = $('raceCanvas');
let renderer, scene, camera, sun, course, asphaltMesh, worldObjects, sceneReady = false;
let compatibilityRenderer = null;
let compatibilityActive = false;
let rendererCheckCount = 0;
let rendererBlankCount = 0;
let lastRendererCheck = 0;
let lastCompatibilityFrame = 0;
let sceneryTrees = [];
let roadTextures = {}, skyDome, detailObjects = [], lastDetailUpdate = 0;
let cameraHeading = null;
const QUALITY = {
  low: {pixelRatio:.8, shadows:0, detailDistance:190, people:false, anisotropy:2},
  medium: {pixelRatio:1.25, shadows:1024, detailDistance:430, people:true, anisotropy:4},
  high: {pixelRatio:1.8, shadows:2048, detailDistance:720, people:true, anisotropy:8}
};
let quality = 'medium';
try { const saved=localStorage.getItem('rc-graphics-quality'); if(Object.hasOwn(QUALITY,saved)) quality=saved; } catch {}
const requestedQuality=new URLSearchParams(location.search).get('quality');
if(Object.hasOwn(QUALITY,requestedQuality))quality=requestedQuality;
function detail(mesh,distance=1,people=false){detailObjects.push({mesh,distance,people,position:new THREE.Vector3()});return mesh;}
function applyQuality(){
  const q=QUALITY[quality];
  const btn=$('qualityButton'); if(btn){btn.textContent=`GRAPHICS: ${quality.toUpperCase()}`;btn.title='Cycle low, medium and high graphics quality';}
  if(!renderer)return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,q.pixelRatio));
  renderer.shadowMap.enabled=Boolean(q.shadows);
  if(sun){sun.castShadow=Boolean(q.shadows);if(q.shadows&&sun.shadow.mapSize.x!==q.shadows){sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.mapSize.set(q.shadows,q.shadows);}sun.shadow.needsUpdate=true;}
  for(const t of Object.values(roadTextures)){t.anisotropy=Math.min(q.anisotropy,renderer.capabilities.getMaxAnisotropy());t.needsUpdate=true;}
  resizeRenderer();lastDetailUpdate=-Infinity;
}
function updateWorldDetail(now){
  if(skyDome)skyDome.position.copy(camera.position);
  if(compatibilityActive)return;
  if(now-lastDetailUpdate<220)return;
  lastDetailUpdate=now;
  const q=QUALITY[quality];
  for(const d of detailObjects){d.mesh.getWorldPosition(d.position);d.mesh.visible=(!d.people||q.people)&&d.position.distanceToSquared(camera.position)<(q.detailDistance*d.distance)**2;}
  // A local, texel-stabilised shadow region follows the car, rather than
  // spreading a small shadow map over the entire kilometre-scale stadium.
  if(sun&&q.shadows){const x=Math.round(player.x/8)*8,z=Math.round(player.z/8)*8;sun.target.position.set(x,0,z);sun.position.set(x-160,300,z+210);}
}

const compatibilityForced = new URLSearchParams(location.search).get('renderer') === 'compat';
const stadiumDecor = { barriers: [], grandstands: [], trees: [] };
let worldVersion = 0;
let stationData = [];
let raceMode = 'tour';
let gameRunning = false;
let raceStarted = false;
let raceEnded = false;
let cameraMode = 0;
let inspector = null;
let latestClosestBoard = null;
let countdownEnd = 0;
let showBannerUntil = 0;
let currentBanner = '';
let elapsed = 0;
let lastTick = performance.now();
let hudClock = 0;
let networkClock = 0;
let texturesClock = 0;
let minimapClock = 0;
let lastModeChange = 0;
let lastFrameDt = 0;
let localFinishTime = null;
let raceSettings = { laps: 3, rules:'arcade', circuit:'stadium' };
let activeCircuit='stadium', hudHidden=false;
const audio=new RaceAudio();
let tunnelRoofs=[], coastalProps=[], tunnelLights=[], ambientSky, ambientFill;
function setHudHidden(hidden){hudHidden=Boolean(hidden);document.body.classList.toggle('race-hud-hidden',hudHidden);$('hudToggle').textContent=hudHidden?'SHOW HUD [H]':'HIDE HUD [H]';$('hudToggle').setAttribute('aria-pressed',String(hudHidden));resizeRenderer();}
function updateAudioButton(){const b=$('audioToggle'),status=audio.status;b.textContent=status==='off'?'SOUND: OFF':status==='playing'?'SOUND: '+(audio.mode==='all'?'ON':'ENGINE'):status==='loading'?'SOUND: LOADING':'ENABLE SOUND';b.setAttribute('aria-label',status==='blocked'?'Enable sound': 'Cycle sound: engine and music, engine only, off');b.title=audio.detail;}
function toggleAudio(){if(audio.mode==='off'){audio.setMode('all');audio.unlock();}else if(audio.status==='blocked'||audio.status==='loading')audio.unlock();else audio.cycle();updateAudioButton();}
let garageSetup=config(),localEngineering={stats:garageSetup.stats,rep:0,credits:0,earned:0,spent:0},pitDraft=null,pitPending=false;
let draftTime=0,draftUntil=0,draftCooldown=0,localEffects={};
const arcadeItems=()=>raceMode==='arcade'&&raceSettings.rules==='arcade';
const engineeringEnabled=()=>raceMode==='arcade'&&raceSettings.rules!=='pro';
let networkGeneration = 0;
let resume = window.RC_RESUME_SNAPSHOT || [];
const keys = { up: false, down: false, left: false, right: false, brake: false, drift: false, boost: false };
const touchPointers = new Map();
const vectors = {
  tmp: new THREE.Vector3(), tmp2: new THREE.Vector3(), temp: new THREE.Vector3(),
  desiredCamera: new THREE.Vector3(), currentTarget: new THREE.Vector3(),
};
const TRACK_SCALE = 1.8;
const trackNodes = [
  [-385,-105],[-380,-255],[-220,-330],[-35,-320],[140,-255],[278,-305],
  [445,-230],[503,-80],[423,75],[458,204],[340,323],[155,320],
  [-15,202],[-198,295],[-389,241],[-480,98],[-452,-25],
];
let trackCurve = new THREE.CatmullRomCurve3(trackNodes.map(([x,z])=>new THREE.Vector3(x*TRACK_SCALE,0,z*TRACK_SCALE)),true,'catmullrom',0.38);
let TRACK_SAMPLES = 840;
let trackPoints = Array.from({length:TRACK_SAMPLES+1},(_,i)=>trackCurve.getPointAt(i/TRACK_SAMPLES));
let trackTangents = Array.from({length:TRACK_SAMPLES+1},(_,i)=>trackCurve.getTangentAt(i/TRACK_SAMPLES));
let trackLength = trackCurve.getLength();
const stationColours = ['#a8e6bf','#f9b780','#c6b5ee','#f4d174','#8ad3e4','#ed99a3','#b6d79c','#edc6a9','#a2c9ff','#dfd3ab','#dbeca8'];
const INITIAL_POS = .025;
const PIT_SPAN = .067; // every lane runs for several hundred track metres
const PIT_BOARD_WIDTH = 36, PIT_BOARD_HEIGHT = 22;
const player = {x:0,z:0,heading:0,speed:0,fuel:1,boost:1,lap:0,travel:0,priorU:INITIAL_POS,u:INITIAL_POS,
  elapsed:0,lapAt:0,lastLap:0,fastest:Infinity,offRoad:false,inPit:false,pitVisit:null,boosting:false,
  mesh:null,colour:CAR_COLOURS[0],braking:false,finished:false,steer:0,steerAngle:0,rank:0};
const opponents = new Map();
const NETWORK_PROTOCOL = 14; // Garage & Rivals requires identical builds on all peers
let BOMB_PICKUPS = [.19,.43,.66,.90].flatMap((u,zone)=>[-15,0,15].map((offset,j)=>({index:zone*3+j,u,offset,pos:trackPosition(u,offset)})));
const BOMB_STUN_MS = 1100;
const BOMB_RANGE = 230;
const combat = {held:null,readyAt:Array(BOMB_PICKUPS.length).fill(0),pending:-1,requestAt:0,projectiles:[],oils:[],nextShot:0,shotIds:new Set(),localStunUntil:0,hostInventory:new Map(),pickupMeshes:[],lastStunAnnouncement:0};
const raceState = { role:'solo', peer:null,hostConn:null,connections:new Map(),remote:new Map(),roomCode:'',name:'Driver',hostId:'',joined:false,started:false,startTime:0,finishers:new Map(),pendingStart:null,round:0,roster:[],ready:new Set() };

function selectCircuit(value){
  const id=circuitId(value);if(id===activeCircuit)return false;
  activeCircuit=id;const nodes=id==='coastal'?coastalNodes:trackNodes;
  TRACK_SAMPLES=id==='coastal'?1440:840;
  trackCurve=new THREE.CatmullRomCurve3(nodes.map(([x,z])=>new THREE.Vector3(x*TRACK_SCALE,0,z*TRACK_SCALE)),true,'catmullrom',.38);
  if(id==='coastal'){trackCurve.arcLengthDivisions=TRACK_SAMPLES*3;trackCurve.updateArcLengths();}
  trackLength=trackCurve.getLength();trackPoints=Array.from({length:TRACK_SAMPLES+1},(_,i)=>trackCurve.getPointAt(i/TRACK_SAMPLES));trackTangents=Array.from({length:TRACK_SAMPLES+1},(_,i)=>trackCurve.getTangentAt(i/TRACK_SAMPLES));
  BOMB_PICKUPS=[.19,.43,.66,.90].flatMap((u,zone)=>[-15,0,15].map((offset,j)=>({index:zone*3+j,u,offset,pos:trackPosition(u,offset)})));
  combat.readyAt=Array(BOMB_PICKUPS.length).fill(0);return true;
}
async function loadResume() {
  try {
    const response = await fetch('index.html', {cache:'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const sections = [...doc.querySelectorAll('main section[id]')].filter(s=>s.querySelector('h2'));
    if (sections.length < 8) throw new Error('Missing resume sections');
    resume = sections.map(sec=>{
      const entries=[...sec.querySelectorAll('.resume-entry')];
      const items=entries.length?entries.map(entry=>({
        title:entry.querySelector('.entry-top h3')?.textContent.trim()||'Entry',
        date:entry.querySelector('.entry-date')?.textContent.trim()||'',
        meta:entry.querySelector('.entry-meta')?.textContent.trim()||'',
        status:entry.querySelector('.resume-status')?.textContent.trim()||'',
        paragraphs:[...entry.querySelectorAll('p')].map(p=>p.textContent.trim()),
        links:[...entry.querySelectorAll('a[href]')].map(a=>({label:a.textContent.trim(),url:a.getAttribute('href')}))
      })):[{title:sec.querySelector('h2').textContent.trim(),date:'',meta:'',status:'',
        paragraphs:[...sec.querySelectorAll('p')].map(p=>p.textContent.trim()),
        links:[...sec.querySelectorAll('a[href]')].map(a=>({label:a.textContent.trim(),url:a.getAttribute('href')}))}];
      return {id:sec.id,name:sec.querySelector('h2').textContent.trim(),lead:sec.querySelector('.section-lead')?.textContent.trim()||'',items};
    });
  } catch (err) { console.info('Using bundled resume snapshot:',err.message); }
  buildGuide();
}
function buildGuide() {
  $('guideStops').replaceChildren();
  for (let i=0;i<resume.length;i++) {
    const section=resume[i];
    const btn=document.createElement('button');btn.type='button';btn.className='guide-stop';
    const k=document.createElement('small');k.textContent=`PIT ${String(i+1).padStart(2,'0')} / ${section.items.length} BILLBOARD${section.items.length===1?'':'S'}`;
    const t=document.createElement('strong');t.textContent=section.name;
    const d=document.createElement('span');d.textContent=section.lead||'Explore the full details at this pit stop.';
    btn.append(k,t,d);btn.addEventListener('click',()=>{
      if(raceMode!=='tour')return;
      const station=stationData[i];if(!station)return;
      placeCarOnLane(station,.08);
      showGuide(false);
      announce(`PIT ${String(i+1).padStart(2,'0')}\n${section.name.toUpperCase()}`,2.6);
    });
    $('guideStops').append(btn);
  }
}
function showGuide(on) { $('raceGuide').hidden=!on; if(on)clearKeys(); }
function announce(message,seconds=2.3) {
  $('raceBanner').textContent=message;
  $('raceBanner').classList.add('visible');
  currentBanner=message;
  showBannerUntil=performance.now()+seconds*1000;
}
function reportError(message) { $('sceneErrorText').textContent=message;$('sceneError').hidden=false; }
function setCompatibility(active, explanation=''){
  compatibilityActive=Boolean(active);
  $('compatCanvas').hidden=!compatibilityActive;
  $('renderModeButton').textContent=compatibilityActive?'VIEW: COMPAT ✓':'VIEW: 3D';
  $('renderModeButton').title=compatibilityActive?'Show the native WebGL camera again':'Show the compatibility track camera';
  if(compatibilityActive&&explanation)console.warn('RC Grand Prix compatibility camera:',explanation);
}
function webglPictureLooksBlank(){
  if(!renderer||!sceneReady)return false;
  try{
    const gl=renderer.getContext();
    if(gl.isContextLost())return true;
    // Read points spread across the actual WebGL framebuffer, *not* the CSS HUD.
    // When Three is only painting the background, these are essentially identical.
    const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
    if(w<5||h<5)return false;
    const a=new Uint8Array(4),reference=new Uint8Array(4);
    gl.readPixels(Math.floor(w*.5),Math.floor(h*.5),1,1,gl.RGBA,gl.UNSIGNED_BYTE,reference);
    let biggestDifference=0;
    for(const [u,v] of [[.18,.18],[.42,.23],[.78,.17],[.18,.48],[.78,.52],[.31,.75],[.5,.68],[.79,.83],[.5,.9]]){
      gl.readPixels(Math.floor(w*u),Math.floor(h*v),1,1,gl.RGBA,gl.UNSIGNED_BYTE,a);
      for(let k=0;k<3;k++)biggestDifference=Math.max(biggestDifference,Math.abs(a[k]-reference[k]));
    }
    return biggestDifference<13;
  }catch(error){console.warn('Cannot inspect WebGL frame',error);return false;}
}


function trackPosition(u,offset=0) {
  const f=((u%1)+1)%1,center=trackCurve.getPointAt(f), tangent=trackCurve.getTangentAt(f);
  return center.add(new THREE.Vector3(tangent.z,0,-tangent.x).multiplyScalar(offset));
}
function getHeading(tan) { return Math.atan2(tan.x,-tan.z); }
// Labels are viewed by drivers approaching from *upstream*, looking along the road.
function facingOncoming(tan) { return Math.atan2(-tan.x,-tan.z); }
// Local X on a grandstand follows the track tangent; local -Z looks at the track.
function standYaw(tan,outwardSide) { return Math.atan2(-tan.z,tan.x)+(outwardSide>0?Math.PI:0); }
function signedAngle(a,b) { return Math.atan2(Math.sin(a-b),Math.cos(a-b)); }
function getTrackClosest(x,z) {
  let best=Infinity, posU=0, side=0, closestX=0, closestZ=0;
  const p=trackPoints;
  for (let i=0;i<TRACK_SAMPLES;i++) {
    const a=p[i], b=p[i+1], dx=b.x-a.x, dz=b.z-a.z, len2=dx*dx+dz*dz;
    const r=clamp(((x-a.x)*dx+(z-a.z)*dz)/len2,0,1),qx=a.x+dx*r,qz=a.z+dz*r;
    const d=(x-qx)**2+(z-qz)**2;
    if(d<best){best=d;posU=(i+r)/TRACK_SAMPLES;side=(x-qx)*dz-(z-qz)*dx;closestX=qx;closestZ=qz;}
  }
  return {dist:Math.sqrt(best),u:posU,side:Math.sign(side),x:closestX,z:closestZ};
}
function getPitClosest(x,z,pit){
  const pts=pit.points;
  let best=Infinity,posU=0,closestX=0,closestZ=0;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i],b=pts[i+1],dx=b.x-a.x,dz=b.z-a.z;
    const v=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
    const d=(x-a.x-dx*v)**2+(z-a.z-dz*v)**2;
    if(d<best){best=d;posU=(i+v)/(pts.length-1);closestX=a.x+dx*v;closestZ=a.z+dz*v;}
  }
  return {dist:Math.sqrt(best),u:posU,pit,x:closestX,z:closestZ};
}
function nearestPit(x,z){
  let closest={dist:Infinity,u:0,pit:null};
  for(const pit of stationData){const r=getPitClosest(x,z,pit);if(r.dist<closest.dist)closest=r;}
  return closest;
}
function computePitPosition(pit,q){return pit.curve.getPointAt(clamp(q,0,1));}
function setupPits(count) {
  stationData=[];
  for(let i=0;i<count;i++){
    // Within each sector, the lane diverts gently away from the main straight,
    // travels parallel to the circuit and rejoins; pit sectors do not overlap.
    const t=activeCircuit==='coastal'?coastalPits[i]:(i+.5)/count;
    const span=activeCircuit==='coastal'?.045:Math.min(PIT_SPAN, .80/count);
    const startT=(t-span/2+1)%1,endT=(t+span/2)%1;
    const a=trackCurve.getPointAt(startT),b=trackCurve.getPointAt(endT),mid=trackCurve.getPointAt(t);
    const ta=trackCurve.getTangentAt(startT),tb=trackCurve.getTangentAt(endT),tm=trackCurve.getTangentAt(t);
    const n=new THREE.Vector3(tm.z,0,-tm.x);
    const dot=n.x*mid.x+n.z*mid.z;
    n.multiplyScalar(dot>=0?1:-1);
    // In/out tangents stay near the main road; the centre is offset for an
    // actual long service lane rather than an impossibly sharp shortcut.
    const c1=a.clone().addScaledVector(ta,112).addScaledVector(n,175);
    const c2=b.clone().addScaledVector(tb,-112).addScaledVector(n,175);
    const curve=new THREE.CubicBezierCurve3(a,c1,c2,b);
    stationData.push({index:i,info:raceMode==='tour'?resume[i]:null,startT,endT,span,curve,
      points:Array.from({length:121},(_,j)=>curve.getPointAt(j/120)),n,
      boards:[],loaded:false,garage:null,refillAt:0});
  }
}
// Every neighbouring ribbon segment shares exactly the same cross-section.
// A different normal for each quad leaves triangular cracks on curved roads.
const ribbonNormals = new WeakMap();
function getRibbonNormals(points) {
  if(ribbonNormals.has(points))return ribbonNormals.get(points);
  const last=points.length-1,closed=points[0].distanceToSquared(points[last])<1e-8;
  const normals=points.map((p,i)=>{
    if(points===trackPoints)return new THREE.Vector3(trackTangents[i].z,0,-trackTangents[i].x).normalize();
    const prev=points[i===0?(closed?last-1:0):i-1];
    const next=points[i===last?(closed?1:last):i+1];
    const t=next.clone().sub(prev).normalize();
    return new THREE.Vector3(t.z,0,-t.x);
  });
  if(closed)normals[last]=normals[0].clone();
  ribbonNormals.set(points,normals);return normals;
}
function ribbonQuad(a,b,na,nb,lo,hi){
  return [a.clone().addScaledVector(na,lo),a.clone().addScaledVector(na,hi),
    b.clone().addScaledVector(nb,hi),b.clone().addScaledVector(nb,lo)];
}
// Check the entire marking/rail footprint, not only its centre. At a merge
// we interrupt paint rather than drawing it across the adjoining lane.
function quadIsClear(quad,clear){
  for(const t of [0,.5,1]){
    const a=quad[0].clone().lerp(quad[3],t),b=quad[1].clone().lerp(quad[2],t);
    for(const u of [0,.5,1])if(!clear(a.clone().lerp(b,u)))return false;
  }
  return true;
}
// Fast clearance queries for static geometry. Keep the driving/collision
// distance functions untouched, and avoid scanning distant pit lanes.
const pathBounds = new WeakMap();
function clearOfPath(p,points,limit){
  let bounds=pathBounds.get(points);
  if(!bounds){
    bounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
    for(const q of points){bounds.minX=Math.min(bounds.minX,q.x);bounds.maxX=Math.max(bounds.maxX,q.x);bounds.minZ=Math.min(bounds.minZ,q.z);bounds.maxZ=Math.max(bounds.maxZ,q.z);}
    pathBounds.set(points,bounds);
  }
  if(p.x<bounds.minX-limit||p.x>bounds.maxX+limit||p.z<bounds.minZ-limit||p.z>bounds.maxZ+limit)return true;
  const limit2=limit*limit;
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1];
    if(p.x<Math.min(a.x,b.x)-limit||p.x>Math.max(a.x,b.x)+limit||p.z<Math.min(a.z,b.z)-limit||p.z>Math.max(a.z,b.z)+limit)continue;
    const dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz;
    const t=len2?clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/len2,0,1):0;
    const x=p.x-a.x-t*dx,z=p.z-a.z-t*dz;
    if(x*x+z*z<=limit2)return false;
  }
  return true;
}
function clearOfMain(p,margin=0){return clearOfPath(p,trackPoints,ROAD_HALF+margin);}
function clearOfPits(p,margin=0){return stationData.every(pit=>clearOfPath(p,pit.points,PIT_HALF+margin));}
function createRibbon(points,minOffset,maxOffset,y,baseColor,alternates=false,clear=null,includeSegment=null) {
  const vertices=[],colours=[],indices=[],uv=[],normals=getRibbonNormals(points);
  for(let i=0;i<points.length-1;i++) {
    if(includeSegment&&!includeSegment(i))continue;
    const quad=ribbonQuad(points[i],points[i+1],normals[i],normals[i+1],minOffset,maxOffset);
    if(clear&&!quadIsClear(quad,clear))continue;
    const col=new THREE.Color(alternates?(Math.floor(i/3)%2===0?0xf5f3e3:baseColor):baseColor);
    const k=vertices.length/3;
    quad.forEach(q=>{vertices.push(q.x,y,q.z);colours.push(col.r,col.g,col.b);uv.push(q.x/28,q.z/28);});
    indices.push(k,k+2,k+1,k,k+3,k+2);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));mesh.receiveShadow=true;return mesh;
}
function addRibbon(path,lo,hi,y,color,alt=false,clear=null){const m=createRibbon(path,lo,hi,y,color,alt,clear);worldObjects.add(m);return m;}
// Use a full-width footprint for the approach/exit signs and road paint.
function pitCrossSectionClear(pit,q,halfWidth,margin=0,halfLength=0){
  const p=pit.curve.getPointAt(q),t=pit.curve.getTangentAt(q),n=new THREE.Vector3(t.z,0,-t.x);
  const a=p.clone().addScaledVector(t,-halfLength),b=p.clone().addScaledVector(t,halfLength);
  return quadIsClear(ribbonQuad(a,b,n,n,-halfWidth,halfWidth),v=>clearOfMain(v,margin));
}
function findPitClearPosition(pit,start,end,width,margin=0,length=0){
  const direction=Math.sign(end-start)||1;
  for(let q=start;direction*(end-q)>=-1e-8;q+=direction*.01){
    if(pitCrossSectionClear(pit,q,width,margin,length))return q;
  }
  return null;
}
function makeLabelTexture(lines,fg='#f5f7e8',bg='#163b38',w=1024,h=256){
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,w,h);
  g.fillStyle=fg;g.textAlign='center';g.textBaseline='middle';
  lines.forEach((line,i)=>{g.font=`900 ${lines.length>1?Math.floor(78/lines.length+11):81}px Arial, sans-serif`;g.fillText(line,w/2,(i+.5)*h/lines.length,w-48);});
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());return t;
}
function solidBox(w,h,d,col,x,y,z,group=worldObjects,material=null){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material||new THREE.MeshStandardMaterial({color:col,roughness:.82}));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
}
function addCylinder(radiusTop,radiusBottom,height,color,x,y,z,group=worldObjects,segments=9){
  const m=new THREE.Mesh(new THREE.CylinderGeometry(radiusTop,radiusBottom,height,segments),new THREE.MeshStandardMaterial({color,roughness:.95}));m.position.set(x,y,z);m.castShadow=true;group.add(m);return m;
}
function addWorldLabel(text,pos,w=32,h=6,bg='#153d38',fg='#e6f5ac',angle=0,group=worldObjects){
  const t=makeLabelTexture([text],fg,bg);
  // Two correctly oriented front faces. Rendering a texture on a DoubleSide
  // plane produces mirror writing on its back side (old grandstand bug).
  const material=new THREE.MeshBasicMaterial({map:t,side:THREE.FrontSide});
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),material);m.position.copy(pos);m.rotation.y=angle;group.add(m);
  const back=new THREE.Mesh(m.geometry,material);back.position.copy(pos);back.rotation.y=angle+Math.PI;
  back.position.x-=Math.sin(angle)*.06;back.position.z-=Math.cos(angle)*.06;group.add(back);
  return m;
}
// Procedural, repeatable surfaces: no downloaded texture assets required.
function makeSurfaceTexture(kind){
  const size=512,c=document.createElement('canvas');c.width=c.height=size;
  const g=c.getContext('2d'),rand=seededRandom({asphalt:83,grass:85447,gravel:731,runoff:557}[kind]);
  const base={asphalt:[164,164,160],grass:[100,129,67],gravel:[177,159,128],runoff:[167,176,166]}[kind];
  const data=g.createImageData(size,size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;
    const coarse=5*Math.sin(x/size*TWO_PI*3)*Math.cos(y/size*TWO_PI*4)+4*Math.sin((x+y)/size*TWO_PI*7);
    const noise=(rand()-.5)*(kind==='gravel'?82:kind==='asphalt'?51:36)+coarse;
    for(let k=0;k<3;k++)data.data[i+k]=clamp(base[k]+noise,0,255);
    data.data[i+3]=255;
  }
  g.putImageData(data,0,0);
  for(let i=0;i<(kind==='grass'?14000:kind==='gravel'?9000:4000);i++){
    const x=rand()*size,y=rand()*size;
    if(kind==='grass'){g.strokeStyle=i%2?'rgba(39,76,28,.30)':'rgba(195,208,113,.23)';g.lineWidth=.7;g.beginPath();g.moveTo(x,y);g.lineTo(x+(rand()-.5)*3,y-2-rand()*6);g.stroke();}
    else if(kind==='gravel'){g.fillStyle=i%3?'rgba(94,77,55,.25)':'rgba(243,226,185,.5)';g.beginPath();g.ellipse(x,y,.8+rand()*2.8,.6+rand()*1.8,rand()*Math.PI,0,TWO_PI);g.fill();}
    else {g.fillStyle=i%2?'rgba(25,25,25,.24)':'rgba(230,230,220,.22)';g.fillRect(x,y,1+rand()*2,1+rand()*2);}
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy=Math.min(QUALITY[quality].anisotropy,renderer.capabilities.getMaxAnisotropy());
  return t;
}
function textured(mesh,kind){mesh.material.map=roadTextures[kind];mesh.material.needsUpdate=true;return mesh;}
function addKerb(side,clear){
  const positions=[],colors=[],indices=[],normals=getRibbonNormals(trackPoints);
  // Sloped edges and a raised flat crown; all strips use shared cross-sections.
  const profile=[[0,.09],[.55,.34],[2.35,.34],[3,.015]];
  for(let i=0;i<trackPoints.length-1;i++){
    const a=trackPoints[i],b=trackPoints[i+1],na=normals[i],nb=normals[i+1];
    const lo=Math.min(side*ROAD_HALF,side*(ROAD_HALF+3)),hi=Math.max(side*ROAD_HALF,side*(ROAD_HALF+3));
    if(!quadIsClear(ribbonQuad(a,b,na,nb,lo,hi),clear))continue;
    const color=new THREE.Color(Math.floor(i/3)%2?0xc63b32:0xf4f2e7);
    for(let j=0;j<profile.length-1;j++){
      const [d0,y0]=profile[j],[d1,y1]=profile[j+1],k=positions.length/3;
      const q=ribbonQuad(a,b,na,nb,side*(ROAD_HALF+d0),side*(ROAD_HALF+d1));
      q.forEach((v,m)=>{positions.push(v.x,m===0||m===3?y0:y1,v.z);colors.push(color.r,color.g,color.b);});
      if(side>0)indices.push(k,k+2,k+1,k,k+3,k+2);else indices.push(k,k+1,k+2,k,k+2,k+3);
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
  const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.86,side:THREE.DoubleSide}));mesh.receiveShadow=true;worldObjects.add(mesh);
}
function addTyreMarks(){
  // Paired worn racing lines, concentrated at bends/braking zones. The
  // markings stay well inside the tarmac and are static decorative details.
  const corner=i=>{const a=trackTangents[(i+TRACK_SAMPLES-8)%TRACK_SAMPLES],b=trackTangents[(i+8)%TRACK_SAMPLES];return a.dot(b)<.997;};
  for(const offset of [-2.1,2.1]){
    const m=createRibbon(trackPoints,offset-.53,offset+.53,.091,0x15191b,false,null,corner);
    m.material.transparent=true;m.material.opacity=.23;m.material.depthWrite=false;m.material.polygonOffset=true;m.material.polygonOffsetFactor=-1;m.renderOrder=1;worldObjects.add(m);
    const wear=createRibbon(trackPoints,offset-1.1,offset+1.1,.085,0x252a2b);
    wear.material.transparent=true;wear.material.opacity=.09;wear.material.depthWrite=false;wear.material.polygonOffset=true;wear.material.polygonOffsetFactor=-1;wear.material.polygonOffsetUnits=-1;worldObjects.add(wear);
  }
}
function addTrack(){
  roadTextures={};for(const kind of ['asphalt','grass','gravel','runoff'])roadTextures[kind]=makeSurfaceTexture(kind);
  roadTextures.grass.repeat.set(activeCircuit==='coastal'?140:100,activeCircuit==='coastal'?110:80);
  const g=new THREE.Mesh(new THREE.PlaneGeometry(activeCircuit==='coastal'?6200:4500,activeCircuit==='coastal'?4800:3600),new THREE.MeshStandardMaterial({map:roadTextures.grass,color:0xffffff,roughness:1}));g.rotation.x=-Math.PI/2;g.position.y=-.45;g.receiveShadow=true;worldObjects.add(g);
  const outsidePitMerge=p=>clearOfPits(p,1);
  // Gravel and paved runoff remain beneath both road surfaces, and stop at pit merges.
  for(const side of [-1,1]){
    const limits=(a,b)=>[Math.min(side*a,side*b),Math.max(side*a,side*b)];
    textured(addRibbon(trackPoints,...limits(34,42),-.18,0xffffff,false,outsidePitMerge),'gravel');
    textured(addRibbon(trackPoints,...limits(26,34),-.07,0x9faeac,false,outsidePitMerge),'runoff');
  }
  addRibbon(trackPoints,-29,29,-.12,0x67716d);
  asphaltMesh=textured(addRibbon(trackPoints,-ROAD_HALF,ROAD_HALF,.07,0x7c8283),'asphalt');
  addTyreMarks();
  addKerb(-1,outsidePitMerge);addKerb(1,outsidePitMerge);
  addRibbon(trackPoints,-ROAD_HALF+1,-ROAD_HALF+1.5,.14,0xe7e7d7,false,outsidePitMerge);
  addRibbon(trackPoints,ROAD_HALF-1.5,ROAD_HALF-1,.14,0xe7e7d7,false,outsidePitMerge);
  addRibbon(trackPoints,-34,-32,-.04,0x42665b,false,outsidePitMerge);
  addRibbon(trackPoints,32,34,-.04,0x42665b,false,outsidePitMerge);
  const gridP=trackCurve.getPointAt(0),t=trackCurve.getTangentAt(0),n=new THREE.Vector3(t.z,0,-t.x);
  for(let lane=0;lane<10;lane++){
    const side=-18+lane*3.7;
    for(let r=0;r<2;r++){
      const q=gridP.clone().addScaledVector(n,side).addScaledVector(t,r*4);
      const checker=solidBox(3.7,.06,3.8,(lane+r)%2?0xf2f0db:0x172e31,q.x,.19,q.z);
      checker.rotation.y=-getHeading(t);
    }
  }
  for(let line=0;line<12;line++){
    const center=trackCurve.getPointAt((.99-line*.006+1)%1),dir=trackCurve.getTangentAt((.99-line*.006+1)%1),nr=new THREE.Vector3(dir.z,0,-dir.x);
    for(let side of [-1,1]){
      let p=center.clone().addScaledVector(nr,side*12);const mark=solidBox(2,.05,6,0xd9dbc9,p.x,.20,p.z);mark.rotation.y=-getHeading(dir);
    }
  }
  const gateP=trackCurve.getPointAt(0),gateT=trackCurve.getTangentAt(0),gateNormal=new THREE.Vector3(gateT.z,0,-gateT.x);
  for(const s of [-1,1]){const p=gateP.clone().addScaledVector(gateNormal,s*27);addCylinder(1.3,1.7,24,0x163c39,p.x,12,p.z);}
  const gantryText=addWorldLabel('GHANTA  /  RC  GRAND PRIX',gateP.clone().setY(23),52,8,'#16352e','#e0f2a2',facingOncoming(gateT));
  gantryText.userData.billboard=false;
}
function placeArcadeBoostPads(){
  for(const t of [.12,.36,.62,.86]){
    const p=trackCurve.getPointAt(t),dir=trackCurve.getTangentAt(t);
    const m=solidBox(16,.07,13,0x4a9b84,p.x,.25,p.z);m.rotation.y=-getHeading(dir);m.material.emissive=new THREE.Color(0x236c4d);m.material.emissiveIntensity=.5;
    const texture=makeLabelTexture(['>> BOOST'],'#d9fd9b','#4a9b84',512,128);
    const paint=new THREE.Mesh(new THREE.PlaneGeometry(12,4),new THREE.MeshBasicMaterial({map:texture}));paint.position.copy(p).setY(.30);paint.rotation.set(-Math.PI/2,-getHeading(dir),0,'YXZ');worldObjects.add(paint);
  }
}
function createServiceLane(pit){
  // Pit asphalt passes UNDER the main asphalt and matches its colour, so
  // an overlapping merge reads as a single paved surface, not a stripe.
  textured(addRibbon(pit.points,-PIT_HALF-5,PIT_HALF+5,-.095,0x9faeac),'runoff');
  const pavement=textured(addRibbon(pit.points,-PIT_HALF,PIT_HALF,.045,0x7c8283),'asphalt');
  pavement.material.polygonOffset=true;
  pavement.material.polygonOffsetFactor=1;
  pavement.material.polygonOffsetUnits=1;
  // Pit markings must never extend onto the racing surface or its kerbs.
  const outsideMain=p=>clearOfMain(p,3.5);
  addRibbon(pit.points,-PIT_HALF,-PIT_HALF+1.4,.09,0xdde9d4,false,outsideMain);
  addRibbon(pit.points,PIT_HALF-1.4,PIT_HALF,.09,0xdde9d4,false,outsideMain);
  addRibbon(pit.points,-PIT_HALF+2,-PIT_HALF+2.6,.10,0xeaca61,false,outsideMain);
  for(const q of [.12,.28,.44,.6,.76,.9]){
    const center=pit.curve.getPointAt(q),tan=pit.curve.getTangentAt(q),normal=new THREE.Vector3(tan.z,0,-tan.x);
    for(const side of [-1,1]){
      const p=center.clone().addScaledVector(normal,side*(PIT_HALF+3));
      if(!clearOfMain(p,8))continue;
      addCylinder(.75,.95,1.3,0x345349,p.x,.65,p.z);
      addCylinder(.35,.35,2.2,0xe5edb0,p.x,2.2,p.z);
    }
  }
  // Paint the entrance/exit stripes only once the full stripe is off-track.
  for(const [from,to,color] of [[.08,.45,0x91db79],[.93,.55,0xe7d875]]){
    const q=findPitClearPosition(pit,from,to,PIT_HALF*.775,4,1.7);
    if(q===null)continue;
    const p=pit.curve.getPointAt(q),tan=pit.curve.getTangentAt(q);
    const stripe=solidBox(PIT_HALF*1.55,.09,3.4,color,p.x,.16,p.z);stripe.rotation.y=-getHeading(tan);
  }
  // Put the gantry posts outside the main track, not in the merge itself.
  const entranceQ=findPitClearPosition(pit,.10,.45,17,8)??.5;
  const entrance=pit.curve.getPointAt(entranceQ),entranceTan=pit.curve.getTangentAt(entranceQ);
  const name=raceMode==='tour'?`PIT ${String(pit.index+1).padStart(2,'0')} · ${pit.info.name.toUpperCase()}`:'FUEL & ENGINEERING · PIT LANE';
  if(pitCrossSectionClear(pit,entranceQ,19,5))addWorldLabel(name,entrance.clone().setY(11),37,5.5,'#133a36','#e4f5a3',facingOncoming(entranceTan));
  for(const side of [-1,1]){
    const normal=new THREE.Vector3(entranceTan.z,0,-entranceTan.x);
    const p=entrance.clone().addScaledVector(normal,side*16);
    if(!clearOfMain(p,8))continue;
    addCylinder(.75,1.0,13,0x26584d,p.x,6.5,p.z);
    const lamp=addCylinder(1.6,1.6,1.2,0xc4f194,p.x,14,p.z);lamp.material.emissive=new THREE.Color(0x9aca54);lamp.material.emissiveIntensity=.8;
  }
  // The PIT IN markings appear BEFORE the merge so drivers can choose a lane.
  const approach=trackCurve.getPointAt((pit.startT-.010+1)%1),approachTan=trackCurve.getTangentAt((pit.startT-.010+1)%1);
  const approachNormal=new THREE.Vector3(approachTan.z,0,-approachTan.x);
  const approachSide=approachNormal.dot(pit.n)>=0?1:-1;
  // Mount the directional sign at the road edge, rather than intersecting the tarmac.
  const approachPos=approach.clone().addScaledVector(approachNormal,approachSide*43);
  if(clearOfPits(approachPos,8)){
    addCylinder(.38,.5,10,0x526d68,approachPos.x,5,approachPos.z);
    addWorldLabel(`PIT ${String(pit.index+1).padStart(2,'0')}   ${approachSide>0?'←':'➜'}`,approachPos.setY(12),22,5,'#4e9a67','#f5ffd1',facingOncoming(approachTan));
  }else{
    addWorldLabel(`PIT ${String(pit.index+1).padStart(2,'0')}   ${approachSide>0?'←':'➜'}`,approach.clone().setY(15),25,4,'#4e9a67','#f5ffd1',facingOncoming(approachTan));
  }
  const centre=pit.curve.getPointAt(.5),tangent=pit.curve.getTangentAt(.5),normal=new THREE.Vector3(tangent.z,0,-tangent.x);
  const out=normal.dot(pit.n)>=0?1:-1;
  const ap=centre.clone().addScaledVector(normal,out*138).setY(0);
  const garage=solidBox(29,9,18,raceMode==='tour'?0x284e48:0x335b60,ap.x,5.5,ap.z);garage.rotation.y=getHeading(tangent);
  const roof=solidBox(32,1.3,21,0xd7e7d4,ap.x,10.8,ap.z);roof.rotation.y=garage.rotation.y;
  const bay=new THREE.Group();bay.position.copy(ap);bay.rotation.y=garage.rotation.y;worldObjects.add(bay);
  // Door panels and canopy stay inside the existing garage footprint.
  for(const z of [-9.15,9.15])for(const x of [-9,0,9]){
    solidBox(8,5.4,.25,0x18282d,x,3.4,z,bay);
    for(let row=0;row<5;row++)detail(solidBox(7.5,.12,.32,0x81918c,x,1.2+row*.95,z,bay));
    detail(solidBox(7.2,.55,.38,0x9bbfc0,x,6.5,z,bay));
  }
  for(const x of [-13.5,13.5])solidBox(.6,8,.6,0xc3d4ce,x,4.5,-9.25,bay);
  addWorldLabel(raceMode==='tour'?`SG · PIT ${String(pit.index+1).padStart(2,'0')}`:'FUEL & ENGINEERING',ap.clone().setY(8),24,4,'#123733','#e4f3ad',facingOncoming(tangent));
  if(raceMode==='tour')createStationBillboards(pit);
  const refuel=addWorldLabel('FULL TANK  /  DRIVE THROUGH',centre.clone().setY(12),23,3,'#e7f6b7','#16423b',facingOncoming(tangent));refuel.userData.pitLabel=true;
}
function createStationBillboards(pit){
  const items=pit.info.items;
  items.forEach((item,i)=>{
    // The exhibition runs down the OUTER edge of the pit lane only: signs must
    // never hang over the actual racing circuit or obstruct a driver's line.
    const baseQ=items.length===1?.5:(.065+.87*i/(items.length-1));
    // Board placement is collision-aware. At tighter hairpins, move an exhibit
    // a short way toward the middle of its lane rather than letting it jut over
    // another section of the race track or hiding it hundreds of metres away.
    const inward=i<items.length/2?1:-1;
    const qChoices=[baseQ,...[.03,.06,.09,.12].map(d=>clamp(baseQ+inward*d,.06,.94))];
    let pos=null,point=null,dist=-Infinity;
    outer: for(const offset of [PIT_HALF+50,75,90,110,145]){
      for(const q of qChoices){
        const anchor=pit.curve.getPointAt(q),dir=pit.curve.getTangentAt(q);
        const norm=new THREE.Vector3(dir.z,0,-dir.x);
        const preferred=norm.dot(pit.n)>=0?1:-1;
        for(const sign of [preferred,-preferred]){
          const candidate=anchor.clone().addScaledVector(norm,sign*offset);
          const clearance=getTrackClosest(candidate.x,candidate.z).dist;
          if(clearance>ROAD_HALF+38){pos=candidate;point=anchor;dist=clearance;break outer;}
          if(clearance>dist){pos=candidate;point=anchor;dist=clearance;}
        }
      }
    }
    const towards=point.clone().sub(pos).normalize();
    const heading=Math.atan2(towards.x,towards.z);
    const group=new THREE.Group();group.position.set(pos.x,0,pos.z);group.rotation.y=heading;worldObjects.add(group);
    const w=PIT_BOARD_WIDTH,h=PIT_BOARD_HEIGHT;
    solidBox(w+1, h+1,1.3,0x193d39,0,h/2+3,0,group);
    solidBox(w+2,.65,1.7,0xcdec81,0,h+3.5,0,group);
    for(const x of [-w*.43,w*.43])solidBox(.55,6,1.2,0x23433a,x,3,0,group);
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:0xfffdf2,side:THREE.FrontSide}));
    mesh.position.set(0,h/2+3,.73);group.add(mesh);
    const backMesh=new THREE.Mesh(mesh.geometry,new THREE.MeshBasicMaterial({color:0xfffdf2,side:THREE.FrontSide}));
    backMesh.position.set(0,h/2+3,-.73);backMesh.rotation.y=Math.PI;group.add(backMesh);
    pit.boards.push({item,mesh,backMesh,worldPos:new THREE.Vector3(pos.x,h/2+3,pos.z),towards,
      section:pit.info,texture:null,station:pit,group,width:w,height:h});
  });
}
function paintWrapping(ctx,text,maxWidth,fontSize,lineHeight,x,startY,color='#243c37',weight='500'){
  ctx.fillStyle=color;ctx.font=`${weight} ${fontSize}px Arial, sans-serif`;
  let y=startY,lines=0;
  for(const paragraph of text){
    const words=paragraph.split(/\s+/),chunks=[];let line='';
    for(const word of words){
      const test=line?`${line} ${word}`:word;
      if(ctx.measureText(test).width>maxWidth&&line){chunks.push(line);line=word;}else line=test;
    }
    if(line)chunks.push(line);
    for(const part of chunks){ctx.fillText(part,x,y);y+=lineHeight;lines++;}
    y+=lineHeight*.42;
  }
  return {y,lines};
}
function makePoster(board){
  const canvas=document.createElement('canvas'),W=1536,H=928;canvas.width=W;canvas.height=H;
  const g=canvas.getContext('2d');const item=board.item,sec=board.section;
  // A landscape exhibit card, readable at driving-camera distances and never mirrored.
  g.fillStyle='#fffdf3';g.fillRect(0,0,W,H);
  g.fillStyle='#153b38';g.fillRect(0,0,W,101);
  g.fillStyle='#e7f6aa';g.textBaseline='top';g.font='bold 32px Arial,sans-serif';
  g.fillText('SG.  /  '+sec.name.toUpperCase(),60,34,W-120);
  g.textAlign='right';g.font='bold 25px Arial';g.fillText('PIT '+String(board.station.index+1).padStart(2,'0'),W-58,37);g.textAlign='left';
  const wrap=(text,max,font)=>{
    g.font=font;const chunks=[];let line='';
    for(const word of String(text).split(/\s+/)){
      const candidate=line?line+' '+word:word;
      if(g.measureText(candidate).width>max&&line){chunks.push(line);line=word;}else line=candidate;
    }
    if(line)chunks.push(line);return chunks;
  };
  const meta=[item.meta,item.status,item.date].filter(Boolean),paras=item.paragraphs.filter(Boolean);
  let chosen;
  for(let size=39;size>=21;size--){
    const titleSize=Math.min(57,size+15);
    const titles=wrap(item.title,W-120,`900 ${titleSize}px Arial`);
    const metas=meta.flatMap(t=>wrap(t,W-120,`600 ${size*.78}px Arial`));
    const body=paras.map(p=>wrap(p,W-120,`500 ${size}px Arial`));
    const bodyRows=body.reduce((n,p)=>n+p.length,0);
    const links=item.links.slice(0,7);
    const estimate=127+titles.length*(titleSize+6)+metas.length*(size*.93)+25+bodyRows*(size*1.27)+
      paras.length*size*.29+links.length*(size*.9)+35;
    chosen={size,titleSize,titles,metas,body,links};
    if(estimate<H-40)break;
  }
  let y=125;
  g.fillStyle='#17362f';g.font=`900 ${chosen.titleSize}px Arial`;
  for(const t of chosen.titles){g.fillText(t,59,y,W-118);y+=chosen.titleSize+6;}
  y+=6;g.fillStyle='#557d72';g.font=`600 ${chosen.size*.78}px Arial`;
  for(const t of chosen.metas){g.fillText(t,60,y,W-120);y+=chosen.size*.93;}
  y+=12;g.fillStyle='#b9c9c0';g.fillRect(60,y,W-120,2);y+=19;
  g.fillStyle='#263d36';g.font=`500 ${chosen.size}px Arial`;
  for(const rows of chosen.body){
    for(const t of rows){g.fillText(t,60,y,W-120);y+=chosen.size*1.27;}
    y+=chosen.size*.29;
  }
  if(chosen.links.length){
    g.fillStyle='#2d7864';g.font=`700 ${chosen.size*.79}px Arial`;
    for(const link of chosen.links){g.fillText('↗  '+link.label,60,y,W-120);y+=chosen.size*.9;}
  }
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),4);return t;
}
function refreshVisiblePosters(force=false){
  if(raceMode!=='tour'||!gameRunning)return;
  for(const pit of stationData){
    const here=pit.curve.getPointAt(.5);const dist=Math.hypot(player.x-here.x,player.z-here.z);
    const load=dist<230;
    if(load&&!pit.loaded){for(const board of pit.boards){const t=makePoster(board);board.texture=t;for(const face of [board.mesh,board.backMesh]){face.material.map=t;face.material.color.set(0xffffff);face.material.needsUpdate=true;}}pit.loaded=true;}
    if(!load&&pit.loaded&&dist>340&&!force){for(const board of pit.boards){for(const face of [board.mesh,board.backMesh]){face.material.map=null;face.material.color.set(0xf1f3e7);face.material.needsUpdate=true;}board.texture?.dispose();board.texture=null;}pit.loaded=false;}
  }
}
function seededRandom(seed=142857){let k=seed>>>0;return()=>{k=(Math.imul(k,1664525)+1013904223)>>>0;return k/4294967296;};}
function addGuardRails(){
  // Armco beams are instanced to make the stadium affordable on integrated GPUs.
  const beams=[],posts=[],bumpers=[];
  function put(array,x,y,z,rx,ry,rz,angle=0){array.push({x,y,z,rx,ry,rz,angle});}
  for(const side of [-1,1])for(let i=0;i<TRACK_SAMPLES;i+=4){
    const u=i/TRACK_SAMPLES,mid=trackCurve.getPointAt(u),tan=trackCurve.getTangentAt(u);
    const normal=new THREE.Vector3(tan.z,0,-tan.x),c=mid.clone().addScaledVector(normal,side*32.7);
    const j=Math.min(i+4,TRACK_SAMPLES),end=trackCurve.getPointAt(j/TRACK_SAMPLES),nextT=trackCurve.getTangentAt(j/TRACK_SAMPLES);
    const e=end.clone().addScaledVector(new THREE.Vector3(nextT.z,0,-nextT.x),side*32.7);
    if([c,c.clone().lerp(e,.25),c.clone().lerp(e,.5),c.clone().lerp(e,.75),e].some(p=>!clearOfPits(p,8)))continue;
    const span=Math.hypot(e.x-c.x,e.z-c.z),angle=Math.atan2(e.x-c.x,e.z-c.z);
    for(const h of [2.5,4.5])put(beams,(e.x+c.x)/2,h,(e.z+c.z)/2,1.25,1.05,span+1.6,angle);
    if(i%8===0)put(posts,c.x,2.85,c.z,1.45,5.7,1.8,0);
    if(i%24===0)put(bumpers,c.x,1.1,c.z,3,1.8,5,angle);
  }
  // Low pit-lane barriers follow the bypass, but stop before the merge zone.
  for(const pit of stationData)for(let i=12;i<105;i+=3){
    const a=pit.points[i],b=pit.points[i+3],dx=b.x-a.x,dz=b.z-a.z;
    const distance=Math.hypot(dx,dz)||1,normal=new THREE.Vector3(dz/distance,0,-dx/distance),mid=a.clone().add(b).multiplyScalar(.5);
    for(const side of [-1,1]){
      const p=mid.clone().addScaledVector(normal,side*(PIT_HALF+3.5));
      const pa=a.clone().addScaledVector(normal,side*(PIT_HALF+3.5)),pb=b.clone().addScaledVector(normal,side*(PIT_HALF+3.5));
      if([pa,pa.clone().lerp(pb,.25),p,pa.clone().lerp(pb,.75),pb].some(v=>!clearOfMain(v,8)))continue;
      put(beams,p.x,1.45,p.z,1.15,2.3,distance+.7,Math.atan2(dx,dz));
    }
  }
  for(const [data,color,metalness] of [[beams,0xc4d5d4,.72],[posts,0x344e55,.5],[bumpers,0x15393b,.05]]){
    if(!data.length)continue;
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color,metalness,roughness:.43}),data.length);
    const dummy=new THREE.Object3D();
    data.forEach((p,i)=>{
      dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.angle,0);dummy.scale.set(p.rx,p.ry,p.rz);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=false;mesh.receiveShadow=true;worldObjects.add(mesh);
  }
}

// Validate the ENTIRE stand footprint, not just its centre, against all roads.
// The main road and each outward-curving pit can run behind a bend, so a fixed
// 92-unit stand offset would regularly put seats directly over pit tarmac.
function clearGrandstandFootprint(center,yaw){
  const cosine=Math.cos(yaw),sine=Math.sin(yaw);
  for(let ix=-96;ix<=96;ix+=24)for(let iz=-62;iz<=70;iz+=22){
    const x=center.x+ix*cosine+iz*sine;
    const z=center.z-ix*sine+iz*cosine;
    if(getTrackClosest(x,z).dist<ROAD_HALF+22)return false;
    for(const pit of stationData)if(getPitClosest(x,z,pit).dist<PIT_HALF+24)return false;
  }
  return true;
}
function addStadiumArchitecture(){
  const rand=seededRandom(84120);
  const steel=new THREE.MeshStandardMaterial({color:0x365359,metalness:.58,roughness:.4});
  const roofMat=new THREE.MeshStandardMaterial({color:0xeff4ed,metalness:.2,roughness:.38,side:THREE.DoubleSide});
  const dark=new THREE.MeshStandardMaterial({color:0x18363b,metalness:.2,roughness:.7});
  const glass=new THREE.MeshStandardMaterial({color:0x96c9c7,metalness:.4,roughness:.21});
  const seatColors=[0x7ce0bc,0xdaf493,0xeec99b,0xb6d0dc,0x9eafc1];
  // Massive circular stadium apron surrounding the racetrack, but outside the road.
  const outer=new THREE.Mesh(new THREE.RingGeometry(1470,1575,128),new THREE.MeshStandardMaterial({color:0x34494c,roughness:1,side:THREE.DoubleSide}));
  outer.rotation.x=-Math.PI/2;outer.scale.y=.77;outer.position.y=-.27;if(activeCircuit==='stadium')worldObjects.add(outer);else disposeObject(outer);
  const oval=new THREE.EllipseCurve(0,0,1520,1170,0,TWO_PI,false,0);
  for(let i=0;i<(activeCircuit==='coastal'?0:96);i++){
    const t=i/96,angle=t*TWO_PI,p=oval.getPoint(t),p2=oval.getPoint((i+1)/96),dx=p2.x-p.x,dz=p2.y-p.y;
    const panel=solidBox(1.8,21,Math.hypot(dx,dz)+1.7,0x28464c,(p.x+p2.x)/2,10.5,(p.y+p2.y)/2);panel.rotation.y=Math.atan2(dx,dz);
    if(i%4===0){const pole=addCylinder(1.8,2.3,42,0xdce4df,p.x,21,p.y);pole.castShadow=true;}
    if(i%12===0){const pole=addCylinder(1.4,1.4,52,0x647d7a,p.x,26,p.y);solidBox(13,3,3,0xf0f5e6,p.x,52,p.y);}
  }
  // Stadium tribunes consist of tiered concrete, seating rows, crowd, railings,
  // structural columns and roof cantilevers. They are arranged around turns.
  for(const u of (activeCircuit==='coastal'?[.012,.955]:[.035,.13,.215,.305,.405,.51,.605,.70,.805,.91])){
    const base=trackCurve.getPointAt(u),tangent=trackCurve.getTangentAt(u),n=new THREE.Vector3(tangent.z,0,-tangent.x);
    const side=base.x*n.x+base.z*n.z>=0?1:-1;n.multiplyScalar(side);
    const yaw=standYaw(tangent,side);
    let p=null;
    for(const offset of [195,235,280,325,370,415,460]){
      const candidate=base.clone().addScaledVector(n,offset);
      if(clearGrandstandFootprint(candidate,yaw)){p=candidate;break;}
    }
    if(!p){console.warn('No safe grandstand position near track segment',u);continue;}
    const group=new THREE.Group();group.position.set(p.x,0,p.z);group.rotation.y=yaw;worldObjects.add(group);
    solidBox(180,6,78,0x45595a,0,3,0,group);
    solidBox(175,17,6,0x2a4145,0,8,40,group);
    const count=13*31;
    const seatMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(3,1.4,1.5),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8}),count);
    const spectatorMesh=new THREE.InstancedMesh(new THREE.CylinderGeometry(1.05,1.15,2.7,6),new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),count);
    const dummy=new THREE.Object3D();let nSeats=0,nPeople=0;
    for(let row=0;row<13;row++){
      const h=7+row*2.15,z=-34+row*5.15;
      solidBox(175,1.45,5.5,row%2?0x718683:0x8da29d,0,h-1,z,group);
      for(let j=0;j<31;j++){
        const x=-83+j*5.5+rand()*1.5;
        dummy.position.set(x,h+.5,z+1.1);dummy.rotation.set(0,0,0);dummy.scale.setScalar(1);dummy.updateMatrix();
        seatMesh.setMatrixAt(nSeats,dummy.matrix);seatMesh.setColorAt(nSeats,new THREE.Color(seatColors[(j+row*2)%seatColors.length]));nSeats++;
        if((j*3+row*7)%5!==0){
          dummy.position.y=h+2.15;dummy.updateMatrix();spectatorMesh.setMatrixAt(nPeople,dummy.matrix);
          spectatorMesh.setColorAt(nPeople,new THREE.Color(seatColors[(j*2+row)%seatColors.length]));nPeople++;
        }
      }
    }
    seatMesh.count=nSeats;spectatorMesh.count=nPeople;
    seatMesh.instanceMatrix.needsUpdate=true;spectatorMesh.instanceMatrix.needsUpdate=true;
    seatMesh.castShadow=false;spectatorMesh.castShadow=false;
    group.add(seatMesh,spectatorMesh);detail(spectatorMesh,1.3,true);
    for(const x of [-58,58]){
      // Aisle markings and handrails, without changing the stand footprint.
      for(let row=0;row<13;row++)detail(solidBox(1.1,.2,4.7,0xd4d9cd,x,7+row*2.15,-34+row*5.15,group));
      const rail=solidBox(.55,.55,72,0xc0cac5,x,25,0,group,steel);rail.rotation.x=-Math.atan2(12*2.15,12*5.15);
      detail(rail);
    }
    for(const x of [-74,-37,0,37,74])detail(solidBox(26,3,.35,0x8aa7aa,x,34,-47,group));
    // Roof with a polished leading edge and dark support skeleton.
    solidBox(189,2.8,96,0xe3eae4,0,40,1,group,roofMat);
    solidBox(192,3.4,3.5,0xaacf8d,0,39,-47,group);
    for(const x of [-86,-42,0,42,86]){
      solidBox(1.7,37,1.8,0x334d55,x,20,40,group,steel);
      const beam=solidBox(1.7,1.8,94,0x334d55,x,37,0,group,steel);beam.rotation.x=-.05;
      solidBox(1.5,15,1.5,0xb9c7c3,x,17,-38,group);
    }
    addWorldLabel('GHANTA CIRCUIT · GRANDSTAND',group.localToWorld(new THREE.Vector3(0,43,-49)),89,7,'#213e43','#dbf394',Math.atan2(-n.x,-n.z));
    stadiumDecor.grandstands.push({x:p.x,z:p.z,u,side,heading:group.rotation.y,width:180});
  }
  // Infield race-control tower and centre paddock. Surrounding bleachers
  // remain detached from the road, so neither one occupies the driving line.
  const tower= new THREE.Group();tower.position.set(activeCircuit==='coastal'?-850:80,0,activeCircuit==='coastal'?250:30);worldObjects.add(tower);
  solidBox(110,10,65,0x304d55,0,5,0,tower,steel);
  for(let floor=0;floor<4;floor++){
    solidBox(52,11,38,0x34565c,0,16+floor*11,0,tower,steel);
    for(let x=-18;x<=18;x+=12)for(const z of [-19.2,19.2])solidBox(8,7,.65,0x9dd4cc,x,16+floor*11,z,tower,glass);
    solidBox(60,1.6,44,0xf0eedd,0,21+floor*11,0,tower);
  }
  solidBox(66,2.6,49,0xd8ed9d,0,63,0,tower);
  addWorldLabel('RACE CONTROL',new THREE.Vector3(tower.position.x,56,tower.position.z+23),51,8,'#15383a','#e6f5aa');
  // Luminous circuit signs and numbered corner boards.
  for(let i=0;i<14;i++){
    const u=(i+.22)/14,pt=trackCurve.getPointAt(u),t=trackCurve.getTangentAt(u),nr=new THREE.Vector3(t.z,0,-t.x),sign=pt.clone().addScaledVector(nr,(pt.x*nr.x+pt.z*nr.z)>=0?45:-45);
    solidBox(2.3,8,2.3,0x2c4c4f,sign.x,4,sign.z);
    addWorldLabel(`T${String(i+1).padStart(2,'0')}  /  GHANTA GP`,sign.setY(11),34,6,'#19363b','#dff0a4',getHeading(t));
  }
}

function constrainToCircuit(){
  // Colliders follow the SAME curvilinear corridors used by the visible rails.
  // Entry/exit at any pit is permitted, but accidental driving into the field
  // hits an elastic barrier instead of teleporting through the stadium.
  const track=getTrackClosest(player.x,player.z),pit=nearestPit(player.x,player.z);
  const onService=pit.pit&&pit.dist<PIT_HALF+5;
  const onMain=track.dist<ROAD_HALF+4;
  if(onService||onMain)return;
  const onPitEdge=pit.pit&&pit.dist<PIT_HALF+13&&pit.dist<track.dist;
  const edge=onPitEdge?pit:track,limit=onPitEdge?PIT_HALF+1.4:ROAD_HALF+1.9;
  const d=Math.max(.001,edge.dist),k=limit/d;
  player.x=edge.x+(player.x-edge.x)*k;player.z=edge.z+(player.z-edge.z)*k;
  player.speed*=.70;player.slip*=.35;player.yawRate*=.5;player.driftAmount*=.35;player.incidents=(player.incidents||0)+1;
  // Reduce lateral rotation after an impact, preserving user steering control.
  const tangent=onPitEdge?pit.pit.curve.getTangentAt(pit.u):trackCurve.getTangentAt(track.u);
  const delta=signedAngle(getHeading(tangent),player.heading);
  // No sudden chassis rotation or steering lock on rail contact.
  if(Math.abs(delta)<.75)player.heading+=clamp(delta*.006,-.003,.003);
}

function addTreesAndLandscape(){
  const rand=seededRandom(70917);
  // Lightweight instanced tyre stacks, set back from service-lane entrances.
  const tyres=[];
  for(let i=0;i<225;i++){
    const u=i/225,base=trackCurve.getPointAt(u),t=trackCurve.getTangentAt(u),n=new THREE.Vector3(t.z,0,-t.x);
    for(const side of [-1,1]){
      const p=base.clone().addScaledVector(n,side*37);
      if(stationData.some(lane=>getPitClosest(p.x,p.z,lane).dist<35))continue;
      tyres.push(p);
    }
  }
  const tyreMesh=new THREE.InstancedMesh(new THREE.CylinderGeometry(2.4,2.4,2.1,10),new THREE.MeshStandardMaterial({color:0x233534,roughness:.98}),tyres.length*2);
  const tyreDummy=new THREE.Object3D();
  tyres.forEach((p,i)=>{for(let layer=0;layer<2;layer++){
    tyreDummy.position.set(p.x,1.45+layer*2.1,p.z);tyreDummy.updateMatrix();tyreMesh.setMatrixAt(i*2+layer,tyreDummy.matrix);
    tyreMesh.setColorAt(i*2+layer,new THREE.Color((i%13<3)?0xf1ede0:(i%13<6)?0xbf4d43:0x233534));
  }});
  tyreMesh.instanceMatrix.needsUpdate=true;tyreMesh.castShadow=true;worldObjects.add(tyreMesh);
  const cloudMaterial=new THREE.MeshStandardMaterial({color:0xe4f0e6,transparent:true,opacity:.72,roughness:1,depthWrite:false});
  for(let i=0;i<14;i++){
    const x=(rand()-.5)*1400,z=(rand()-.5)*1100,y=175+rand()*125;
    for(let j=0;j<4;j++){
      const cloud=new THREE.Mesh(new THREE.IcosahedronGeometry(20+rand()*15,1),cloudMaterial);
      cloud.position.set(x+j*15,y+(j%2)*7,z+j*5);cloud.scale.y=.44;worldObjects.add(cloud);
    }
  }

  const treePositions=[];
  for(let i=0;i<690;i++){
    const x=(rand()-.5)*(activeCircuit==='coastal'?2740:1520),z=(rand()-.5)*(activeCircuit==='coastal'?2380:1220);
    if(activeCircuit==='coastal'&&(z< -510||x>1080))continue;
    const trackDist=getTrackClosest(x,z).dist;
    if(trackDist<124)continue;
    if(stationData.some(p=>getPitClosest(x,z,p).dist<90))continue;
    if(activeCircuit==='stadium'&&(Math.abs(x)>870||Math.abs(z)>670))continue;
    const scale=.8+rand()*1.4;
    treePositions.push({x,z,scale,ang:rand()*TWO_PI});
    if(treePositions.length>=320)break;
  }
  sceneryTrees=treePositions;
  // Species-mixed 3D landscaping: rounded hardwood crowns and layered conifers.
  // All foliage is instanced to keep GitHub Pages performant without model downloads.
  const o=new THREE.Object3D();
  const bark=new THREE.MeshStandardMaterial({color:0x64544b,roughness:1});
  const leaves=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.98,flatShading:true});
  const trunkGeo=new THREE.CylinderGeometry(1.5,2.35,15,7),crownAGeo=new THREE.IcosahedronGeometry(10,1),crownBGeo=new THREE.IcosahedronGeometry(8,1),crownCGeo=new THREE.IcosahedronGeometry(7,1);
  const tiles=new Map();
  // Spatial batches allow Three.js to cull entire distant groups. Secondary
  // crowns are the near-detail layer; the primary canopy and trunk stay visible.
  for(let i=0;i<treePositions.length;i++){
    const tr=treePositions[i],cx=Math.floor(tr.x/260)*260+130,cz=Math.floor(tr.z/260)*260+130,key=`${cx}:${cz}`;
    tr.kind=i%4!==0?'oak':'cedar';
    tr.green=new THREE.Color().setHSL(.28+rand()*.11,.35+rand()*.25,.20+rand()*.13);
    if(!tiles.has(key))tiles.set(key,{cx,cz,trees:[]});tiles.get(key).trees.push(tr);
  }
  for(const tile of tiles.values()){
    const group=new THREE.Group();group.position.set(tile.cx,0,tile.cz);worldObjects.add(group);
    const trees=tile.trees.length;
    const trunks=new THREE.InstancedMesh(trunkGeo,bark,trees),crownA=new THREE.InstancedMesh(crownAGeo,leaves,trees),crownB=new THREE.InstancedMesh(crownBGeo,leaves,trees),crownC=new THREE.InstancedMesh(crownCGeo,leaves,trees);
    for(let i=0;i<trees;i++){
      const tr=tile.trees[i],hardwood=tr.kind==='oak',scale=tr.scale,x=tr.x-tile.cx,z=tr.z-tile.cz,green=tr.green;
      o.position.set(x,7.5*scale,z);o.rotation.set(0,tr.ang,0);o.scale.setScalar(scale);o.updateMatrix();trunks.setMatrixAt(i,o.matrix);
      o.position.set(x,hardwood?20*scale:18*scale,z);o.scale.set(scale*(hardwood?1.30:.86),scale*(hardwood?.82:1.6),scale*(hardwood?1.22:.86));o.updateMatrix();crownA.setMatrixAt(i,o.matrix);crownA.setColorAt(i,green);
      o.position.set(x-4*scale,hardwood?25*scale:31*scale,z+2*scale);o.scale.set(scale*(hardwood?.93:.55),scale*(hardwood?.85:1.35),scale*(hardwood?.92:.55));o.updateMatrix();crownB.setMatrixAt(i,o.matrix);crownB.setColorAt(i,green.clone().offsetHSL(.02,.04,.09));
      o.position.set(x+5*scale,hardwood?23*scale:40*scale,z-1.2*scale);o.scale.set(scale*(hardwood?.85:.38),scale*(hardwood?.8:1.15),scale*(hardwood?.85:.38));o.updateMatrix();crownC.setMatrixAt(i,o.matrix);crownC.setColorAt(i,green.clone().offsetHSL(-.02,.02,-.03));
    }
    for(const m of [trunks,crownA,crownB,crownC]){m.instanceMatrix.needsUpdate=true;m.castShadow=true;m.receiveShadow=true;m.computeBoundingSphere();group.add(m);}
    detail(crownB,1.55);detail(crownC,1.1);
  }
  for(const tr of treePositions)delete tr.green;
  // Floodlights and light towers distributed around the circuit.
  for(const u of [.04,.16,.28,.40,.52,.64,.76,.88]){
    const p=trackCurve.getPointAt(u),tan=trackCurve.getTangentAt(u),n=new THREE.Vector3(tan.z,0,-tan.x);
    n.multiplyScalar((p.x*n.x+p.z*n.z)>=0?1:-1);
    const pos=p.clone().addScaledVector(n,53);
    addCylinder(.8,1.5,45,0xb7c9b9,pos.x,22,pos.z);
    const flood=solidBox(17,4,2,0xf7efd5,pos.x,44.5,pos.z);flood.material.emissive=new THREE.Color(0xececc2);flood.material.emissiveIntensity=.2;
    const pole=solidBox(6,.5,2,0x37504b,pos.x,47,pos.z);
  }
  // Landscaped pedestrian promenades and raised concrete planter islands.
  for(let i=0;i<45;i++){
    const x=(rand()-.5)*1620,z=(rand()-.5)*1210;
    if(getTrackClosest(x,z).dist<65||stationData.some(p=>getPitClosest(x,z,p).dist<60))continue;
    const box=solidBox(6+rand()*6,1.8,5+rand()*7,i%2?0x6e8b82:0xa1b2a7,x,.1,z);
    box.rotation.y=rand()*TWO_PI;
  }
  const paddockPos=trackCurve.getPointAt(.96),paddockT=trackCurve.getTangentAt(.96),padSide=new THREE.Vector3(paddockT.z,0,-paddockT.x);
  padSide.multiplyScalar((paddockPos.x*padSide.x+paddockPos.z*padSide.z)>=0?1:-1);
  const pad=paddockPos.clone().addScaledVector(padSide,102);
  const paddockGroup=new THREE.Group();paddockGroup.position.set(pad.x,0,pad.z);paddockGroup.rotation.y=getHeading(paddockT);worldObjects.add(paddockGroup);
  solidBox(136,14,75,0x203c39,0,8,0,paddockGroup);
  solidBox(142,3,83,0xf5efe0,0,17,0,paddockGroup);
  for(let i=-3;i<=3;i++){
    solidBox(17,7,1,0x81a89c,i*19,6,-38,paddockGroup);
    solidBox(14,4,.3,0x28433b,i*19,5.8,-38.6,paddockGroup);
  }
  // Paddock cladding, windows and roof equipment, inside the existing building.
  for(let i=-3;i<=3;i++){
    detail(solidBox(15,2,.35,0xc3d9d7,i*19,11,-38.4,paddockGroup));
    for(let row=0;row<4;row++)detail(solidBox(13,.12,.45,0x607b78,i*19,4.4+row*.85,-38.8,paddockGroup));
  }
  for(const x of [-42,0,42]){solidBox(10,2.5,7,0x70898b,x,20,0,paddockGroup);detail(solidBox(7,.2,4,0x233b45,x,21.4,0,paddockGroup));}
  // Multicoloured paddock flags.
  for(let i=0;i<12;i++){
    const xp=-66+i*12;
    addCylinder(.26,.34,18,0xe0e6db,xp,26,38,paddockGroup,6);
    const flag=solidBox(7,4,.12,CAR_COLOURS[i%CAR_COLOURS.length],xp+3,34,38,paddockGroup);flag.castShadow=false;
  }
  // Sparse trackside advertising walls.
  const slogans=['SMALL CAR / BIG IDEAS','FIND YOUR LINE','DRIVE DIFFERENT','THINK BEYOND','RESEARCH IN MOTION','PIT. READ. REPEAT.'];
  for(let i=0;i<14;i++){
    const u=(i+.27)/14,p=trackCurve.getPointAt(u),t=trackCurve.getTangentAt(u),n=new THREE.Vector3(t.z,0,-t.x);
    const side=(p.x*n.x+p.z*n.z)>=0?1:-1;
    const pos=p.clone().addScaledVector(n,side*36);
    const look=p.clone().sub(pos).normalize(),yaw=Math.atan2(look.x,look.z);
    const m=addWorldLabel(slogans[i%slogans.length],pos.setY(5.5),34,7,i%2?'#d7ecab':'#285749',i%2?'#184038':'#e4eec5',yaw);
    for(const s of [-1,1]){
      const support=m.position.clone().addScaledVector(new THREE.Vector3(t.z,0,-t.x),s*0); // Decorative posts sit below the fixed sign.
    }
  }
}
/* Distinct coastal districts, all scenery kept outside the driving corridor. */
function addCoastalScenery(){
  const rand=seededRandom(523431);
  const safe=(x,z,r)=>clearOfMain({x,z},r)&&clearOfPits({x,z},r);
  const addProp=(x,z,w,h,d,col)=>{const b=solidBox(w,h,d,col,x,h/2-.2,z);coastalProps.push({x,z,w,h,d,col});return b;};
  // The eastern shoreline is beyond all tarmac and service lanes.
  const sea=new THREE.Mesh(new THREE.PlaneGeometry(2100,4400),new THREE.MeshStandardMaterial({color:0x3899b2,roughness:.3,metalness:.12}));sea.rotation.x=-Math.PI/2;sea.position.set(2410,-.24,0);worldObjects.add(sea);
  const beach=solidBox(82,.12,3600,0xe5cfa0,1319,-.31,0);beach.receiveShadow=true;
  for(let i=0;i<90;i++){const x=1380+rand()*1500,z=(rand()-.5)*3600;const foam=solidBox(12+rand()*46,.025,1+rand()*2,0x9bd6da,x,-.19,z);foam.castShadow=false;}
  for(const z of [-650,-270,170,560]){if(!safe(1310,z,18))continue;const deck=solidBox(62,1,12,0xb6a58a,1370,.8,z);deck.castShadow=false;for(let i=0;i<4;i++)addCylinder(1,1,3,0x695a4a,1348+i*14,-.2,z);}
  // Downtown blocks: broad pavements, masonry podiums, glass towers and rows of windows.
  for(let x=-1030;x<=1020;x+=143)for(let z=-1190;z<=-480;z+=142){
    const bx=x+(rand()-.5)*20,bz=z+(rand()-.5)*20,w=53+rand()*35,d=49+rand()*32,h=40+rand()*100;
    if(!safe(bx,bz,Math.hypot(w,d)/2+16))continue;
    const col=[0xa2b7bc,0x688d9c,0xc0b4a1,0x829599,0x567786][Math.floor(rand()*5)];
    const b=addProp(bx,bz,w,h,d,col);solidBox(w+8,1.3,d+8,0xd5d5ca,bx,.6,bz);solidBox(w*.65,4,d*.65,0x637a7b,bx,h+2,bz);
    // Window bands are one mesh per facade row, rather than per window.
    const windows=new THREE.Group();windows.position.set(bx,0,bz);worldObjects.add(windows);detail(windows,1.2);
    for(let y=9;y<h-6;y+=13){for(const side of [-1,1]){solidBox(w*.84,4,.22,0x34596c,0,y,side*(d/2+.16),windows);solidBox(.22,4,d*.84,0x3e6776,side*(w/2+.16),y,0,windows);}}
    b.receiveShadow=true;
  }
  // Country fields, stone barns and rolling green hills outside the track.
  for(let x=-1000;x<1000;x+=190)for(let z=320;z<=1420;z+=180){
    if(!safe(x,z,105))continue;const field=solidBox(150,.09,132,[0x8da350,0xa3ab5e,0x779754,0xb4ae69][Math.floor(rand()*4)],x,-.34,z);field.castShadow=false;
    for(let k=-2;k<=2;k++){const row=solidBox(145,.025,1.2,0x778c4b,x,-.28,z+k*24);row.castShadow=false;}
    if(rand()<.24){addProp(x,z,29,16,22,0xd5c7a6);const roof=solidBox(33,3,25,0x884b3d,x,17,z);roof.castShadow=true;}
  }
  for(const [x,z,r,h] of [[-1850,800,230,90],[-1750,1340,270,125],[-550,1660,270,125],[260,1640,260,100],[890,1600,200,70]]){
    if(!safe(x,z,r))continue;const hill=new THREE.Mesh(new THREE.SphereGeometry(r,24,12),new THREE.MeshStandardMaterial({color:0x73944e,roughness:1}));hill.scale.y=h/r;hill.position.set(x,-9,z);worldObjects.add(hill);
  }
  // A continuous mountain shell with a hollow arch, rather than a flat roof on the city road.
  for(const [from,to] of coastalTunnels){
    const first=Math.ceil(from*TRACK_SAMPLES),last=Math.floor(to*TRACK_SAMPLES),path=trackPoints.slice(first,last+1),normals=getRibbonNormals(path);
    const inner=[],outer=[];
    for(let i=0;i<path.length;i++){
      const point=path[i],n=normals[i],t=i/(path.length-1);
      const row=profile=>profile.map(([offset,y])=>[point.x+n.x*offset,y,point.z+n.z*offset]);
      inner.push(row(tunnelInterior));outer.push(row(mountainProfile(t)));
    }
    const makeSurface=(quads,color)=>{const positions=[],indices=[];for(const q of quads){const k=positions.length/3;for(const v of q)positions.push(...v);indices.push(k,k+1,k+2,k,k+2,k+3);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}));m.castShadow=true;m.receiveShadow=true;worldObjects.add(m);return m;};
    const rock=[],lining=[],portals=[];
    for(let i=0;i<path.length-1;i++)for(let j=0;j<tunnelInterior.length-1;j++){
      rock.push([outer[i][j],outer[i+1][j],outer[i+1][j+1],outer[i][j+1]]);
      lining.push([inner[i][j],inner[i][j+1],inner[i+1][j+1],inner[i+1][j]]);
    }
    for(const i of [0,path.length-1])for(let j=0;j<tunnelInterior.length-1;j++)portals.push([outer[i][j],outer[i][j+1],inner[i][j+1],inner[i][j]]);
    tunnelRoofs.push(makeSurface(rock,0x657652),makeSurface(lining,0x344047),makeSurface(portals,0x777d70));
    // Visible warm lights throughout, with only three movable local lights to limit GPU cost.
    for(let i=first+3;i<last;i+=6){const p=trackPoints[i],lamp=solidBox(12,.8,4,0xffe5b0,p.x,43,p.z);lamp.material.emissive=new THREE.Color(0xffdeb0);lamp.material.emissiveIntensity=3;lamp.rotation.y=-getHeading(trackTangents[i]);lamp.castShadow=false;tunnelRoofs.push(lamp);}
    for(let j=0;j<3;j++){const light=new THREE.PointLight(0xffdfb0,0,100,2);worldObjects.add(light);tunnelLights.push({light,first,last});}
    const p=trackPoints[first],t=trackTangents[first];addWorldLabel('MOUNTAIN TUNNEL',p.clone().setY(53),52,7,'#183a40','#ecf2d0',facingOncoming(t));
  }
  for(const [u,label] of [[.15,'DOWNTOWN'],[.44,'COASTAL DRIVE'],[.65,'COUNTRYSIDE'],[.94,'BACK TO THE GRAND PRIX']]){
    const p=trackPosition(u,-46),t=trackCurve.getTangentAt(u);if(clearOfPits(p,10)){addCylinder(.7,.9,11,0x637879,p.x,5.5,p.z);addWorldLabel(label,p.setY(13),34,6,'#193d42','#e8f3dd',facingOncoming(t));}
  }
}

function makeCar(colour=CAR_COLOURS[0],label='',chassis='apex'){
  const grp=new THREE.Group(),paint=new THREE.MeshStandardMaterial({color:colour,metalness:.16,roughness:.37});
  const dark=new THREE.MeshStandardMaterial({color:0x13262c,metalness:.06,roughness:.55});
  const black=new THREE.MeshStandardMaterial({color:0x0c1517,roughness:.95});
  const pale=new THREE.MeshStandardMaterial({color:0xe4e8da,roughness:.58});
  const light=new THREE.MeshStandardMaterial({color:0xfbf3c0,emissive:0xe0e29c,emissiveIntensity:.45});
  const red=new THREE.MeshStandardMaterial({color:0xf06564,emissive:0xbf333a,emissiveIntensity:.4});
  const shell=new THREE.Group();grp.add(shell);
  function b(w,h,d,x,y,z,mat){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;shell.add(mesh);return mesh;}
  function bevelBody(w,h,d,x,y,z,mat,r=.28){
    const hw=w/2-r,hd=d/2-r,depth=h-2*r,shape=new THREE.Shape();
    shape.moveTo(-hw,-hd);shape.lineTo(hw,-hd);shape.lineTo(hw,hd);shape.lineTo(-hw,hd);shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:r,bevelSize:r,bevelSegments:2,steps:1});
    geo.rotateX(-Math.PI/2);geo.translate(0,-depth/2,0);
    const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;shell.add(mesh);return mesh;
  }
  bevelBody(8,1.3,15,0,2.4,0,dark,.18);
  const shape={apex:[7.4,2.2,12.5],velocity:[6.1,1.55,14.1],switchback:[8.5,1.8,11.7],volt:[6.8,2.55,10.8],sentinel:[8.2,2.8,13.2]}[chassis]||[7.4,2.2,12.5];
  bevelBody(...shape,0,3.7,-.3,paint,.35);
  if(chassis==='velocity'){bevelBody(4.1,1.1,5.4,0,3.6,-6,paint,.22);b(10,.45,2.2,0,6.8,7,paint);}
  if(chassis==='switchback')for(const x of [-3.9,3.9])bevelBody(1.7,1.15,8,x,3.6,0,paint,.24);
  if(chassis==='volt'){bevelBody(5.2,1.1,4.5,0,6.4,1,paint,.22);b(6,.45,2,0,4,-6.2,pale);}
  if(chassis==='sentinel'){b(9.5,1.25,2.1,0,3.7,-6.8,paint);b(8,.65,2.4,0,7.2,5.8,dark);}
  bevelBody(6.5,2.1,5,0,5.15,1.2,dark,.22);
  bevelBody(6,1.2,3.5,0,6.2,2,paint,.18);
  b(5.5,.45,3.2,0,6.9,1.4,dark);
  b(9,1,2,0,3.0,-7.0,dark);
  b(9,1,2,0,3.0,7.1,dark);
  b(8,.5,3,0,6.4,6.4,paint);
  b(1,3,.8,-3.3,5.6,6.2,dark);b(1,3,.8,3.3,5.6,6.2,dark);
  b(2,.65,.45,-2.2,4.2,-7.2,light);b(2,.65,.45,2.2,4.2,-7.2,light);
  b(2,.65,.45,-2.2,4.2,7.2,red);b(2,.65,.45,2.2,4.2,7.2,red);
  const metal=new THREE.MeshStandardMaterial({color:0xb9c4c4,metalness:.72,roughness:.4});
  const glass=new THREE.MeshStandardMaterial({color:0x244850,metalness:.2,roughness:.22});
  b(5.8,.15,2.2,0,5.9,-.75,glass).rotation.x=-.3;
  for(const x of [-3.35,3.35]){
    b(.15,1.05,3.5,x,5.5,1.3,glass);
    b(.4,.8,5.6,x,2.4,0,dark);
    b(1.25,.35,1.8,x*1.07,4.6,-1.8,paint);
    b(.85,.85,.55,x*1.07,4.4,-1.8,dark);
    b(.4,.4,2.3,x,3,-5.1,metal);
    b(.4,.4,2.3,x,3,5.1,metal);
  }
  b(4.8,.75,.25,0,3.85,-7.3,dark);
  for(let j=0;j<5;j++)b(.12,.54,.32,-1.8+j*.9,3.85,-7.45,metal);
  b(2.2,.55,.45,0,3.5,7.85,metal);
  b(5.9,.2,1,0,4.88,-4.1,pale);
  const frontWheels=[],wheelSpins=[],wheelPivots=[];
  const tyreGeo=new THREE.CylinderGeometry(2.2,2.2,2,24);
  const rimGeo=new THREE.CylinderGeometry(1.35,1.35,2.06,20);
  const hubGeo=new THREE.CylinderGeometry(.42,.42,2.18,12);
  const treadGeo=new THREE.BoxGeometry(1.65,.13,.36);
  for(const x of [-4.3,4.3])for(const z of [-4.8,4.8]){
    const pivot=new THREE.Group();pivot.position.set(x,2.3,z);grp.add(pivot);wheelPivots.push(pivot);
    const spin=new THREE.Group();pivot.add(spin);wheelSpins.push(spin);
    const wheel=new THREE.Mesh(tyreGeo,black);wheel.rotation.z=Math.PI/2;wheel.castShadow=true;spin.add(wheel);
    const rim=new THREE.Mesh(rimGeo,metal);rim.rotation.z=Math.PI/2;spin.add(rim);
    const hub=new THREE.Mesh(hubGeo,dark);hub.rotation.z=Math.PI/2;spin.add(hub);
    // Instanced tread ribs rotate with the wheel, with no per-rib draw calls.
    const tread=new THREE.InstancedMesh(treadGeo,dark,16),dummy=new THREE.Object3D();
    for(let j=0;j<16;j++){const a=j*TWO_PI/16;dummy.position.set(0,Math.cos(a)*2.19,Math.sin(a)*2.19);dummy.rotation.set(a,0,0);dummy.updateMatrix();tread.setMatrixAt(j,dummy.matrix);}spin.add(tread);
    if(z<0)frontWheels.push(pivot);
    // Visible suspension strut between chassis and hub.
    const strut=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,2.1,8),metal);strut.position.set(x*.82,3,z);strut.rotation.z=-Math.sign(x)*.30;shell.add(strut);
  }
  Object.assign(grp.userData,{frontWheels,wheelSpins,wheelPivots,shell,brakeMaterial:red,lastSpeed:0,visualSteer:0});
  const stunCloud=makeStunCloud();stunCloud.visible=false;stunCloud.position.set(0,19,0);grp.add(stunCloud);grp.userData.stunCloud=stunCloud;
  const shield=new THREE.Mesh(new THREE.SphereGeometry(12,16,12),new THREE.MeshBasicMaterial({color:0x8fe7ff,transparent:true,opacity:.18,depthWrite:false,wireframe:true}));shield.position.y=5;shield.visible=false;grp.add(shield);grp.userData.shield=shield;
  const antenna=b(.18,11,.18,2.2,11.6,4.8,dark);
  const antennaBall=new THREE.Mesh(new THREE.SphereGeometry(.7,8,8),red);antennaBall.position.set(2.2,17,4.8);shell.add(antennaBall);
  const sc=document.createElement('canvas');sc.width=sc.height=64;const ctx=sc.getContext('2d'),grad=ctx.createRadialGradient(32,32,8,32,32,32);
  grad.addColorStop(0,'rgba(12,20,18,.56)');grad.addColorStop(.55,'rgba(12,20,18,.30)');grad.addColorStop(1,'rgba(12,20,18,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,64,64);
  const st=new THREE.CanvasTexture(sc);st.colorSpace=THREE.SRGBColorSpace;
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(17,22),new THREE.MeshBasicMaterial({map:st,transparent:true,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2;shadow.position.y=.28;grp.add(shadow);
  grp.scale.setScalar(.54); // true RC-sized vehicle relative to a full race lane
  if(label){
    const text=makeLabelTexture([label.slice(0,18)],'#e2f7b0','#12342d',512,104);
    const nametag=new THREE.Sprite(new THREE.SpriteMaterial({map:text,depthTest:false}));
    nametag.position.set(0,19,0);nametag.scale.set(26,6,1);grp.add(nametag);
  }
  return grp;
}
function animateCar(car,speed,steer,braking,dt){
  if(!car)return;const d=car.userData;
  const acceleration=clamp((speed-d.lastSpeed)/Math.max(dt,.001),-85,85);d.lastSpeed=speed;
  const turn=clamp(steer*Math.abs(speed)/65,-.45,.45);
  if(d.shell){d.shell.rotation.z=THREE.MathUtils.damp(d.shell.rotation.z,turn*.19,8,dt);d.shell.rotation.x=THREE.MathUtils.damp(d.shell.rotation.x,acceleration*.0013,8,dt);}
  for(const wheel of d.wheelSpins||[])wheel.rotation.x-=speed*dt/(2.2*.54);
  for(const pivot of d.wheelPivots||[]){const y=2.3+Math.sin(pivot.position.z*.6+speed*.02+performance.now()*.014)*Math.min(.09,Math.abs(speed)*.0015);pivot.position.y=THREE.MathUtils.damp(pivot.position.y,y,12,dt);}
  if(d.brakeMaterial)d.brakeMaterial.emissiveIntensity=braking?1.2:.24;
}
function setCarPose(car,x,z,heading,steering=0){
  if(!car)return;
  car.position.set(x,0,z);
  // Physics uses +heading clockwise from world -Z; Three.js rotates +Y the
  // other way. This sign mismatch made the bonnet point opposite the velocity.
  car.rotation.y=-heading;
  for(const frontWheel of (car.userData.frontWheels||[]))frontWheel.rotation.y=-steering;
}
// Arcade combat uses four per-driver pickup clocks. A collected tile remains
// available to every other racer, and respawns globally after 10s.
function makeStunCloud(){
  const group=new THREE.Group();
  const tones=[0xf0f1e9,0xdde9e3,0xc0d5d2,0xe9f0ea,0xd6dfda];
  const coordinates=[[-5,0,0],[0,2,0],[5,0,0],[-2,3,3],[3,3,-3]];
  coordinates.forEach(([x,y,z],i)=>{
    const ball=new THREE.Mesh(new THREE.SphereGeometry(i===1?4.3:3.4,10,8),new THREE.MeshBasicMaterial({color:tones[i],transparent:true,opacity:.83,depthWrite:false}));
    ball.position.set(x,y,z);group.add(ball);
  });
  return group;
}
function createBombPickups(){
  combat.pickupMeshes=[];
  for(const pickup of BOMB_PICKUPS){
    const group=new THREE.Group();group.position.set(pickup.pos.x,0,pickup.pos.z);
    const pad=new THREE.Mesh(new THREE.CylinderGeometry(5.7,5.7,.45,6),new THREE.MeshStandardMaterial({color:0x5abbbb,emissive:0x246d77,emissiveIntensity:.5}));pad.position.y=.4;group.add(pad);
    const box=new THREE.Group();box.position.y=5.5;group.add(box);
    const cube=new THREE.Mesh(new THREE.BoxGeometry(6.8,6.8,6.8),new THREE.MeshStandardMaterial({color:0x4bb7ce,emissive:0x16465d,emissiveIntensity:.8,transparent:true,opacity:.86}));box.add(cube);
    const label=makeLabelTexture(['?'],'#ffffff','#24778b',128,128);
    for(const r of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const face=new THREE.Mesh(new THREE.PlaneGeometry(5.6,5.6),new THREE.MeshBasicMaterial({map:label,transparent:true}));face.rotation.y=r;face.position.set(Math.sin(r)*3.43,0,Math.cos(r)*3.43);box.add(face);}
    group.userData.bomb=box;worldObjects.add(group);combat.pickupMeshes.push(group);
  }
  combat.pitMarkers=[];for(const pit of stationData){const p=pit.curve.getPointAt(.5),heading=getHeading(pit.curve.getTangentAt(.5));const mark=new THREE.Mesh(new THREE.PlaneGeometry(17,24),new THREE.MeshBasicMaterial({color:0xc7e881,transparent:true,opacity:.27,depthWrite:false}));mark.rotation.set(-Math.PI/2,0,-heading);mark.position.set(p.x,.19,p.z);worldObjects.add(mark);combat.pitMarkers.push(mark);}
}
function resetCombatRound(roster=[]){
  combat.held=null;combat.readyAt=Array(BOMB_PICKUPS.length).fill(0);combat.pending=-1;combat.requestAt=0;
  for(const shot of [...combat.projectiles,...(combat.oils||[])])if(shot.mesh){shot.mesh.parent?.remove(shot.mesh);disposeObject(shot.mesh);}
  combat.projectiles=[];combat.oils=[];combat.shotIds=new Set();combat.nextShot=0;combat.localStunUntil=0;
  combat.hostInventory=new Map();combat.pendingFire=false;
  for(const p of roster)if(p?.id)combat.hostInventory.set(p.id,newRecord(p.setup));
  localEffects={};draftTime=0;draftUntil=0;draftCooldown=0;pitDraft=null;pitPending=false;
  localEngineering={stats:[...garageSetup.stats],rep:0,credits:0,earned:0,spent:0};
  if($('pitOverlay'))$('pitOverlay').hidden=true;
  for(const op of opponents.values()){op.stunnedUntil=0;op.shieldUntil=0;}
  updateBombHud();
}
function getLocalId(){return raceState.peer?.id||'local';}
function getHostInventory(id){if(!combat.hostInventory.has(id))combat.hostInventory.set(id,newRecord(id===getLocalId()?garageSetup:raceState.remote.get(id)?.setup));return combat.hostInventory.get(id);}
function recordPacket(id){const r=getHostInventory(id);return {type:'engineering',round:raceState.round,id,stats:r.setup.stats,rep:r.rep,credits:r.credits,earned:r.earned,spent:r.spent};}
function syncRecord(id){const packet=recordPacket(id);if(id===getLocalId())applyEngineering(packet);else send(raceState.connections.get(id),packet);}
function applyEngineering(msg){localEngineering={stats:[...msg.stats],rep:msg.rep,credits:msg.credits,earned:msg.earned,spent:msg.spent};player.stats=localEngineering.stats;updateRivalsHud();}
function publish(packet){if(raceState.role==='host')broadcast(packet);}
function privatePacket(id,packet){if(id===getLocalId())receiveRivals(packet);else send(raceState.connections.get(id),packet);}
function receiveRivals(msg){
  if(msg.type==='engineering')applyEngineering(msg);
  if(msg.type==='skill-credit'){announce(`${msg.label.toUpperCase()} · +1 SC`,1.5);}
  if(msg.type==='box-state'){combat.readyAt=msg.remaining.map(n=>Date.now()+Math.max(0,n));}
  if(msg.type==='effect')applyEffect(msg);
  if(msg.type==='discarded'){combat.held=null;combat.pendingFire=false;updateBombHud();announce('ITEM DISCARDED',1);}
  if(msg.type==='oil')receiveOil(msg);
  if(msg.type==='oil-remove')removeOil(msg.id);
  if(msg.type==='pit-result'){pitPending=false;if(msg.ok){$('pitOverlay').hidden=true;pitDraft=null;player.serviceUntil=Date.now()+2000;$('raceMain').focus?.({preventScroll:true});announce('ENGINEERING SERVICE · 2 SECONDS',2);}else{renderPit();$('pitMessage').textContent=msg.reason||'Tuning rejected. Try again.';}}
}
function updateBombHud(){
  const element=$('bombValue');if(!element)return;
  const enabled=arcadeItems();for(const id of ['bombHud','throwButton','touchBomb','bombHelp'])$(id).hidden=!enabled;
  element.textContent=ITEMS[combat.held]||'EMPTY';element.classList.toggle('armed',!!combat.held);
  $('throwButton').disabled=!combat.held||!raceStarted||player.finished;$('touchBomb').disabled=$('throwButton').disabled;$('discardItem').hidden=!enabled||!combat.held;$('discardItem').disabled=$('throwButton').disabled;
  updateRivalsHud();
}
function checkBombPickup(){
  if(!arcadeItems()||!raceStarted||player.finished||combat.held||combat.pending>=0||player.speed<8)return;
  const now=Date.now();
  for(const pickup of BOMB_PICKUPS){
    if(combat.readyAt[pickup.index]>now||Math.hypot(player.x-pickup.pos.x,player.z-pickup.pos.z)>8.5)continue;
    if(raceState.role==='guest'){
      if(now-combat.requestAt<420)return;
      combat.pending=pickup.index;combat.requestAt=now;
      send(raceState.hostConn,{type:'pickup-request',round:raceState.round,index:pickup.index});
      const round=raceState.round;setTimeout(()=>{if(round===raceState.round&&combat.pending===pickup.index)combat.pending=-1;},1000);
    }else hostTryPickup(getLocalId(),pickup.index,player);
    return;
  }
}
function boxPacket(){return {type:'box-state',round:raceState.round,remaining:combat.readyAt.map(t=>Math.max(0,t-Date.now()))};}
function hostTryPickup(id,index,point){
  if(!raceStarted||!arcadeItems()||!Number.isInteger(index)||index<0||index>=BOMB_PICKUPS.length||!point||point.finished||point.speed<8)return;
  const record=getHostInventory(id),pickup=BOMB_PICKUPS[index],now=Date.now();
  if(Math.hypot(point.x-pickup.pos.x,point.z-pickup.pos.z)>17)return;
  const positions=[...combatPositions().entries()].filter(([_,p])=>!p.finished);
  const item=claimBox(combat.readyAt,record,index,now,0,raceState.role!=='solo'||positions.length>1);if(!item)return;
  publish(boxPacket());const packet={type:'pickup-granted',round:raceState.round,index,item};
  if(id===getLocalId())receivePickup(packet);else send(raceState.connections.get(id),packet);
}
function receivePickup(msg){if(!Object.hasOwn(ITEMS,msg.item))return;audio.cue('pickup');combat.pending=-1;combat.held=msg.item;announce(`${ITEMS[msg.item].toUpperCase()} COLLECTED · L TO USE`,1.9);updateBombHud();}
function combatPositions(){
  const positions=new Map([[getLocalId(),{x:player.x,z:player.z,heading:player.heading,speed:player.speed,lap:player.lap,finished:player.finished}]]);
  if(raceState.role==='host'){
    for(const [id,p] of (raceState._latest||new Map()))if(Date.now()-(p.received||0)<1800)positions.set(id,p);
  }else for(const [id,op] of opponents)positions.set(id,op);
  return positions;
}
function chooseBombTarget(shooterId,origin,positions){
  let bestId=null,bestScore=Infinity;
  for(const [id,target] of positions){
    if(id===shooterId||!target||target.finished||protectedPit(target)||!Number.isFinite(target.x)||!Number.isFinite(target.z))continue;
    const dx=target.x-origin.x,dz=target.z-origin.z,d=Math.hypot(dx,dz);
    if(d<8||d>BOMB_RANGE)continue;
    const alignment=(dx*Math.sin(origin.heading)-dz*Math.cos(origin.heading))/d;
    if(alignment<.68)continue; // car must be in a 94-degree forward cone
    const score=d+(1-alignment)*65;
    if(score<bestScore){bestScore=score;bestId=id;}
  }
  return bestId;
}
function fireBomb(){
  if(!arcadeItems()||!raceStarted||player.finished||!keysAllowed()||!combat.held||combat.pendingFire||protectedPit(player))return;
  if(raceState.role==='guest'){
    combat.pendingFire=true;
    send(raceState.hostConn,{type:'bomb-request',round:raceState.round});
    const round=raceState.round;setTimeout(()=>{if(round===raceState.round)combat.pendingFire=false;},1150);
  }else hostFireBomb(getLocalId());
}
function discardItem(){if(!arcadeItems()||!raceStarted||!combat.held||player.finished||!keysAllowed()||combat.pendingFire)return;if(raceState.role==='guest'){send(raceState.hostConn,{type:'discard-item',round:raceState.round});}else hostDiscard(getLocalId());}
function hostDiscard(id){if(!arcadeItems()||!raceStarted)return;const r=getHostInventory(id);if(!r.held)return;r.held=null;privatePacket(id,{type:'discarded',round:raceState.round});}
function protectedPit(p){const pit=nearestPit(p.x,p.z);return pit.dist<PIT_HALF+2&&pit.u>.20&&pit.u<.80&&getTrackClosest(p.x,p.z).dist>ROAD_HALF;}
function hostFireBomb(id){
  if(!raceStarted||!arcadeItems())return;
  const record=getHostInventory(id),item=record.held;if(!item)return;
  const positions=combatPositions(),origin=positions.get(id);
  if(!origin||origin.finished||protectedPit(origin)||!Number.isFinite(origin.heading))return;
  const targetId=item==='bomb'?chooseBombTarget(id,origin,positions):null;
  if(item==='bomb'&&!targetId){privatePacket(id,{type:'effect',round:raceState.round,target:id,effect:'no-target',duration:0});return;}
  record.held=null;
  if(item==='bomb'){
    const packet={type:'bomb-fired',round:raceState.round,id:`${raceState.round}-${id}-${++combat.nextShot}`,shooter:id,target:targetId,x:origin.x+Math.sin(origin.heading)*11,z:origin.z-Math.cos(origin.heading)*11,heading:origin.heading};
    receiveBombFired(packet);publish(packet);return;
  }
  if(item==='oil'){
    const packet={type:'oil',round:raceState.round,id:`oil-${raceState.round}-${++combat.nextShot}`,owner:id,x:origin.x-Math.sin(origin.heading)*12,z:origin.z+Math.cos(origin.heading)*12};receiveOil(packet);publish(packet);
    effect(id,'used',0,item);return;
  }
  effect(id,item,{turbo:3000,shield:8000,grip:6000,recharge:0}[item],item);
}
function effect(id,name,duration,used=null){
  const r=getHostInventory(id);if(duration)r.effects[name]=Date.now()+duration;
  const packet={type:'effect',round:raceState.round,target:id,effect:name,duration,used};applyEffect(packet);publish(packet);
}
function applyEffect(msg){
  if(msg.target===getLocalId()){
    if(msg.effect==='no-target'){combat.pendingFire=false;announce('NO TARGET AHEAD · KEEP YOUR ITEM',1.4);return;}
    if(msg.used){combat.held=null;combat.pendingFire=false;announce(`${ITEMS[msg.used].toUpperCase()} ACTIVATED`,1.4);}
    if(msg.effect==='recharge')player.boost=Math.min(1,player.boost+.6);
    if(msg.effect==='shield-end')localEffects.shield=0;
    else if(msg.duration)localEffects[msg.effect]=Date.now()+msg.duration;
    if(msg.effect==='slow'){audio.cue('hit');combat.localStunUntil=Date.now()+msg.duration;player.speed*=.55;announce('HIT · RECOVER YOUR SPEED',1.4);}
    if(msg.effect==='slippery')announce('SLIPPERY SURFACE',1.4);
    if(msg.effect==='shield-end')announce('SHIELD BLOCKED AN ATTACK',1.4);
    updateBombHud();
  }else{const op=opponents.get(msg.target);if(op){if(msg.effect==='shield')op.shieldUntil=Date.now()+msg.duration;if(msg.effect==='shield-end')op.shieldUntil=0;if(msg.effect==='slow')op.stunnedUntil=Date.now()+msg.duration;}}
}
function receiveOil(msg){if(combat.oils.some(o=>o.id===msg.id))return;const mesh=new THREE.Mesh(new THREE.CircleGeometry(8,20),new THREE.MeshBasicMaterial({color:0x17252e,transparent:true,opacity:.85,depthWrite:false}));mesh.rotation.x=-Math.PI/2;mesh.position.set(msg.x,.23,msg.z);scene.add(mesh);combat.oils.push({...msg,mesh,until:Date.now()+10000});}
function removeOil(id){const i=combat.oils.findIndex(o=>o.id===id);if(i>=0){const [o]=combat.oils.splice(i,1);scene.remove(o.mesh);disposeObject(o.mesh);}}
function skillAward(id,key,label,category='drive'){if(!engineeringEnabled())return;const r=getHostInventory(id);if(r.finished)return;if(award(r,key,category)){syncRecord(id);privatePacket(id,{type:'skill-credit',round:raceState.round,label});}}
function attackHit(id,shooter,kind){const r=getHostInventory(id),now=Date.now();if((r.effects.immune||0)>now)return;
  r.effects.immune=now+3200;effect(id,'immune',3200);
  if((r.effects.shield||0)>now){r.effects.shield=0;r.defences++;effect(id,'shield-end',0);skillAward(id,'combat-defence','Shield defence','combat');}
  else{getHostInventory(shooter).attacks++;effect(id,kind==='oil'?'slippery':'slow',kind==='oil'?1700:BOMB_STUN_MS);skillAward(shooter,'combat-attack','Successful power-up','combat');}}

function createBombMesh(){
  const grp=new THREE.Group();
  const sphere=new THREE.Mesh(new THREE.SphereGeometry(3.6,16,12),new THREE.MeshStandardMaterial({color:0x152429,metalness:.5,roughness:.24}));grp.add(sphere);
  const fuse=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,2.6,8),new THREE.MeshBasicMaterial({color:0xffc45d}));fuse.position.y=4;grp.add(fuse);
  const flame=new THREE.Mesh(new THREE.SphereGeometry(.95,8,8),new THREE.MeshBasicMaterial({color:0xffffba}));flame.position.y=5.5;grp.add(flame);
  scene.add(grp);return grp;
}
function receiveBombFired(msg){
  if(typeof msg.id!=='string'||combat.shotIds.has(msg.id)||!Number.isFinite(msg.x)||!Number.isFinite(msg.z))return;
  combat.shotIds.add(msg.id);
  const shot={id:msg.id,x:msg.x,z:msg.z,heading:msg.heading||0,shooter:msg.shooter,target:msg.target,age:0,mesh:createBombMesh(),alive:true};
  combat.projectiles.push(shot);
  if(msg.target===getLocalId())announce("INCOMING ATTACK · STEER OR SHIELD",1.5);
  if(msg.shooter===getLocalId()){
    combat.held=null;combat.pendingFire=false;updateBombHud();
    announce('HOMING BOMB AWAY!',1.1);
  }
}
function applyBombHit(msg){const shot=combat.projectiles.find(p=>p.id===msg.id);if(shot)shot.alive=false;}
function updateCombat(dt,now){
  const actualNow=Date.now();
  if(raceMode!=='arcade')return;
  for(const mark of combat.pitMarkers||[])mark.visible=engineeringEnabled();
  if(player.mesh?.userData.shield)player.mesh.userData.shield.visible=arcadeItems()&&actualNow<(localEffects.shield||0);
  for(const op of opponents.values())if(op.mesh?.userData.shield)op.mesh.userData.shield.visible=arcadeItems()&&actualNow<(op.shieldUntil||0);
  for(const [i,group] of combat.pickupMeshes.entries()){
    if(!group)continue;
    group.visible=arcadeItems()&&raceStarted&&actualNow>=combat.readyAt[i];
    group.userData.bomb.rotation.y+=dt*.95;
    group.userData.bomb.position.y=5.5+Math.sin(now*.003+i*1.7)*.8;
  }
  if(player.mesh?.userData.stunCloud){
    const cloud=player.mesh.userData.stunCloud;
    cloud.visible=actualNow<combat.localStunUntil;
    if(cloud.visible)cloud.rotation.y+=dt*.8;
  }
  for(const op of opponents.values()){
    const cloud=op.mesh?.userData.stunCloud;
    if(cloud){cloud.visible=actualNow<(op.stunnedUntil||0);if(cloud.visible)cloud.rotation.y+=dt*.8;}
  }
  const participants=(raceState.role==='guest'?null:combatPositions());
  for(const oil of [...(combat.oils||[])]){
    let hit=false;if(participants&&actualNow<oil.until)for(const [id,p] of participants){if(id!==oil.owner&&!p.finished&&!protectedPit(p)&&Math.hypot(p.x-oil.x,p.z-oil.z)<8){attackHit(id,oil.owner,'oil');hit=true;break;}}
    if(hit||actualNow>=oil.until){removeOil(oil.id);if(participants)publish({type:'oil-remove',round:raceState.round,id:oil.id});}
  }
  for(let i=combat.projectiles.length-1;i>=0;i--){
    const shot=combat.projectiles[i];shot.age+=dt;
    const target=participants?.get(shot.target)||opponents.get(shot.target);
    if(shot.alive&&target){
      const desired=Math.atan2(target.x-shot.x,-(target.z-shot.z));
      shot.heading+=clamp(signedAngle(desired,shot.heading),-2.7*dt,2.7*dt);
    }
    const distance=175*dt;
    shot.x+=Math.sin(shot.heading)*distance;shot.z-=Math.cos(shot.heading)*distance;
    if(shot.mesh){shot.mesh.position.set(shot.x,6.3+Math.sin(shot.age*11)*1.6,shot.z);shot.mesh.rotation.y+=dt*5;}
    if(shot.alive&&participants&&shot.target){
      const victim=participants.get(shot.target);
      if(victim&&!victim.finished&&!protectedPit(victim)&&Math.hypot(shot.x-victim.x,shot.z-victim.z)<9){
        attackHit(shot.target,shot.shooter,'bomb');
        const hit={type:'bomb-hit',round:raceState.round,id:shot.id,target:shot.target};
        applyBombHit(hit);if(raceState.role==='host')broadcast(hit);
      }
    }
    if(shot.alive&&shot.age>3.2&&participants&&shot.target&&participants.has(shot.target)&&!participants.get(shot.target).finished&&!protectedPit(participants.get(shot.target))){const r=getHostInventory(shot.target);r.defences++;skillAward(shot.target,'combat-evade','Attack evasion','combat');}
    if(!shot.alive||shot.age>3.2){
      if(shot.mesh){scene.remove(shot.mesh);disposeObject(shot.mesh);}
      combat.projectiles.splice(i,1);
    }
  }
}

function newScene(){
  if(!renderer){
    renderer=new THREE.WebGLRenderer({canvas:viewport,antialias:true,alpha:false,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.25));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;
    camera=new THREE.PerspectiveCamera(62,1,2,4500);
    window.addEventListener('resize',resizeRenderer,{passive:true});
  }
  if(scene){sun?.shadow?.map?.dispose();disposeObject(scene);scene.clear();}
  scene=new THREE.Scene();scene.background=new THREE.Color(0xb9d6e5);scene.fog=new THREE.FogExp2(0xc0d3dc,.00044);
  detailObjects=[];cameraHeading=null;tunnelRoofs=[];coastalProps=[];tunnelLights=[];
  const skyGeometry=new THREE.SphereGeometry(2500,32,16),skyColors=[],skyPositions=skyGeometry.attributes.position;
  const horizon=new THREE.Color(0xc4d9e3),zenith=new THREE.Color(0x6097c7);
  for(let i=0;i<skyPositions.count;i++){const c=horizon.clone().lerp(zenith,Math.pow(clamp(skyPositions.getY(i)/2500,0,1),.65));skyColors.push(c.r,c.g,c.b);}
  skyGeometry.setAttribute('color',new THREE.Float32BufferAttribute(skyColors,3));
  skyDome=new THREE.Mesh(skyGeometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,depthWrite:false,fog:false,toneMapped:false}));skyDome.frustumCulled=false;skyDome.renderOrder=-100;scene.add(skyDome);
  ambientSky=new THREE.HemisphereLight(0xe1edff,0x7a8560,1.45);scene.add(ambientSky);
  sun=new THREE.DirectionalLight(0xffedce,2.55);sun.position.set(-160,300,210);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);
  sun.shadow.camera.left=-240;sun.shadow.camera.right=240;sun.shadow.camera.top=240;sun.shadow.camera.bottom=-240;sun.shadow.camera.near=5;sun.shadow.camera.far=850;sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.00016;sun.shadow.normalBias=.45;scene.add(sun,sun.target);
  ambientFill=new THREE.DirectionalLight(0xc6e0ff,.24);ambientFill.position.set(300,130,-300);scene.add(ambientFill);
  stadiumDecor.grandstands.length=0;
  worldObjects=new THREE.Group();scene.add(worldObjects);
  combat.pickupMeshes=[];combat.pitMarkers=[];
  addTrack();
  stationData.forEach(createServiceLane);
  if(raceMode==='arcade'){placeArcadeBoostPads();createBombPickups();}
  addTreesAndLandscape();
  addGuardRails();
  addStadiumArchitecture();
  if(activeCircuit==='coastal')addCoastalScenery();
  player.mesh=makeCar(player.colour,'',raceMode==='tour'?'apex':garageSetup.chassis);scene.add(player.mesh);
  for(const state of opponents.values()){state.mesh=makeCar(state.colour,state.name,state.setup?.chassis);scene.add(state.mesh);state.visualReady=false;}
  applyQuality();
  compatibilityRenderer=new CompatibilityTrackRenderer($('compatCanvas'),trackPoints,trackTangents);
  compatibilityRenderer.setCircuit(activeCircuit,coastalProps);
  compatibilityRenderer.setPits(stationData);
  compatibilityRenderer.setTrees(sceneryTrees);
  compatibilityRenderer.setGrandstands(stadiumDecor.grandstands);
  rendererCheckCount=0;rendererBlankCount=0;lastRendererCheck=0;
  sceneReady=true;
  if(compatibilityForced)setCompatibility(true,'Requested by URL');
}
function disposeObject(root){
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(o=>{
    if(o.geometry)geometries.add(o.geometry);
    if(o.material)for(const mat of (Array.isArray(o.material)?o.material:[o.material])){materials.add(mat);if(mat.map)textures.add(mat.map);}
  });
  for(const geo of geometries)geo.dispose();for(const mat of materials)mat.dispose();for(const texture of textures)texture.dispose();
}
function resizeRenderer(){
  if(!renderer)return;
  const rect=viewport.getBoundingClientRect();if(rect.width<1||rect.height<1)return;
  renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();
}
function resetPlayer(u=INITIAL_POS,full=true){
  const pos=trackCurve.getPointAt(u),t=trackCurve.getTangentAt(u);
  player.x=pos.x;player.z=pos.z;player.heading=getHeading(t);player.speed=0;resetDrive(player);cameraHeading=null;
  player.u=u;player.priorU=u;player.travel=0;player.lap=0;player.lapAt=0;player.elapsed=0;player.lastLap=0;player.fastest=Infinity;
  player.pitVisit=null;player.inPit=false;player.offRoad=false;player.serviceUntil=0;player.finished=false;player.boost=1;player.steer=0;player.steerAngle=0;clearKeys();player._fuelWarn=false;player._emptyWarn=false;
  if(full)player.fuel=1;
  inspector=null;cameraMode=0;$('cameraName').textContent='CHASE';
  localFinishTime=null;setCarPose(player.mesh,player.x,player.z,player.heading,player.steerAngle||0);
  camera.position.set(player.x+40,46,player.z+85);
  vectors.currentTarget.set(player.x,4,player.z);
  updateDashboard();
}
function placeCarOnLane(pit,q=.08){
  const p=pit.curve.getPointAt(q),t=pit.curve.getTangentAt(q);
  player.x=p.x;player.z=p.z;player.heading=getHeading(t);player.speed=0;resetDrive(player);cameraHeading=null;player.steer=0;player.steerAngle=0;player.pitVisit=null;player.inPit=true;
  player.priorU=(pit.startT+pit.span*q+1)%1;player.u=player.priorU;
  inspector=null;setCarPose(player.mesh,player.x,player.z,player.heading,player.steerAngle||0);
}
function setMode(mode){
  const changed=selectCircuit(mode==='tour'?'stadium':raceSettings.circuit);
  if(raceMode===mode&&gameRunning&&!changed){
    raceEnded=false;raceStarted=mode==='tour';countdownEnd=0;resetPlayer();
    $('finishOverlay').hidden=true;$('lobbyOverlay').hidden=true;$('welcomeOverlay').hidden=true;
    return;
  }
  worldVersion++;
  raceMode=mode;gameRunning=true;raceEnded=false;raceStarted=mode==='tour';countdownEnd=0;lastModeChange=performance.now();
  if(mode==='tour'){setHudHidden(false);player.colour=CAR_COLOURS[0];player.hex=PAINTS[0];player.chassis='apex';}
  setupPits(mode==='tour'?resume.length:CIRCUITS[activeCircuit].pitCount);
  newScene();resetPlayer();
  $('modeLabel').textContent=mode==='tour'?'PADDOCK / RÉSUMÉ TOUR':'ARCADE / GRAND PRIX';
  $('lapLabel').textContent=mode==='tour'?'LAPS DRIVEN':'RACE LAPS';
  $('fuelHint').textContent='≈ 2 full-speed laps / tank';
  $('boostHud').hidden=mode!=='arcade';
  $('bombHud').hidden=mode!=='arcade';$('throwButton').hidden=mode!=='arcade';$('touchBomb').hidden=mode!=='arcade';
  $('pitCount').textContent=`${stationData.length} PIT STOP${stationData.length===1?'':'S'}`;
  $('trackLabel').textContent=CIRCUITS[activeCircuit].name.toUpperCase();
  $('mapMode').textContent=mode==='tour'?`${stationData.length} STOPS`:'ARCADE';
  $('raceLeftInfo').hidden=false;
  $('showGuide').hidden=mode!=='tour';
  $('raceGuide').hidden=true;
  document.body.classList.toggle('in-arcade',mode==='arcade');
  $('welcomeOverlay').hidden=true;$('lobbyOverlay').hidden=true;$('finishOverlay').hidden=true;
  $('raceMain').focus?.({preventScroll:true});
  updateDashboard();refreshVisiblePosters(true);
}
function clearKeys(){for(const key of Object.keys(keys))keys[key]=false;touchPointers.clear();}
function keysAllowed(){return gameRunning&&(raceStarted||countdownEnd>performance.now())&&$('welcomeOverlay').hidden&&$('lobbyOverlay').hidden&&$('finishOverlay').hidden&&$('raceGuide').hidden&&$('workProgressOverlay').hidden&&$('pitOverlay').hidden&&Date.now()>=(player.serviceUntil||0)&&!inspector&&!player.finished;}
function updatePhysics(dt){
  if(!gameRunning||!raceStarted||player.finished||inspector||!$('raceGuide').hidden||raceEnded)return;
  dt=Math.min(dt,.025);
  player.elapsed+=dt;
  if(raceMode==='arcade'&&(!$('pitOverlay').hidden||Date.now()<(player.serviceUntil||0))){player.speed=0;resetDrive(player);return;}
  const track=getTrackClosest(player.x,player.z),pit=nearestPit(player.x,player.z);
  const pitLane=pit.dist<PIT_HALF+.5&&track.dist>ROAD_HALF-.5;
  player.inPit=pitLane;
  player.offRoad=track.dist>ROAD_HALF+.5&&pit.dist>PIT_HALF+.5;
  const input=(keys.right?1:0)-(keys.left?1:0);
  const boosting=raceMode==='arcade'&&Date.now()>=(localEffects.turbo||0)&&keys.boost&&!keys.drift&&!keys.brake&&player.boost>.012&&player.fuel>0&&!player.offRoad&&!pitLane;
  player.boosting=boosting;player.braking=keys.brake||keys.drift||(keys.down&&player.speed>0);
  const now=Date.now();const competitive=raceMode==='arcade';
  const active=name=>competitive&&now<(localEffects[name]||0);
  if(competitive&&!pitLane&&!player.offRoad&&!boosting&&!keys.drift&&!active('turbo')){
    const eligible=[...opponents.values()].some(o=>!o.finished&&performance.now()-o.receivedAt<600&&draftEligible(player,o));
    draftTime=eligible?draftTime+dt:0;
    if(draftTime>=1&&now>=draftCooldown&&now>=draftUntil){draftUntil=now+3000;draftCooldown=now+5500;draftTime=0;announce('SLIPSTREAM · +8% SPEED',1.2);}
    if(!eligible)draftUntil=0;
  }else{draftTime=0;draftUntil=0;}
  const {step,speedMagnitude}=advanceDrive(player,keys,dt,{pitLane,offRoad:player.offRoad,boosting,stats:competitive?player.stats:undefined,turbo:active('turbo')&&!pitLane&&!player.offRoad,drafting:competitive&&now<draftUntil,superGrip:active('grip'),slippery:active('slippery'),slowed:active('slow')});
  player.boost=boosting?Math.max(0,player.boost-dt*.24):Math.min(1,player.boost+dt*(pitLane?.2:.05));
  // Assistance acts only with released steering, at a low capped angular speed.
  if(Math.abs(input)<.01&&!player.drifting&&!player.offRoad&&speedMagnitude>14){
    const lane=pitLane?pit.pit?.curve:trackCurve;
    const pathU=pitLane?pit.u:track.u;
    if(lane){
      const error=signedAngle(getHeading(lane.getTangentAt(pathU)),player.heading);
      if(Math.abs(error)<.42)player.heading+=clamp(error*.33*dt,-.13*dt,.13*dt);
    }
  }
  constrainToCircuit();
  if(Math.abs(player.x)>1750||Math.abs(player.z)>1350){player.x=clamp(player.x,-1745,1745);player.z=clamp(player.z,-1345,1345);player.speed*=.1;}
  if(player.speed>0&&player.fuel>0)player.fuel=Math.max(0,player.fuel-step/(2*trackLength));
  if(player.fuel<=0){player.speed=THREE.MathUtils.damp(player.speed,0,3.2,dt);if(Math.abs(player.speed)<.12)player.speed=0;}
  if(player.offRoad)player.offRoadTime=(player.offRoadTime||0)+dt;
  updatePitProgress(pit,track);updateLaps(pit,track,dt);
  if(raceMode==='arcade'){
    for(const u of [.12,.36,.62,.86]){
      const d=Math.abs(((player.u-u+.5)%1+1)%1-.5)*trackLength;
      if(d<10&&Math.abs(player.speed)>10&&player._padLast!==u){player.boost=Math.min(1,player.boost+.22);player._padLast=u;}
      if(d>25&&player._padLast===u)player._padLast=null;
    }
  }
  if(!player._fuelWarn&&player.fuel<=.22&&player.fuel>0){player._fuelWarn=true;announce('LOW FUEL\nFIND A PIT LANE',2.3);}
  if(player.fuel===0&&!player._emptyWarn){player._emptyWarn=true;announce('OUT OF FUEL\nPRESS T FOR PIT TOW',3.2);}
  setCarPose(player.mesh,player.x,player.z,player.heading,player.steerAngle||0);
  if(arcadeItems())checkBombPickup();
}
function updatePitProgress(pit,track){
  const p=pit.pit;
  if(!p)return;
  const onLane=pit.dist<PIT_HALF-1;
  let visit=player.pitVisit;
  if(!visit&&onLane&&(pit.u<.19||pit.u>.81)&&player.speed!==0){
    visit={index:p.index,direction:pit.u<.19?1:-1,deep:false,valid:true,seen:pit.u};player.pitVisit=visit;
  }
  if(visit){
    if(visit.index!==p.index){
      // Allow crossing the main racing surface without cancelling a previously visited service lane.
      if(pit.dist>24)player.pitVisit=null;
      return;
    }
    if(onLane){
      if(pit.u>.36&&pit.u<.64)visit.deep=true;
      if(Math.abs(pit.u-visit.seen)>.55)visit.valid=false;
      if((pit.u-visit.seen)*visit.direction<-.24)visit.valid=false;
      visit.seen=pit.u;
      if(visit.deep&&visit.valid&&(visit.direction===1?pit.u>.87:pit.u<.13)){
        player.fuel=1;player.boost=Math.min(1,player.boost+.35);player._fuelWarn=false;player._emptyWarn=false;
        player.pitVisit=null;announce('PIT SERVICE COMPLETE\nTANK REFILLED',2.3);p.refillAt=performance.now();return;
      }
    }else if(pit.dist>PIT_HALF+9&&pit.u>.15&&pit.u<.85)player.pitVisit=null;
  }
}
function updateLaps(pit,track,dt){
  let u=track.u;
  if(pit.dist<PIT_HALF+5&&pit.pit&&pit.u>.1&&pit.u<.9){
    u=(pit.pit.startT+pit.pit.span*pit.u+1)%1;
  }
  let delta=u-player.priorU;
  if(delta>.5)delta-=1;
  if(delta<-.5)delta+=1;
  if(Math.abs(delta)<.075){player.travel=Math.max(0,player.travel+delta);}
  const wrapped=player.priorU>.88&&u<.12;
  if(wrapped&&player.travel>.76&&player.speed>0&&!player.finished){
    player.lap++;player.lastLap=player.elapsed-player.lapAt;player.fastest=Math.min(player.fastest,player.lastLap);player.lapAt=player.elapsed;
    player.travel=0;
    if(raceMode==='tour')announce(`LAP ${String(player.lap).padStart(2,'0')} COMPLETE\n${formatTime(player.lastLap)}`,2.2);
    else{
      announce(`LAP ${player.lap} / ${raceSettings.laps}\n${formatTime(player.lastLap)}`,1.8);
      if(player.lap>=raceSettings.laps){player.priorU=u;player.u=u;finishLocalRace();}
    }
  }
  player.priorU=u;player.u=u;
}
function updateOpponentMeshes(dt){
  // Physics heading is opposite Three.js yaw. Always interpolate towards
  // -heading; the old +heading target caused the remote-only sideways drift.
  for(const op of opponents.values()){
    if(!op.mesh)continue;
    const factor=1-Math.exp(-dt*14);
    const targetYaw=-op.heading;
    if(!op.visualReady){
      setCarPose(op.mesh,op.x,op.z,op.heading,op.steering||0);op.visualReady=true;
    }else{
      // A brief velocity estimate absorbs the 10 Hz network snapshot cadence.
      // Clamp it so stale network traffic never causes large teleports.
      const age=Math.min(.12,Math.max(0,(performance.now()-(op.receivedAt||performance.now()))/1000));
      const dx=Math.sin(op.heading)*(op.speed||0)*age;
      const dz=-Math.cos(op.heading)*(op.speed||0)*age;
      op.mesh.position.x=THREE.MathUtils.lerp(op.mesh.position.x,op.x+dx,factor);
      op.mesh.position.z=THREE.MathUtils.lerp(op.mesh.position.z,op.z+dz,factor);
      op.mesh.rotation.y+=signedAngle(targetYaw,op.mesh.rotation.y)*factor;
      for(const wheel of (op.mesh.userData.frontWheels||[]))wheel.rotation.y=THREE.MathUtils.lerp(wheel.rotation.y,-(op.steering||0),factor);
    }
    animateCar(op.mesh,op.speed||0,op.steering||0,false,dt);
  }
}
function updateCamera(dt){
  if(!sceneReady||!player.mesh)return;
  const c=player;
  if(cameraHeading===null)cameraHeading=c.heading;
  cameraHeading+=signedAngle(c.heading,cameraHeading)*(1-Math.exp(-dt*7));
  const heading=cameraHeading;
  if(inspector){
    const board=inspector.board;
    const distance=inspector.distance||58;
    const pos=board.worldPos.clone().addScaledVector(board.towards,distance);
    pos.y=board.worldPos.y+(inspector.pan||0);
    camera.position.lerp(pos,Math.min(1,dt*4.8));
    vectors.currentTarget.lerp(board.worldPos.clone().add(new THREE.Vector3(0,inspector.pan||0,0)),Math.min(1,dt*5));
    camera.fov=THREE.MathUtils.lerp(camera.fov,48,Math.min(1,dt*4));camera.updateProjectionMatrix();
    camera.lookAt(vectors.currentTarget);
    return;
  }
  const speed=clamp(Math.abs(c.speed)/95,0,1),lookAhead=20+speed*20;
  const inTunnel=activeCircuit==='coastal'&&coastalTunnels.some(([a,b])=>c.u>a-.009&&c.u<b+.009);
  const distance=cameraMode===0?(inTunnel?35:63+speed*13):cameraMode===1?115:cameraMode===2?15:0;
  const height=cameraMode===0?(inTunnel?17:27+speed*7):cameraMode===1?125:cameraMode===2?8:245;
  let desire=new THREE.Vector3(c.x-Math.sin(heading)*distance,height,c.z+Math.cos(heading)*distance);
  const target=new THREE.Vector3(c.x+Math.sin(heading)*lookAhead,4,c.z-Math.cos(heading)*lookAhead);
  if(cameraMode===3){desire.set(c.x,235,c.z+1);target.set(c.x,0,c.z);}
  camera.position.lerp(desire,1-Math.exp(-dt*(cameraMode===2?10:5.2)));
  vectors.currentTarget.lerp(target,1-Math.exp(-dt*7));
  const targetFov=cameraMode===3?53:cameraMode===1?58:61+speed*8+(c.boosting?4:0);
  camera.fov=THREE.MathUtils.damp(camera.fov,targetFov,4,dt);camera.updateProjectionMatrix();
  camera.lookAt(vectors.currentTarget);
}
function updateClosestBoard(){
  if(raceMode!=='tour'||!gameRunning){$('inspectTip').hidden=true;return;}
  let min=Infinity,best=null;
  for(const pit of stationData){
    for(const b of pit.boards){const d=Math.hypot(player.x-b.worldPos.x,player.z-b.worldPos.z);if(d<min){min=d;best=b;}}
  }
  latestClosestBoard=min<66?best:null;
  $('inspectTip').hidden=!latestClosestBoard||!!inspector;
  $('inspectButton').hidden=!latestClosestBoard&&!inspector;
  $('inspectButton').textContent=inspector?'BACK TO RACE':'READ BOARD';
  if(inspector){$('inspectTip').hidden=false;$('inspectTip').innerHTML='INSPECTING IN-WORLD BILLBOARD <kbd>E</kbd><small>Mouse wheel / + − to zoom · Press E to drive</small>';}
  else if(latestClosestBoard){$('inspectTip').innerHTML='READ A BILLBOARD <kbd>E</kbd> <small></small>';$('inspectTip').querySelector('small').textContent=latestClosestBoard.item.title.slice(0,62)+' · No pop-up';}
}
function toggleInspect(){
  if(inspector){inspector=null;clearKeys();return;}
  if(latestClosestBoard&&raceMode==='tour'){
    inspector={board:latestClosestBoard,distance:30,pan:0};clearKeys();
    if(!latestClosestBoard.texture){const pit=latestClosestBoard.station;for(const board of pit.boards){if(!board.texture){board.texture=makePoster(board);for(const face of [board.mesh,board.backMesh]){face.material.map=board.texture;face.material.needsUpdate=true;}}}pit.loaded=true;}
  }
}
function pitTow(){
  if(!gameRunning||!raceStarted||player.finished||player.fuel>.03||raceEnded)return;
  const closest=stationData.reduce((best,pit)=>{
    const a=pit.curve.getPointAt(.08);const d=Math.hypot(a.x-player.x,a.z-player.z);
    return d<best.d?{pit,d}:best;
  },{pit:stationData[0],d:Infinity}).pit;
  placeCarOnLane(closest,.13);
  player.fuel=.23;player._fuelWarn=false;player._emptyWarn=false;
  if(raceMode==='arcade'){player.elapsed+=20;player.incidents=(player.incidents||0)+1;}
  announce(raceMode==='arcade'?'PIT TOW\n+20 SECOND PENALTY':'RECOVERY TOW\nDRIVE THROUGH TO REFILL',2.6);
}
function toggleCamera(){if(inspector){inspector=null;return;}cameraMode=(cameraMode+1)%4;$('cameraName').textContent=['CHASE','HELICOPTER','BUMPER','TOP DOWN'][cameraMode];}
function formatTime(seconds){if(!Number.isFinite(seconds))return'--:--.-';let m=Math.floor(seconds/60),s=seconds-m*60;return String(m).padStart(2,'0')+':'+s.toFixed(1).padStart(4,'0');}
function updateDashboard(){
  $('speedNumber').textContent=String(Math.floor(Math.abs(player.speed)*2.5)).padStart(3,'0');
  $('fuelValue').textContent=Math.ceil(player.fuel*100)+'%';$('fuelFill').style.width=(player.fuel*100)+'%';$('fuelFill').classList.toggle('danger',player.fuel<.22);
  $('lapValue').innerHTML=String(player.lap).padStart(2,'0')+` <span class="lap-delim">/ ${raceMode==='tour'?'∞':raceSettings.laps}</span>`;
  $('timeValue').textContent=formatTime(Math.max(0,player.elapsed-player.lapAt));$('boostFill').style.width=player.boost*100+'%';
  if(!stationData.length)return;
  const near=nearestPit(player.x,player.z);
  const nearestStation=stationData.reduce((best,p)=>{
    const point=p.curve.getPointAt(.5);const dist=Math.hypot(player.x-point.x,player.z-point.z);
    return dist<best.dist?{pit:p,dist}:best;
  },{pit:stationData[0],dist:Infinity});
  const active=near.dist<32?near.pit:nearestStation.pit;
  $('pitStationName').textContent=raceMode==='tour'?active.info.name:'FUEL & ENGINEERING';
  $('pitStationDescription').textContent=raceMode==='tour'?(active.info.lead||'Read the résumé billboards along this curved pit lane.'):'Drive through to refuel. Stop in the middle of the pit lane and press P to spend earned REP on tuning.';
  $('pitNext').textContent=raceMode==='tour'?active.info.name:'FUEL & ENGINEERING';
  $('pitCount').textContent=`${stationData.length} PIT STOP${stationData.length===1?'':'S'}`;
  $('fuelHint').textContent=player.fuel<.15?'Refuel by driving through a complete pit lane': '≈ 2 full-speed laps / tank';
  $('towButton').hidden=player.fuel>.03||raceEnded||player.finished;updateRivalsHud();
}
function updateMinimap(){
  if(!sceneReady)return;
  const canvas=$('miniMap'),ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
  const at=minimapProjection([...trackPoints,...stationData.flatMap(p=>p.points)],W,H);
  ctx.fillStyle='#0b282e';ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(168,204,192,.11)';ctx.lineWidth=.7;
  for(let x=12;x<W;x+=28){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=15;y<H;y+=28){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  const drawTrack=()=>{ctx.beginPath();trackPoints.forEach((p,i)=>{const [x,y]=at(p);if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.closePath();};
  ctx.lineCap='round';ctx.lineJoin='round';
  ctx.strokeStyle='#436364';ctx.lineWidth=9;drawTrack();ctx.stroke();
  ctx.strokeStyle='#e0eade';ctx.lineWidth=4.5;drawTrack();ctx.stroke();
  ctx.strokeStyle='#21393e';ctx.lineWidth=1.7;drawTrack();ctx.stroke();
  // Eleven compact numbered stop markers; only the nearby pit is emphasised.
  const nearest=nearestPit(player.x,player.z);
  const current=nearest.pit?.index??-1;
  for(const pit of stationData){
    const q=pit.curve.getPointAt(.5),[x,y]=at(q),selected=pit.index===current;
    {
      ctx.lineWidth=selected?2.3:1.5;ctx.strokeStyle=selected?'#d5ea84':'#edb17e';ctx.beginPath();pit.points.forEach((p,i)=>{const [a,b]=at(p);i?ctx.lineTo(a,b):ctx.moveTo(a,b);});ctx.stroke();
    }
    ctx.fillStyle=selected?'#d6f584':'#edb17e';ctx.strokeStyle='#102b2d';ctx.lineWidth=1.6;
    ctx.beginPath();ctx.arc(x,y,selected?5.8:3.2,0,TWO_PI);ctx.fill();ctx.stroke();
    if(selected&&raceMode==='tour'){ctx.fillStyle='#102b2d';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 7px Arial';ctx.fillText(String(pit.index+1),x,y+0.3);}
  }
  const start=trackCurve.getPointAt(0),[sx,sy]=at(start);
  ctx.strokeStyle='#dce99a';ctx.lineWidth=2.2;ctx.beginPath();ctx.arc(sx,sy,3.2,0,TWO_PI);ctx.stroke();
  if(arcadeItems())for(const pickup of BOMB_PICKUPS){const [x,y]=at(pickup.pos);ctx.fillStyle=Date.now()<combat.readyAt[pickup.index]?'#536461':'#ffcd69';ctx.fillRect(x-2.8,y-2.8,5.6,5.6);}
  for(const o of opponents.values()){const [x,y]=at(o);ctx.fillStyle=o.hex||'#f3ae85';ctx.beginPath();ctx.arc(x,y,3.4,0,TWO_PI);ctx.fill();}
  const [x,y]=at(player);ctx.save();ctx.translate(x,y);ctx.rotate(player.heading);ctx.shadowBlur=7;ctx.shadowColor='#d8f58b';
  ctx.fillStyle='#d7f484';ctx.strokeStyle='#0a2729';ctx.lineWidth=1.8;
  ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(-4.6,5.2);ctx.lineTo(4.6,5.2);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  ctx.font='800 8px Arial';ctx.textAlign='left';ctx.fillStyle='#8ab1ad';ctx.fillText(activeCircuit==='coastal'?'COASTAL CITY':'SG · CIRCUIT',9,12);
  ctx.textAlign='right';ctx.fillText('S / F',W-9,H-7);
}
function tick(now){
  const dt=Math.min(.055,(now-lastTick)/1000||.016);lastTick=now;lastFrameDt=dt;
  audio.update({speed:player.speed,throttle:keys.up||keys.down,brake:player.braking,boost:player.boosting,slip:player.slip,drifting:player.drifting,running:gameRunning&&raceStarted&&!player.finished&&!document.hidden&&$('welcomeOverlay').hidden&&$('lobbyOverlay').hidden,dt});
  if(sceneReady){
    if(raceMode==='arcade'&&countdownEnd>0&&!raceStarted){
      const left=(countdownEnd-now)/1000;
      if(left<=0){countdownEnd=0;raceStarted=true;raceState.started=true;audio.cue('go');announce('GO! GO! GO!',1.5);if(raceState.role!=='solo')setHudHidden(true);}
      else if(left<=3.95){const count=Math.max(1,Math.ceil(left));const text=`${count}`;if(currentBanner!==text||showBannerUntil<now)announce(text,.82);}
    }
    // Bounded physics substeps maintain handling at lower frame rates.
    const steps=Math.max(1,Math.ceil(dt/.02));for(let i=0;i<steps;i++)updatePhysics(dt/steps);
    $('driftStatus').hidden=!player.drifting||!raceStarted||player.finished;
    animateCar(player.mesh,player.speed,player.steerAngle||0,player.braking,dt);
    updateOpponentMeshes(dt);updateCombat(dt,now);updateCamera(dt);updateWorldDetail(now);
    const tunnelRange=activeCircuit==='coastal'?coastalTunnels.find(([a,b])=>player.u>=a&&player.u<=b):null;
    const enclosed=Boolean(tunnelRange)&&(cameraMode===0||cameraMode===2);
    for(const roof of tunnelRoofs)roof.visible=cameraMode===0||cameraMode===2;
    const blend=enclosed?clamp(Math.min(player.u-tunnelRange[0],tunnelRange[1]-player.u)/.006,0,1):0;
    if(ambientSky)ambientSky.intensity=THREE.MathUtils.damp(ambientSky.intensity,1.45-blend*1.13,5,dt);
    if(sun)sun.intensity=THREE.MathUtils.damp(sun.intensity,2.55-blend*2.53,5,dt);
    if(ambientFill)ambientFill.intensity=.24*(1-blend);
    tunnelLights.forEach(({light,first,last},i)=>{light.intensity=enclosed?5600:0;if(enclosed){const n=clamp(Math.round(player.u*TRACK_SAMPLES/6)*6+(i-1)*12,first+2,last-2),p=trackPoints[n];light.position.set(p.x,39,p.z);}});
    if(!compatibilityActive){
      try {renderer.render(scene,camera);}
      catch(error){console.warn('WebGL draw failed',error);setCompatibility(true,'WebGL render failure');}
      if(!compatibilityActive&&gameRunning&&now-lastModeChange>950&&now-lastRendererCheck>350&&rendererCheckCount<6){
        lastRendererCheck=now;rendererCheckCount++;
        if(webglPictureLooksBlank())rendererBlankCount++;else rendererBlankCount=0;
        if(rendererBlankCount>=2)setCompatibility(true,'WebGL displayed its sky but not the circuit or cars');
      }
    }
    if(compatibilityActive&&now-lastCompatibilityFrame>34){
      compatibilityRenderer.render({camera,player,opponents,inspector,mode:raceMode,combat:{...combat,pickups:arcadeItems()?BOMB_PICKUPS:[],shieldUntil:localEffects.shield||0,engineering:engineeringEnabled(),rules:raceSettings.rules,hudHidden},now:Date.now()});
      lastCompatibilityFrame=now;
    }
    hudClock+=dt;texturesClock+=dt;minimapClock+=dt;networkClock+=dt;
    if(hudClock>.13){updateAudioButton();updateDashboard();updateClosestBoard();if(raceMode==='arcade')updateBombHud();hudClock=0;}
    if(texturesClock>.9){refreshVisiblePosters();texturesClock=0;}
    if(minimapClock>.16){updateMinimap();minimapClock=0;}
    if(networkClock>.095){if(raceStarted&&raceMode==='arcade'&&raceState.role!=='guest')hostSkills();networkTick();networkClock=0;}
  }
  if(showBannerUntil&&now>showBannerUntil){$('raceBanner').classList.remove('visible');showBannerUntil=0;currentBanner='';}
  requestAnimationFrame(tick);
}
function send(conn,payload){
  if(!conn?.open)return;
  try{if(conn.dataChannel?.bufferedAmount>90000)return;conn.send(payload);}catch(e){console.warn('Network send:',e.message);}
}
function broadcast(payload,except=null){for(const [id,conn] of raceState.connections){if(id!==except)send(conn,payload);}}
function cleanName(name){return String(name||'Driver').trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,18)||'Driver';}
function updateNetworkStatus(text){$('networkStatus').textContent=text;}
function setLobbyError(msg){$('lobbyError').textContent=msg||'';}
function roomId(code){return 'sg-rc-'+String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);}
function makeRoomCode(){const abc='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const vals=new Uint8Array(6);crypto.getRandomValues(vals);return Array.from(vals,n=>abc[n%abc.length]).join('');}
function parseRoomCode(text){
  const raw=String(text||'').trim();
  try{const url=new URL(raw);return String(url.searchParams.get('room')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);}catch{}
  return raw.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);
}
// Global play needs both signalling (PeerJS) and a viable WebRTC ICE path.
// A STUN-only connection works on many networks, but some NATs require TURN.
const PUBLIC_STUN_SERVERS = [
  {urls:'stun:stun.l.google.com:19302'},
  {urls:'stun:stun1.l.google.com:19302'},
  {urls:'stun:stun.cloudflare.com:3478'},
];
function relayConfigured(){return Boolean(String(window.RC_MULTIPLAYER_CONFIG?.turnCredentialUrl||'').trim());}
function networkHelpText(connected=false){
  if(connected)return relayConfigured()?'TURN relay configured · internet play enabled.':'STUN-only connection · global play depends on both networks.';
  return relayConfigured()?'Retrieving global relay credentials…':'STUN-only: LAN and some internet connections work, but restrictive networks need TURN. See RC_GLOBAL_MULTIPLAYER.md.';
}
function setNetworkHelp(text){const hint=$('networkHint');if(hint)hint.textContent=text;}
function humanPeerError(err,joining=false){
  const type=err?.type||'unknown';
  if(type==='peer-unavailable')return 'Host is not registered with the signalling service. Check the room code, that the host sees ROOM OPEN, and that they have not closed the tab.';
  if(type==='network'||type==='socket-error'||type==='socket-closed'||type==='server-error')return 'Unable to reach the PeerJS signalling service. Check internet/firewall access, then try again.';
  if(type==='webrtc')return 'WebRTC could not establish a connection across these networks. Configure TURN relay access in rc-network-config.js.';
  if(type==='unavailable-id')return 'This room ID is already in use. Create a new room.';
  return `${joining?'Join':'Hosting'} failed (${type}): ${err?.message||'unknown error'}`;
}
async function peerOptions(){
  const endpoint=String(window.RC_MULTIPLAYER_CONFIG?.turnCredentialUrl||'').trim();
  const options={debug:new URLSearchParams(location.search).has('rtcdebug')?2:0,config:{iceServers:PUBLIC_STUN_SERVERS}};
  if(!endpoint)return options;
  let parsed;
  try{parsed=new URL(endpoint);}catch{throw new Error('TURN credential URL is invalid. Check rc-network-config.js.');}
  if(parsed.protocol!=='https:')throw new Error('TURN credential URL must use HTTPS.');
  const controller=new AbortController();const t=setTimeout(()=>controller.abort(),10000);
  let response,servers;
  try{
    response=await fetch(parsed.href,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    servers=Array.isArray(payload)?payload:payload?.iceServers;
  }catch(e){throw new Error(`TURN credential request failed (${e.message}). Check the URL and network.`);}
  finally{clearTimeout(t);}
  if(!Array.isArray(servers)||!servers.length||servers.length>20)throw new Error('TURN endpoint returned no valid ICE servers.');
  const verified=[];
  for(const server of servers){
    const urls=[server?.urls].flat().filter(u=>typeof u==='string'&&/^(stun|stuns|turn|turns):/i.test(u));
    if(!urls.length)continue;
    const entry={urls:urls.length===1?urls[0]:urls};
    if(typeof server.username==='string')entry.username=server.username;
    if(typeof server.credential==='string')entry.credential=server.credential;
    verified.push(entry);
  }
  if(!verified.some(x=>[x.urls].flat().some(u=>/^turns?:/i.test(u))))throw new Error('TURN endpoint returned STUN servers only; TURN is needed for restrictive NATs.');
  options.config.iceServers=verified;
  return options;
}
function watchIceConnection(conn,session){
  clearInterval(raceState._iceWatchTimer);let tries=0;
  raceState._iceWatchTimer=setInterval(()=>{
    if(session!==networkGeneration||conn!==raceState.hostConn){clearInterval(raceState._iceWatchTimer);return;}
    const pc=conn.peerConnection;
    if(!pc){if(++tries>=130)clearInterval(raceState._iceWatchTimer);return;}
    clearInterval(raceState._iceWatchTimer);
    const update=()=>{
      if(session!==networkGeneration||raceState.joined)return;
      if(pc.iceConnectionState==='failed'||pc.connectionState==='failed'){
        setLobbyError('WebRTC connection failed across these networks. The host may be online, but a TURN relay is required. Configure rc-network-config.js.');
        $('roomStatus').textContent='WEBRTC NETWORK PATH FAILED';
      }
    };
    pc.addEventListener?.('iceconnectionstatechange',update);
    pc.addEventListener?.('connectionstatechange',update);
    update();
  },180);
}
function resetNetwork(){
  networkGeneration++;
  clearTimeout(raceState._joinTimeout);clearTimeout(raceState._hostTimeout);clearTimeout(raceState._reconnectTimer);
  clearInterval(raceState._iceWatchTimer);
  resetCombatRound([]);
  if(raceState.peer){try{raceState.peer.destroy();}catch{}}
  raceState.peer=null;raceState.hostConn=null;raceState.connections.clear();raceState.remote.clear();raceState.finishers.clear();
  raceState.role='solo';raceState.hostId='';raceState.roomCode='';raceState.joined=false;raceState.started=false;raceState.pendingStart=null;raceState.round=0;raceState.roster=[];raceState.ready=new Set();raceState._latest=new Map();countdownEnd=0;clearKeys();
  for(const o of opponents.values()){if(o.mesh){scene?.remove(o.mesh);disposeObject(o.mesh);}}
  opponents.clear();
  $('raceRules').disabled=false;$('lapSelect').disabled=false;$('circuitSelect').disabled=false;setHudHidden(false);
  updateNetworkStatus('SINGLE PLAYER');
}
function allParticipants(){
  const players=[{id:raceState.peer?.id||'local',name:raceState.name,host:raceState.role==='host',lap:player.lap,finished:player.finished,time:localFinishTime,setup:garageSetup}];
  for(const [id,p] of raceState.remote){players.push({id,name:p.name||'Driver',host:false,lap:p.lap||0,finished:!!p.finished,time:p.time||null,setup:config(p.setup)});}
  return players;
}
function roomRoster(){
  $('lobbyRacers').replaceChildren();
  const racers=allParticipants();
  racers.forEach((p,i)=>{
    const e=document.createElement('div');e.className='lobby-racer';e.textContent=`${i+1<10?'0':''}${i+1}  ${p.name}${p.host?' (HOST)':''} · ${CARS[config(p.setup).chassis].name}`;e.style.borderLeft=`5px solid ${config(p.setup).colour}`;$('lobbyRacers').append(e);
  });
  if(raceState.role==='host')$('launchRace').disabled=!raceState.joined||raceState.started;
  else $('launchRace').disabled=true;
  $('launchRace').hidden=raceState.role!=='host';
  $('raceRules').disabled=raceState.role==='guest';$('lapSelect').disabled=raceState.role==='guest';$('circuitSelect').disabled=raceState.role==='guest'||raceState.started;renderGarage();
}
function sendRoster(){
  if(raceState.role!=='host')return;
  const racers=allParticipants();
  broadcast({type:'roster',players:racers,laps:raceSettings.laps,rules:raceSettings.rules,circuit:raceSettings.circuit});roomRoster();
}
function ensureOpponent(id,name,colourIndex,setup=raceState.remote.get(id)?.setup){
  if(!id||id===raceState.peer?.id)return;
  let opponent=opponents.get(id);
  if(!opponent){
    const c=CAR_COLOURS[(colourIndex+1)%CAR_COLOURS.length];const p=trackCurve.getPointAt(INITIAL_POS);
    opponent={id,name:cleanName(name),x:p.x,z:p.z,heading:getHeading(trackCurve.getTangentAt(INITIAL_POS)),speed:0,lap:0,finished:false,
      colour:c,hex:'#'+new THREE.Color(c).getHexString(),mesh:null,visualReady:false,steering:0,receivedAt:0,stunnedUntil:0};
    opponents.set(id,opponent);
  }
  opponent.name=cleanName(name);
  const chosen=config(setup);if(!opponent.setup||opponent.setup.chassis!==chosen.chassis||opponent.setup.colour!==chosen.colour){if(opponent.mesh){scene.remove(opponent.mesh);disposeObject(opponent.mesh);opponent.mesh=null;}opponent.setup=chosen;opponent.hex=chosen.colour;opponent.colour=parseInt(chosen.colour.slice(1),16);}
  if(sceneReady&&raceMode==='arcade'&&!opponent.mesh){opponent.mesh=makeCar(opponent.colour,opponent.name,opponent.setup.chassis);scene.add(opponent.mesh);setCarPose(opponent.mesh,opponent.x,opponent.z,opponent.heading);opponent.visualReady=true;}
  return opponent;
}
function applyRoster(players){
  const accepted=new Set();
  for(let i=0;i<players.length;i++){
    const p=players[i];if(!p||!p.id)continue;
    if(p.id===raceState.peer?.id){raceState.name=cleanName(p.name);continue;}
    accepted.add(p.id);
    raceState.remote.set(p.id,{...raceState.remote.get(p.id),name:cleanName(p.name),lap:p.lap||0,finished:!!p.finished,time:p.time||null,setup:config(p.setup)});
    if(raceMode==='arcade')ensureOpponent(p.id,p.name,i);
  }
  for(const id of raceState.remote.keys()){
    if(!accepted.has(id)){
      raceState.remote.delete(id);
      const op=opponents.get(id);if(op?.mesh){scene.remove(op.mesh);disposeObject(op.mesh);}opponents.delete(id);
    }
  }
  roomRoster();
}
function sharedSnapshot(){
  return {id:raceState.peer?.id,name:raceState.name,x:Math.round(player.x*10)/10,z:Math.round(player.z*10)/10,
    heading:+player.heading.toFixed(3),speed:+player.speed.toFixed(1),lap:player.lap,fuel:+player.fuel.toFixed(3),
    steering:+player.steerAngle.toFixed(3),u:player.u,elapsed:player.elapsed,incidents:player.incidents||0,offRoadTime:player.offRoadTime||0,slip:player.slip||0,lastLap:player.lastLap,drafting:Date.now()<draftUntil,recentDraft:Date.now()<draftCooldown+4000&&draftCooldown>0,stunned:Date.now()<combat.localStunUntil,finished:player.finished,time:localFinishTime};
}
function consumeSnapshot(p){
  if(!p||typeof p.id!=='string'||p.id===raceState.peer?.id)return;
  if(!Number.isFinite(p.x)||!Number.isFinite(p.z)||!Number.isFinite(p.heading))return;
  if(Math.abs(p.x)>1800||Math.abs(p.z)>1450)return;
  if(!raceState.remote.has(p.id))raceState.remote.set(p.id,{name:cleanName(p.name),lap:0});
  const s=raceState.remote.get(p.id);s.lap=Math.max(0,Math.min(200,Number(p.lap)||0));s.finished=!!p.finished;s.time=p.time||null;
  const op=ensureOpponent(p.id,s.name,[...raceState.remote.keys()].indexOf(p.id));
  if(op){op.x=p.x;op.z=p.z;op.heading=p.heading;op.speed=clamp(Number(p.speed)||0,-19,105);op.steering=clamp(Number(p.steering)||0,-.5,.5);op.receivedAt=performance.now();op.lap=s.lap;op.u=p.u;op.finished=s.finished;}
  if(s.finished&&s.time&&!raceState.finishers.has(p.id))raceState.finishers.set(p.id,{name:s.name,time:s.time});
  if(!$('finishOverlay').hidden)renderResults();
}
function networkTick(){
  if(!raceStarted||raceState.role==='solo'||!raceState.joined)return;
  if(raceState.role==='guest')send(raceState.hostConn,{type:'state',round:raceState.round,driver:sharedSnapshot()});
  else if(raceState.role==='host'){
    broadcast(boxPacket());
    broadcast({type:'snapshot',round:raceState.round,players:[sharedSnapshot(),...Array.from(raceState._latest||new Map()).map(([_,p])=>p)]});
  }
}
function attachHostConnection(conn){
  if(raceStarted||raceState.started||raceState.connections.size>=7){
    conn.on('open',()=>{send(conn,{type:'reject',reason:raceStarted?'This race has already started.':'Room is full (8 drivers maximum).'});setTimeout(()=>conn.close(),500);});return;
  }
  raceState.connections.set(conn.peer,conn);
  conn.on('data',msg=>{
    if(!msg||typeof msg!=='object')return;
    if(msg.type!=='hello'&&!raceState.remote.has(conn.peer))return;
    if(msg.type==='pit-tune'&&msg.round===raceState.round){hostPitTune(conn.peer,msg.stats);return;}
    if(msg.type==='garage'&&!raceState.started){raceState.remote.get(conn.peer).setup=config(msg.setup);sendRoster();return;}
    if(msg.type==='ready'&&msg.round===raceState.round){raceState.ready.add(conn.peer);return;}
    if(msg.type==='pickup-request'&&raceStarted&&msg.round===raceState.round){
      const position=raceState._latest?.get(conn.peer);
      if(position&&Date.now()-(position.received||0)<1200&&Number.isFinite(position.x)&&Number.isFinite(position.z))hostTryPickup(conn.peer,msg.index,position);
      return;
    }
    if(msg.type==='discard-item'&&raceStarted&&msg.round===raceState.round){hostDiscard(conn.peer);return;}
    if(msg.type==='bomb-request'&&raceStarted&&msg.round===raceState.round){hostFireBomb(conn.peer);return;}
    if(msg.type==='hello'){
      if(msg.protocol!==NETWORK_PROTOCOL){send(conn,{type:'reject',reason:'Your racing game is out of date. Refresh this page, then rejoin the room.'});return;}
      if(raceStarted||raceState.started){send(conn,{type:'reject',reason:'This race has already started.'});return;}
      const racerName=cleanName(msg.name);
      raceState.remote.set(conn.peer,{name:racerName,lap:0,finished:false,time:null,setup:config(msg.setup)});
      send(conn,{type:'welcome',protocol:NETWORK_PROTOCOL,id:conn.peer,room:raceState.roomCode,laps:raceSettings.laps,rules:raceSettings.rules,circuit:raceSettings.circuit,players:allParticipants()});
      sendRoster();$('roomStatus').textContent=`ROOM OPEN · ${allParticipants().length} DRIVER(S) ON GRID`;
    }
    if(msg.type==='state'&&raceStarted&&msg.round===raceState.round&&msg.driver&&msg.driver.id===conn.peer){
      if(!Number.isFinite(msg.driver.x)||!Number.isFinite(msg.driver.z)||!Number.isFinite(msg.driver.heading)||Math.abs(msg.driver.x)>1800||Math.abs(msg.driver.z)>1450||!Number.isFinite(msg.driver.speed)||Math.abs(msg.driver.speed)>106)return;
      const previous=raceState._latest?.get(conn.peer),d=msg.driver;
      if(!Number.isInteger(d.lap)||d.lap<0||d.lap>raceSettings.laps||!Number.isFinite(d.elapsed)||d.elapsed<0||!Number.isFinite(d.u)||d.u<0||d.u>1||!Number.isFinite(d.incidents)||!Number.isFinite(d.offRoadTime))return;
      if(previous&&(d.lap<previous.lap||d.lap>previous.lap+1||d.elapsed<previous.elapsed||d.incidents<previous.incidents||d.offRoadTime<previous.offRoadTime))return;
      d.received=Date.now();consumeSnapshot(d);
      if(!raceState._latest)raceState._latest=new Map();
      raceState._latest.set(conn.peer,msg.driver);
    }
    if(msg.type==='finished'&&msg.round===raceState.round&&msg.driver?.id===conn.peer){
      if(!Number.isFinite(msg.driver.time)||msg.driver.time<=0||!raceState._latest?.get(conn.peer)?.finished||raceState._latest.get(conn.peer).lap!==raceSettings.laps)return;
      hostSkills();raceState.finishers.set(conn.peer,{name:raceState.remote.get(conn.peer)?.name||'Driver',time:msg.driver.time,awards:awardStats(conn.peer)});
      broadcast({type:'results',round:raceState.round,finishers:Array.from(raceState.finishers.entries())});renderResults();
    }
  });
  conn.on('error',err=>console.warn('Guest connection error:',err));
  conn.on('close',()=>{
    raceState.connections.delete(conn.peer);raceState.remote.delete(conn.peer);raceState._latest?.delete(conn.peer);
    const op=opponents.get(conn.peer);if(op?.mesh){scene?.remove(op.mesh);disposeObject(op.mesh);}opponents.delete(conn.peer);
    if(!raceStarted)sendRoster();else renderResults();
    $('roomStatus').textContent=`ROOM OPEN · ${allParticipants().length} DRIVER(S) ON GRID`;
  });
}
async function hostRoom(){
  if(typeof window.Peer!=='function'){setLobbyError('Online networking did not load. Check your connection or use solo arcade.');return;}
  resetNetwork();const session=networkGeneration;
  setLobbyError('');raceState.role='host';raceState.name=cleanName($('playerName').value);
  raceSettings.laps=clamp(parseInt($('lapSelect').value,10)||3,2,12);raceSettings.rules=mode($('raceRules').value);raceSettings.circuit=circuitId($('circuitSelect').value);
  const code=makeRoomCode();raceState.roomCode=code;raceState.hostId=roomId(code);
  $('waitingRoom').hidden=false;$('roomCode').textContent=code;$('copyInvite').disabled=true;
  $('roomStatus').textContent='SETTING UP ONLINE CONNECTION…';setNetworkHelp(networkHelpText());
  let options;
  try{options=await peerOptions();}catch(err){if(session===networkGeneration){setLobbyError(err.message);$('roomStatus').textContent='TURN CONFIGURATION ERROR';}return;}
  if(session!==networkGeneration||raceState.role!=='host')return;
  const peer=new window.Peer(raceState.hostId,options);raceState.peer=peer;
  raceState._hostTimeout=setTimeout(()=>{
    if(session===networkGeneration&&!raceState.joined){setLobbyError('Could not register this room with PeerJS signalling. Check internet access and retry.');$('roomStatus').textContent='SIGNALLING TIMED OUT';}
  },20000);
  peer.on('open',()=>{
    if(session!==networkGeneration)return;
    clearTimeout(raceState._hostTimeout);clearTimeout(raceState._reconnectTimer);
    raceState.joined=true;setLobbyError('');$('copyInvite').disabled=false;
    $('roomStatus').textContent='ROOM OPEN · SHARE THE LINK TO INVITE FRIENDS';
    setNetworkHelp(networkHelpText(true));updateNetworkStatus('HOST / '+code);roomRoster();
  });
  peer.on('connection',conn=>{if(session===networkGeneration)attachHostConnection(conn);else conn.close();});
  peer.on('error',err=>{
    if(session!==networkGeneration)return;
    clearTimeout(raceState._hostTimeout);setLobbyError(humanPeerError(err));
    $('roomStatus').textContent='SIGNALLING ERROR';$('copyInvite').disabled=true;
  });
  peer.on('disconnected',()=>{
    if(session!==networkGeneration)return;
    raceState.joined=false;$('copyInvite').disabled=true;
    $('roomStatus').textContent='SIGNALLING DISCONNECTED · RECONNECTING…';
    updateNetworkStatus('SIGNALLING DISCONNECTED');
    raceState._reconnectTimer=setTimeout(()=>{
      if(session!==networkGeneration||peer.destroyed||!peer.disconnected)return;
      try{peer.reconnect();}catch(e){setLobbyError('Lost signalling. Create a new room if reconnection fails.');}
    },1800);
  });
}
async function joinRoom(){
  const code=parseRoomCode($('roomInput').value);if(code.length<4){setLobbyError('Enter a valid room code or invite URL.');return;}
  if(typeof window.Peer!=='function'){setLobbyError('Online networking did not load. Check your connection or choose solo mode.');return;}
  resetNetwork();const session=networkGeneration;
  setLobbyError('');raceState.role='guest';raceState.roomCode=code;raceState.hostId=roomId(code);
  raceState.name=cleanName($('playerName').value);
  $('waitingRoom').hidden=false;$('roomCode').textContent=code;$('copyInvite').disabled=true;
  $('roomStatus').textContent='SETTING UP ONLINE CONNECTION…';setNetworkHelp(networkHelpText());
  let options;
  try{options=await peerOptions();}catch(err){if(session===networkGeneration){setLobbyError(err.message);$('roomStatus').textContent='TURN CONFIGURATION ERROR';}return;}
  if(session!==networkGeneration||raceState.role!=='guest')return;
  const peer=new window.Peer(options);raceState.peer=peer;
  let signallingReady=false,linkReady=false,joinFailed=false;
  const fail=(message,status)=>{
    if(session!==networkGeneration||raceState.joined)return;
    joinFailed=true;setLobbyError(message);$('roomStatus').textContent=status;
  };
  raceState._joinTimeout=setTimeout(()=>{
    if(session!==networkGeneration||raceState.joined||joinFailed)return;
    if(!signallingReady)fail('PeerJS signalling did not respond. Check your connection or firewall.','SIGNALLING TIMED OUT');
    else if(!linkReady)fail('The host may be online, but a WebRTC link could not be established. Different networks may require a TURN relay. Configure rc-network-config.js.','WEBRTC CONNECTIVITY TIMED OUT');
    else fail('The host connection opened but the room did not confirm your join. Ask the host to create a new room.','HOST DID NOT RESPOND');
  },27000);
  peer.on('open',()=>{
    if(session!==networkGeneration)return;
    signallingReady=true;
    $('roomStatus').textContent='SIGNALLING OK · NEGOTIATING HOST CONNECTION…';
    const conn=peer.connect(raceState.hostId,{reliable:true,serialization:'json'});
    raceState.hostConn=conn;watchIceConnection(conn,session);
    conn.on('open',()=>{
      if(session!==networkGeneration)return;
      linkReady=true;joinFailed=false;setLobbyError('');
      send(conn,{type:'hello',protocol:NETWORK_PROTOCOL,name:raceState.name,setup:garageSetup});
      $('roomStatus').textContent='WEBRTC LINK OPEN · CONFIRMING ROOM…';
    });
    conn.on('data',msg=>{if(session===networkGeneration)handleGuestMessage(msg);});
    conn.on('error',err=>{fail('Data channel failed: '+(err.message||'WebRTC error')+'. Try TURN relay if you are on different networks.','WEBRTC ERROR');});
    conn.on('close',()=>{
      if(session!==networkGeneration)return;
      raceState.joined=false;updateNetworkStatus('HOST DISCONNECTED');
      if(raceStarted)announce('HOST DISCONNECTED\nRETURN TO MENU TO START SOLO',3);
      else if(!joinFailed)fail('The WebRTC connection closed before joining. If you are on different networks, configure TURN relay access.','CONNECTION CLOSED');
    });
  });
  peer.on('error',err=>{if(session===networkGeneration)fail(humanPeerError(err,true),err?.type==='peer-unavailable'?'HOST NOT REGISTERED':'NETWORK ERROR');});
  peer.on('disconnected',()=>{if(session===networkGeneration&&!raceState.joined)fail('Disconnected from PeerJS signalling. Check internet access.','SIGNALLING DISCONNECTED');});
}
function handleGuestMessage(msg){
  if(!msg||typeof msg!=='object')return;
  if(msg.type==='reject'){setLobbyError(msg.reason||'Unable to join this room.');$('roomStatus').textContent='JOIN REQUEST REJECTED';}
  if(msg.type==='welcome'){
    if(msg.protocol!==NETWORK_PROTOCOL){setLobbyError('Host is using an older game version. Ask everyone to refresh, then create a new room.');return;}
    clearTimeout(raceState._joinTimeout);clearInterval(raceState._iceWatchTimer);setLobbyError('');raceState.joined=true;setNetworkHelp(networkHelpText(true));raceSettings.laps=clamp(Number(msg.laps)||3,2,12);raceSettings.rules=mode(msg.rules);raceSettings.circuit=circuitId(msg.circuit);$('circuitSelect').value=raceSettings.circuit;$('raceRules').value=raceSettings.rules;$('lapSelect').value=String(raceSettings.laps);renderGarage();
    $('roomStatus').textContent=`CONNECTED · ${raceSettings.laps} LAP RACE · WAITING FOR HOST`;
    updateNetworkStatus('JOINED / '+raceState.roomCode);applyRoster(msg.players||[]);
  }
  if(msg.type==='roster'&&!raceState.started){
    raceSettings.laps=clamp(Number(msg.laps)||3,2,12);raceSettings.rules=mode(msg.rules);raceSettings.circuit=circuitId(msg.circuit);$('circuitSelect').value=raceSettings.circuit;$('raceRules').value=raceSettings.rules;$('lapSelect').value=String(raceSettings.laps);renderGarage();applyRoster(msg.players||[]);
    $('roomStatus').textContent=`CONNECTED · ${raceSettings.laps} LAP RACE · WAITING FOR HOST`;
  }
  if(msg.type==='start'){
    if(!Number.isInteger(msg.round)||msg.round<=raceState.round)return;
    raceSettings.laps=clamp(Number(msg.laps)||3,2,12);raceSettings.rules=mode(msg.rules);raceSettings.circuit=circuitId(msg.circuit);$('circuitSelect').value=raceSettings.circuit;$('raceRules').value=raceSettings.rules;$('lapSelect').value=String(raceSettings.laps);renderGarage();
    applyRoster(msg.players||[]);
    beginArcadeRace({launchAt:Number(msg.launchAt)||Date.now()+6000,round:msg.round,roster:msg.players||[]});
    send(raceState.hostConn,{type:'ready',round:raceState.round});
  }
  if(msg.type==='snapshot'&&msg.round===raceState.round&&Array.isArray(msg.players))for(const state of msg.players)consumeSnapshot(state);
  if(msg.round===raceState.round)receiveRivals(msg);
  if(msg.type==='pickup-granted'&&msg.round===raceState.round)receivePickup(msg);
  if(msg.type==='bomb-fired'&&msg.round===raceState.round)receiveBombFired(msg);
  if(msg.type==='bomb-hit'&&msg.round===raceState.round)applyBombHit(msg);
  if(msg.type==='results'&&msg.round===raceState.round&&Array.isArray(msg.finishers)){
    for(const record of msg.finishers){if(Array.isArray(record)&&record.length===2)raceState.finishers.set(record[0],record[1]);}
    renderResults();
  }
  if(msg.type==='restart'&&msg.round>=raceState.round){
    resetRoundToLobby();
    $('roomStatus').textContent='HOST RESET THE GRID · WAITING FOR START';
  }
}
function launchHostedRace(){
  if(raceState.role!=='host'||!raceState.joined||raceState.started||raceStarted)return;
  raceSettings.rules=mode($('raceRules').value);raceSettings.circuit=circuitId($('circuitSelect').value);raceSettings.laps=clamp(Number($('lapSelect').value)||3,2,12);
  const racers=allParticipants().map(({id,name,host,setup})=>({id,name,host,setup}));
  const nextRound=raceState.round+1;
  const launchAt=Date.now()+7500;
  const packet={type:'start',round:nextRound,launchAt,laps:raceSettings.laps,rules:raceSettings.rules,circuit:raceSettings.circuit,players:racers};
  broadcast(packet);
  beginArcadeRace({launchAt,round:nextRound,roster:racers});
}
function gridPosition(index){
  const slot=INITIAL_POS+index*(activeCircuit==='coastal'?22/trackLength:.0045);
  const base=trackCurve.getPointAt(slot),t=trackCurve.getTangentAt(slot);
  const n=new THREE.Vector3(t.z,0,-t.x);
  const stagger=base.clone().addScaledVector(n,index%2?6:-6);
  return {x:stagger.x,z:stagger.z,heading:getHeading(t),u:slot};
}
function resetRoundToLobby(){
  setHudHidden(false);
  raceStarted=false;raceState.started=false;raceEnded=false;countdownEnd=0;raceState.ready.clear();
  raceState.finishers.clear();raceState._latest=new Map();
  for(const remote of raceState.remote.values()){remote.lap=0;remote.finished=false;remote.time=null;}
  resetCombatRound(raceState.roster);
  for(const op of opponents.values()){op.lap=0;op.finished=false;op.speed=0;op.stunnedUntil=0;op.visualReady=false;}
  clearKeys();resetPlayer(INITIAL_POS,true);
  $('finishOverlay').hidden=true;$('lobbyOverlay').hidden=false;$('waitingRoom').hidden=false;
  $('roomStatus').textContent='GRID RESET · WAITING FOR START';
  roomRoster();
}
function beginArcadeRace(options={}){
  setHudHidden(false);audio.unlock();
  if(typeof options==='number')options={launchAt:Date.now()+options};
  const launchAt=options.launchAt||Date.now()+4500;
  const roster=options.roster?.length?options.roster:allParticipants();
  $('lobbyOverlay').hidden=true;
  setMode('arcade'); // a clean, full-fuel local car on every client, including the host
  clearKeys();
  raceState.round=options.round||raceState.round+1;
  raceState.roster=roster.map(p=>({id:p.id,name:p.name,setup:config(p.setup||garageSetup)}));
  raceState.ready=new Set();raceState.finishers.clear();raceState._latest=new Map();
  for(const state of raceState.remote.values()){state.lap=0;state.finished=false;state.time=null;}
  resetCombatRound(raceState.roster);
  const myId=raceState.peer?.id||'local';
  roster.forEach((p,i)=>{
    const start=gridPosition(i);
    if(p.id===myId){
      garageSetup=config(p.setup||garageSetup);player.stats=[...garageSetup.stats];localEngineering.stats=player.stats;player.colour=parseInt(garageSetup.colour.slice(1),16);player.hex=garageSetup.colour;player.chassis=garageSetup.chassis;
      if(player.mesh){scene.remove(player.mesh);disposeObject(player.mesh);}player.mesh=makeCar(player.colour,'',garageSetup.chassis);scene.add(player.mesh);
      player.x=start.x;player.z=start.z;player.heading=start.heading;player.u=start.u;player.priorU=start.u;
      setCarPose(player.mesh,player.x,player.z,player.heading,player.steerAngle||0);
    }else{
      const op=ensureOpponent(p.id,p.name,i,p.setup);
      if(op){op.x=start.x;op.z=start.z;op.heading=start.heading;op.speed=0;op.lap=0;op.finished=false;op.visualReady=false;
        if(op.mesh)setCarPose(op.mesh,op.x,op.z,op.heading);}
    }
  });
  player.incidents=0;player.offRoadTime=0;player.serviceUntil=0;
  player.elapsed=0;player.lapAt=0;player.lap=0;player.travel=0;player.fuel=1;player.speed=0;player.steer=0;player.steerAngle=0;resetDrive(player);cameraHeading=null;
  player.finished=false;player._emptyWarn=false;player._fuelWarn=false;localFinishTime=null;updateBombHud();
  raceStarted=false;raceState.started=true;raceEnded=false;
  countdownEnd=performance.now()+Math.max(2100,launchAt-Date.now());
  $('finishOverlay').hidden=true;$('welcomeOverlay').hidden=true;
  // Giving the canvas its own keyboard focus prevents buttons/input fields from
  // consuming WASD on a guest's browser immediately after the start overlay closes.
  if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
  $('raceMain').focus({preventScroll:true});
  $('modeLabel').textContent=MODES[raceSettings.rules].toUpperCase();$('trackLabel').textContent=CIRCUITS[activeCircuit].name.toUpperCase();$('mapMode').textContent=`${stationData.length} PIT${stationData.length===1?'':'S'}`;
  announce('GET READY · GRID RESET',2);
  updateNetworkStatus(raceState.role==='solo'?'SOLO / '+MODES[raceSettings.rules].toUpperCase():raceState.role==='host'?'HOST / '+raceState.roomCode:'ROOM / '+raceState.roomCode);
  updateDashboard();
}
function finishLocalRace(){
  if(player.finished)return;setHudHidden(false);
  if(raceState.role!=='guest')hostSkills();
  player.finished=true;localFinishTime=player.elapsed;player.speed=0;resetDrive(player);
  raceState.finishers.set(raceState.peer?.id||'local',{name:raceState.name,time:localFinishTime,awards:awardStats(getLocalId())});
  announce('CHECKERED FLAG!\nRACE COMPLETE',3);
  if(raceState.role==='host')broadcast({type:'results',round:raceState.round,finishers:Array.from(raceState.finishers.entries())});
  if(raceState.role==='guest'){send(raceState.hostConn,{type:'state',round:raceState.round,driver:sharedSnapshot()});send(raceState.hostConn,{type:'finished',round:raceState.round,driver:{id:raceState.peer.id,time:localFinishTime}});}
  setTimeout(()=>{if(player.finished&&raceMode==='arcade'){$('finishOverlay').hidden=false;renderResults();clearKeys();}},1600);
}
function renderResults(){
  if($('finishOverlay').hidden)return;
  const results=[...raceState.finishers.values()].filter(x=>x&&Number.isFinite(x.time)).sort((a,b)=>a.time-b.time);
  $('finishSubtitle').textContent=results.length>1?`${results.length} drivers across the line · ${raceSettings.laps} laps`:`${raceSettings.laps} laps · Fastest lap ${formatTime(player.fastest)}`;
  $('finishResults').replaceChildren();
  results.forEach((r,i)=>{
    const row=document.createElement('div');row.className='result-line';const name=document.createElement('span');name.textContent=`${i+1}. ${r.name}`;
    const t=document.createElement('small');t.textContent=formatTime(r.time);
    row.append(name,t);$('finishResults').append(row);
  });
  renderAwards(results);
  if(!results.length)$('finishResults').textContent='Race underway. Waiting for the results…';
  $('raceAgain').disabled=raceState.role==='host'&&[...raceState.remote.keys()].some(id=>!raceState.finishers.has(id));
  $('raceAgain').textContent=raceState.role==='solo'?'RACE AGAIN →':raceState.role==='host'?($('raceAgain').disabled?'WAITING FOR OTHER DRIVERS':'RESET THE GRID →'):'RETURN TO LOBBY →';
}
async function copyInvite(){
  const u=new URL(window.location.href);u.searchParams.set('mode','arcade');u.searchParams.set('room',raceState.roomCode);u.hash='';
  const text=u.toString();
  try{await navigator.clipboard.writeText(text);$('copyInvite').textContent='LINK COPIED ✓';setTimeout(()=>$('copyInvite').textContent='COPY INVITE LINK ↗',1600);}
  catch{$('roomInput').value=text;$('roomInput').focus();$('roomInput').select();setLobbyError('Copy the selected link manually.');}
}
/* Garage, pit tuning and host-side skill ledger. */
function setupGarageUI(){
  const select=$('chassisSelect');for(const [id,c] of Object.entries(CARS)){const o=document.createElement('option');o.value=id;o.textContent=`${c.name} · ${c.description}`;select.append(o);}
  for(const colour of PAINTS){const b=document.createElement('button');b.type='button';b.className='paint-swatch';b.style.background=colour;b.setAttribute('aria-label',`Paint ${colour}`);b.dataset.colour=colour;b.addEventListener('click',()=>{garageSetup=config({...garageSetup,colour});renderGarage();sendGarage();});$('paintChoices').append(b);}
  select.addEventListener('change',()=>{garageSetup=config({...garageSetup,chassis:select.value,gear:0,suspension:0});renderGarage();sendGarage();});
  for(const [id,key] of [['gearTune','gear'],['suspTune','suspension']])$(id).addEventListener('input',()=>{garageSetup=config({...garageSetup,[key]:Number($(id).value)});renderGarage();sendGarage();});
  $('raceRules').addEventListener('change',()=>{if(raceState.role==='guest')return;raceSettings.rules=mode($('raceRules').value);raceSettings.circuit=circuitId($('circuitSelect').value);renderGarage();sendRoster();});
  $('circuitSelect').addEventListener('change',()=>{if(raceState.role==='guest'||raceState.started)return;raceSettings.circuit=circuitId($('circuitSelect').value);renderGarage();sendRoster();});
  $('lapSelect').addEventListener('change',()=>{if(raceState.role==='guest')return;raceSettings.laps=Number($('lapSelect').value);sendRoster();});
  $('pitTuneButton').addEventListener('click',openPit);$('pitCancel').addEventListener('click',()=>{if(pitPending)return;$('pitOverlay').hidden=true;pitDraft=null;clearKeys();$('raceMain').focus?.({preventScroll:true});});
  $('pitApply').addEventListener('click',()=>{if(!pitDraft||pitPending||!validStats(garageSetup.chassis,pitDraft))return;const cost=transferCost(localEngineering.stats,pitDraft);if(cost<=0||cost>Math.min(2,localEngineering.rep))return;pitPending=true;renderPit();if(raceState.role==='guest'){send(raceState.hostConn,{type:'pit-tune',round:raceState.round,stats:pitDraft});const round=raceState.round;setTimeout(()=>{if(round===raceState.round&&pitPending){pitPending=false;$('pitMessage').textContent='No confirmation from host. Check connection.';renderPit();}},3500);}else hostPitTune(getLocalId(),pitDraft);});
  renderGarage();
}
function sendGarage(){if(raceState.started)return;if(raceState.role==='guest'&&raceState.joined)send(raceState.hostConn,{type:'garage',setup:garageSetup});else if(raceState.role==='host')sendRoster();}
function renderGarage(){
  $('chassisSelect').value=garageSetup.chassis;$('gearTune').value=garageSetup.gear;$('suspTune').value=garageSetup.suspension;
  $('garageDescription').textContent=CARS[garageSetup.chassis].description+' · 14 total performance points';
  $('carPreview').style.setProperty('--paint',garageSetup.colour);$('carPreview').dataset.chassis=garageSetup.chassis;
  $('carPreviewName').textContent=CARS[garageSetup.chassis].name;
  for(const b of $('paintChoices').children)b.setAttribute('aria-pressed',String(b.dataset.colour===garageSetup.colour));
  $('garageStats').replaceChildren();garageSetup.stats.forEach((value,i)=>{const row=document.createElement('div');row.className='garage-stat';const label=document.createElement('span');label.textContent=ATTRIBUTES[i];const bar=document.createElement('meter');bar.min=0;bar.max=5;bar.value=value;const number=document.createElement('strong');number.textContent=value.toFixed(1);row.append(label,bar,number);$('garageStats').append(row);});
  for(const id of ['chassisSelect','gearTune','suspTune'])$(id).disabled=raceState.started;for(const b of $('paintChoices').children)b.disabled=raceState.started;
  $('circuitDescription').textContent=circuitId($('circuitSelect').value)==='coastal'?'Long route · downtown, coast, countryside, long mountain tunnel and two pit stops.':'Original short circuit · one racing pit stop.';
  $('rulesDescription').textContent={arcade:'Mystery boxes, slipstream, skill credits and pit tuning.',clean:'No mystery boxes. Slipstream, driving credits and pit tuning.',pro:'No mystery boxes or mid-race tuning. Slipstream and pre-race setup.'}[$('raceRules').value];
}
function pitBox(p){const pit=nearestPit(p.x,p.z);return protectedPit(p)&&pit.u>=.44&&pit.u<=.56&&pit.dist<8&&Math.abs(p.speed)<2;}
function openPit(){if(!engineeringEnabled()||!raceStarted||player.finished||!pitBox(player)||localEngineering.rep<=0||Date.now()<(player.serviceUntil||0))return;clearKeys();player.speed=0;pitDraft=[...localEngineering.stats];$('pitOverlay').hidden=false;renderPit(true);$('pitStats').querySelector?.('input')?.focus?.();}
function renderPit(rebuild=false){if(!pitDraft)return;const controls=$('pitStats');if(rebuild){controls.replaceChildren();ATTRIBUTES.forEach((name,i)=>{const row=document.createElement('label');row.className='pit-stat';const text=document.createElement('span');text.textContent=name;const slider=document.createElement('input');slider.type='range';slider.min=CARS[garageSetup.chassis].limits[i][0];slider.max=CARS[garageSetup.chassis].limits[i][1];slider.step='.5';slider.value=pitDraft[i];slider.setAttribute('aria-label',name);const val=document.createElement('strong');row.append(text,slider,val);controls.append(row);slider.addEventListener('input',()=>{pitDraft[i]=Number(slider.value);renderPit();});});}
  [...controls.children].forEach((row,i)=>{row.lastChild.textContent=pitDraft[i].toFixed(1);row.querySelector('input').disabled=pitPending;});const sum=pitDraft.reduce((a,b)=>a+b,0),cost=transferCost(localEngineering.stats,pitDraft),available=Math.min(2,localEngineering.rep);$('pitBalance').textContent=`${sum.toFixed(1)} / 14 performance · ${cost.toFixed(1)} / ${available.toFixed(1)} REP`;
  $('pitMessage').textContent=pitPending?'Waiting for confirmation…':sum!==14?'Redistribute until the total is exactly 14.':cost>available?'Not enough available Engineering Points.':cost===0?'Move performance between attributes.':'Ready to apply · two-second service.';
  $('pitApply').disabled=pitPending||!validStats(garageSetup.chassis,pitDraft)||cost<=0||cost>available;$('pitCancel').disabled=pitPending;
}
function hostPitTune(id,stats){const r=getHostInventory(id),p=combatPositions().get(id),now=Date.now();const ok=engineeringEnabled()&&raceStarted&&p&&!p.finished&&pitBox(p)&&tune(r,stats,r.lap,now);if(ok)syncRecord(id);privatePacket(id,{type:'pit-result',round:raceState.round,ok:!!ok,reason:'Tuning unavailable: stop in the engineering box, check REP, and tune only once per lap.'});}
function updateRivalsHud(){if(!$('rivalsHud'))return;const racing=raceMode==='arcade'&&gameRunning;$('rivalsHud').hidden=!racing;const eng=engineeringEnabled();$('engineeringStatus').hidden=!eng;
  $('engineeringStatus').textContent=`REP ${localEngineering.rep.toFixed(1)} · SC ${localEngineering.credits}/3`;
  const now=Date.now(),effects=Object.entries(localEffects).filter(([k,v])=>v>now).map(([k,v])=>`${ITEMS[k]||({slow:'Recovering',slippery:'Low grip',immune:'Hit protection'}[k]||k)} ${Math.ceil((v-now)/1000)}s`);if(now<draftUntil)effects.push('Slipstream');if(now<(player.serviceUntil||0))effects.push('Pit service');$('effectStatus').textContent=effects.join(' · ')||'No active effects';
  const rivals=[{id:getLocalId(),lap:player.lap,u:player.u,finished:player.finished},...[...opponents.values()].filter(o=>Number.isFinite(o.u))];const sorted=rivals.sort((a,b)=>Number(b.finished)-Number(a.finished)||(b.lap+b.u)-(a.lap+a.u));const rank=sorted.findIndex(p=>p.id===getLocalId())+1;$('positionStatus').textContent=`P${rank} / ${sorted.length}`+(rank>1?` · ${Math.max(0,((sorted[0].lap+sorted[0].u-player.lap-player.u)*trackLength/69)).toFixed(1)}s est. gap`:'');
  const pit=racing&&eng&&raceStarted&&!player.finished&&pitBox(player);$('pitTuneButton').hidden=!pit;$('pitTuneButton').disabled=localEngineering.rep<=0||Date.now()<(player.serviceUntil||0);$('pitTuneButton').textContent=localEngineering.rep>0?'ENGINEER [P]':'ENGINEER · EARN REP';
}
function hostSkills(){
  const now=Date.now(),positions=combatPositions();positions.set(getLocalId(),{...sharedSnapshot(),id:getLocalId()});
  const active=[...positions].filter(([id,p])=>!p.finished&&Number.isFinite(p.x)&&Number.isFinite(p.z));
  const standings=active.map(([id,p])=>({id,p,progress:(Number(p.lap)||0)+(Number.isFinite(p.u)?p.u:getTrackClosest(p.x,p.z).u)})).sort((a,b)=>b.progress-a.progress);
  for(const [id,p] of positions){const r=getHostInventory(id);if(r.finished)continue;const lap=clamp(Math.floor(Number(p.lap)||0),0,raceSettings.laps),elapsed=Number(p.elapsed)||0;const track=getTrackClosest(p.x,p.z),u=Number.isFinite(p.u)?p.u:track.u;
    if(!r.telemetry){r.telemetry={incidents:Number(p.incidents)||0,offRoad:Number(p.offRoadTime)||0,lapTime:0,sector:Math.floor(u*8),sectorGood:true,sectorAt:now,sectorDistance:0,lastU:u};r.initialRank=standings.findIndex(x=>x.id===id)+1;r.bestRank=r.initialRank;r.passes=new Map();}
    const t=r.telemetry;const incidents=Math.max(0,(Number(p.incidents)||0)-t.incidents),offRoad=Math.max(0,(Number(p.offRoadTime)||0)-t.offRoad);r.incidents=Math.max(r.incidents,Number(p.incidents)||0);
    if(lap===r.lap+1){const duration=Number(p.lastLap)||elapsed-t.lapTime,competitive=duration>=trackLength/110*.76&&duration<=trackLength/35;
      if(competitive&&incidents===0&&offRoad<.5){r.clean++;skillAward(id,'clean-lap','Clean competitive lap');}
      if(competitive&&Number.isFinite(r.best)&&duration<r.best*.985)skillAward(id,'personal-best','Personal best lap');
      if(duration>=trackLength/110*.76)r.best=Math.min(r.best,duration);
      nextLap(r,lap);t.incidents=Number(p.incidents)||0;t.offRoad=Number(p.offRoadTime)||0;t.lapTime=elapsed;t.sectorGood=true;
    }
    const sector=Math.floor(u*8)%8,delta=((u-t.lastU+1.5)%1)-.5;t.lastU=u;t.sectorDistance+=Math.max(0,Math.min(.01,delta));
    if(track.dist>ROAD_HALF||incidents>0||Math.abs(Number(p.slip)||0)>.12||p.speed<28||protectedPit(p))t.sectorGood=false;
    if(sector!==t.sector){if(sector===(t.sector+1)%8&&t.sectorGood&&t.sectorDistance>.10&&[1,3,5,7].includes(t.sector)&&now-t.sectorAt>=4000)skillAward(id,'technical-sector','Clean technical sector');t.sector=sector;t.sectorAt=now;t.sectorGood=true;t.sectorDistance=0;}
    const me=standings.find(x=>x.id===id),rank=standings.findIndex(x=>x.id===id)+1;if(me){r.bestRank=Math.min(r.bestRank||rank,rank);r.worstRank=Math.max(r.worstRank||rank,rank);r.comeback=Math.max(r.comeback,r.worstRank-rank);for(const other of standings){if(other.id===id)continue;const diff=(me.progress-other.progress)*trackLength;let pass=r.passes.get(other.id);if(!pass){pass={behind:diff< -8,aheadAt:0,defendAt:0};r.passes.set(other.id,pass);}if(diff< -8){pass.behind=true;pass.aheadAt=0;}if(pass.behind&&diff>8&&diff<160&&p.speed>25&&!protectedPit(p)){if(!pass.aheadAt){pass.aheadAt=now;pass.drafted=!!p.recentDraft;pass.cleanIncidents=Number(p.incidents)||0;}if(now-pass.aheadAt>=5000&&(Number(p.incidents)||0)===pass.cleanIncidents){const key=`pass-${other.id}`;if(!r.events.has('count-'+key)){r.overtakes++;skillAward(id,key,(r.effects.slow||0)>now-25000?'Successful recovery':pass.drafted?'Slipstream overtake':r.worstRank>rank?'Position recovery':'Clean overtake');r.events.add('count-'+key);}pass.behind=false;}}else if(diff<=8)pass.aheadAt=0;
      if(diff>5&&diff<35&&p.speed>35){if(!pass.defendAt)pass.defendAt=now;}else if(pass.defendAt&&(diff<=5||diff>45||p.speed<=35)){if(diff>45&&now-pass.defendAt>=4000)skillAward(id,'defend-'+other.id,'Defensive driving');pass.defendAt=0;}
    }}
    if(p.finished)r.finished=true;
  }
}
function awardStats(id){const r=getHostInventory(id);return {fastest:Number.isFinite(r.best)?r.best:null,clean:r.clean,incidents:r.incidents,overtakes:r.overtakes,attacks:r.attacks,defences:r.defences,earned:r.earned,comeback:r.comeback};}
function renderAwards(results){const root=$('raceAwards');root.replaceChildren();if(!results.length)return;const awards=[['Grand Prix Champion',()=>results[0]],['Fastest Driver',()=>results.filter(r=>r.awards?.fastest>0).sort((a,b)=>a.awards.fastest-b.awards.fastest)[0]],['Clean Racer',()=>results.filter(r=>r.awards).sort((a,b)=>a.awards.incidents-b.awards.incidents||b.awards.clean-a.awards.clean)[0]],...([['Overtake Master','overtakes'],['Tactical Driver','attacks'],['Defensive Master','defences'],['Race Engineer','earned'],['Comeback King','comeback']].map(([label,key])=>[label,()=>results.filter(r=>r.awards?.[key]>0).sort((a,b)=>b.awards[key]-a.awards[key])[0]]))];for(const [label,get] of awards){const winner=get();if(!winner)continue;const line=document.createElement('div');line.className='award-line';const t=document.createElement('strong');t.textContent=label;const v=document.createElement('span');v.textContent=winner.name;line.append(t,v);root.append(line);}}

function setupEvents(){
  setupGarageUI();updateAudioButton();
  $('hudToggle').addEventListener('click',()=>{setHudHidden(!hudHidden);$('raceMain').focus({preventScroll:true});});
  $('audioToggle').addEventListener('click',()=>{toggleAudio();$('raceMain').focus({preventScroll:true});});
  document.addEventListener('click',e=>{if(e.target!==$('audioToggle'))audio.unlock();});
  document.addEventListener('pointerup',e=>{if(e.target!==$('audioToggle'))audio.unlock();});
  document.addEventListener('keydown',e=>{if(!e.repeat&&e.key.toLowerCase()!=='m'&&e.target!==$('audioToggle'))audio.unlock();});
  $('tourStart').addEventListener('click',()=>{resetNetwork();setMode('tour');announce('WELCOME TO THE RÉSUMÉ RUN',2.5);});
  $('arcadeStart').addEventListener('click',()=>{setMode('arcade');raceStarted=false;countdownEnd=0;$('welcomeOverlay').hidden=true;$('lobbyOverlay').hidden=false;$('waitingRoom').hidden=true;setLobbyError('');clearKeys();});
  $('lobbyBack').addEventListener('click',()=>{resetNetwork();$('lobbyOverlay').hidden=true;$('welcomeOverlay').hidden=false;clearKeys();});
  $('hostButton').addEventListener('click',hostRoom);$('joinButton').addEventListener('click',joinRoom);
  $('copyInvite').addEventListener('click',copyInvite);$('launchRace').addEventListener('click',launchHostedRace);
  $('soloButton').addEventListener('click',()=>{const laps=clamp(parseInt($('lapSelect').value,10)||3,2,12);resetNetwork();raceSettings.laps=laps;raceSettings.rules=mode($('raceRules').value);raceSettings.circuit=circuitId($('circuitSelect').value);raceState.name=cleanName($('playerName').value);beginArcadeRace({launchAt:Date.now()+3800,roster:[{id:'local',name:raceState.name,setup:garageSetup}]});});
  $('showGuide').addEventListener('click',()=>showGuide(true));$('guideClose').addEventListener('click',()=>showGuide(false));
  $('inspectButton').addEventListener('click',toggleInspect);
  $('towButton').addEventListener('click',pitTow);
  $('discardItem').addEventListener('click',discardItem);$('throwButton').addEventListener('click',fireBomb);$('touchBomb').addEventListener('click',fireBomb);
  $('cameraButton').addEventListener('click',toggleCamera);
  $('qualityButton').addEventListener('click',()=>{const order=['low','medium','high'];quality=order[(order.indexOf(quality)+1)%order.length];try{localStorage.setItem('rc-graphics-quality',quality);}catch{}applyQuality();});
  $('renderModeButton').addEventListener('click',()=>{
    if(compatibilityActive){setCompatibility(false);rendererCheckCount=0;rendererBlankCount=0;lastModeChange=performance.now()-1300;}
    else setCompatibility(true,'Manually selected');
  });
  viewport.addEventListener('webglcontextlost',e=>{e.preventDefault();setCompatibility(true,'WebGL context lost');});
  viewport.addEventListener('webglcontextrestored',()=>{rendererCheckCount=0;rendererBlankCount=0;});
  $('resetButton').addEventListener('click',()=>{if(!gameRunning)return;if(raceMode==='arcade'&&raceStarted){announce('RESET DISABLED DURING COMPETITIVE RACES',1.5);return;}const fuel=player.fuel;resetPlayer(INITIAL_POS,raceMode==='tour');if(raceMode==='arcade'){player.fuel=fuel;player.lap=0;player.travel=0;}announce('BACK ON THE GRID',1.4);});
  $('menuButton').addEventListener('click',()=>{
    clearKeys();gameRunning=false;raceStarted=false;resetNetwork();$('welcomeOverlay').hidden=false;$('lobbyOverlay').hidden=true;$('finishOverlay').hidden=true;$('raceGuide').hidden=true;
    raceMode='tour';selectCircuit('stadium');$('trackLabel').textContent=CIRCUITS.stadium.name.toUpperCase();$('mapMode').textContent=`${resume.length} STOPS`;player.colour=CAR_COLOURS[0];player.hex=PAINTS[0];player.chassis='apex';document.body.classList.remove('in-arcade');setupPits(resume.length);newScene();resetPlayer();
  });
  $('raceAgain').addEventListener('click',()=>{
    if(raceState.role==='solo'){beginArcadeRace({launchAt:Date.now()+3700,roster:[{id:'local',name:raceState.name,setup:garageSetup}]});return;}
    if(raceState.role==='host'){
      resetRoundToLobby();
      broadcast({type:'restart',round:raceState.round});sendRoster();
    }else if(raceState.role==='guest'){
      $('finishOverlay').hidden=true;$('lobbyOverlay').hidden=false;$('waitingRoom').hidden=false;
      $('roomStatus').textContent='WAITING FOR HOST TO RESET THE GRID';
    }
    roomRoster();
  });
  $('finishMenu').addEventListener('click',()=>$('menuButton').click());
  const controls={w:'up',ArrowUp:'up',s:'down',ArrowDown:'down',a:'left',ArrowLeft:'left',d:'right',ArrowRight:'right',' ':'drift',b:'brake',Shift:'boost'};
  document.addEventListener('keydown',e=>{
    if(e.key.toLowerCase()==='h'&&keysAllowed()&&!e.repeat){setHudHidden(!hudHidden);e.preventDefault();}
    if(e.key.toLowerCase()==='m'&&keysAllowed()&&!e.repeat){toggleAudio();e.preventDefault();}
    const key=controls[e.key]||controls[e.key.toLowerCase?.()];
    if(key&&keysAllowed()){keys[key]=true;e.preventDefault();}
    if((e.key==='e'||e.key==='E')&&keysAllowed()&&!e.repeat){toggleInspect();e.preventDefault();}
    else if((e.key==='e'||e.key==='E')&&inspector&&!e.repeat){toggleInspect();e.preventDefault();}
    if((e.key==='c'||e.key==='C')&&keysAllowed()&&!e.repeat){toggleCamera();e.preventDefault();}
    if((e.key==='x'||e.key==='X')&&keysAllowed()&&!e.repeat){discardItem();e.preventDefault();}
    if((e.key==='l'||e.key==='L')&&keysAllowed()&&!e.repeat){fireBomb();e.preventDefault();}
    if((e.key==='p'||e.key==='P')&&gameRunning&&!e.repeat){if(raceMode==='tour')showGuide($('raceGuide').hidden);else if(keysAllowed())openPit();e.preventDefault();}
    if((e.key==='t'||e.key==='T')&&keysAllowed()&&!e.repeat){pitTow();e.preventDefault();}
    if(e.key==='Escape'){
      if(!$('pitOverlay').hidden&&!pitPending){$('pitCancel').click();return;}
      if(inspector)inspector=null;
      else if(!$('raceGuide').hidden)showGuide(false);
    }
    if(inspector&&(e.key==='+'||e.key==='='||e.key==='-')){inspector.distance=clamp(inspector.distance+(e.key==='-'?4:-4),22,90);e.preventDefault();}
  });
  document.addEventListener('keyup',e=>{const key=controls[e.key]||controls[e.key.toLowerCase?.()];if(key)keys[key]=false;});
  window.addEventListener('blur',clearKeys);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearKeys();});
  viewport.addEventListener('wheel',e=>{if(inspector){inspector.distance=clamp(inspector.distance+Math.sign(e.deltaY)*3,22,90);e.preventDefault();}},{passive:false});
  viewport.addEventListener('pointerdown',()=>{if(gameRunning)viewport.focus();});
  for(const btn of document.querySelectorAll('[data-drive]')){
    const key=btn.dataset.drive;
    btn.addEventListener('pointerdown',e=>{e.preventDefault();btn.setPointerCapture(e.pointerId);if(keysAllowed())keys[key]=true;touchPointers.set(e.pointerId,key);});
    const release=(e)=>{keys[key]=false;touchPointers.delete(e.pointerId);};
    btn.addEventListener('pointerup',release);btn.addEventListener('pointercancel',release);btn.addEventListener('lostpointercapture',release);
  }
}
async function initialise(){
  try{
    await loadResume();
    setupEvents();
    setupPits(resume.length);newScene();resetPlayer();
    const search=new URLSearchParams(location.search);
    if(search.get('mode')==='arcade'||search.has('room')){
      setMode('arcade');raceStarted=false;countdownEnd=0;
      $('welcomeOverlay').hidden=true;$('lobbyOverlay').hidden=false;
      if(search.get('room')){$('roomInput').value=parseRoomCode(search.get('room'));setLobbyError('Enter your driver name and select JOIN ROOM.');}
    }
    requestAnimationFrame(tick);
  }catch(error){console.error('RC Grand Prix startup failure:',error?.stack||error);reportError(error.message||'WebGL initialisation failed. Try a modern browser.');}
}
window.RC_GAME_STATUS=()=>({mode:raceMode,gameRunning,raceStarted,
  round:raceState.round,networkRole:raceState.role,remotePlayers:raceState.remote.size,
  countdownMs:Math.max(0,Math.round(countdownEnd-performance.now())),
  position:{x:player.x,z:player.z},speed:player.speed,steer:player.steer,drifting:!!player.drifting,slip:player.slip||0,
  fuel:player.fuel,lap:player.lap,bombs:combat.held,stunnedMs:Math.max(0,combat.localStunUntil-Date.now()),rules:raceSettings.rules,circuit:activeCircuit,hudHidden,setup:garageSetup,engineering:localEngineering,items:combat.held,keys:{...keys},compatible:compatibilityActive,quality});
initialise();
