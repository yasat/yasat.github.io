/* RC Grand Prix — standalone Three.js / PeerJS game, deployable on GitHub Pages. */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { CompatibilityTrackRenderer } from './rc-compatibility.js?v=5';

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
const compatibilityForced = new URLSearchParams(location.search).get('renderer') === 'compat';
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
let raceSettings = { laps: 3 };
let resume = window.RC_RESUME_SNAPSHOT || [];
const keys = { up: false, down: false, left: false, right: false, brake: false, boost: false };
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
const trackCurve = new THREE.CatmullRomCurve3(trackNodes.map(([x,z])=>new THREE.Vector3(x*TRACK_SCALE,0,z*TRACK_SCALE)),true,'catmullrom',0.38);
const TRACK_SAMPLES = 840;
const trackPoints = Array.from({length:TRACK_SAMPLES+1},(_,i)=>trackCurve.getPointAt(i/TRACK_SAMPLES));
const trackTangents = Array.from({length:TRACK_SAMPLES+1},(_,i)=>trackCurve.getTangentAt(i/TRACK_SAMPLES));
let trackLength = trackCurve.getLength();
const stationColours = ['#a8e6bf','#f9b780','#c6b5ee','#f4d174','#8ad3e4','#ed99a3','#b6d79c','#edc6a9','#a2c9ff','#dfd3ab','#dbeca8'];
const INITIAL_POS = .025;
const PIT_SPAN = .067; // every lane runs for several hundred track metres
const PIT_BOARD_WIDTH = 36, PIT_BOARD_HEIGHT = 22;
const player = {x:0,z:0,heading:0,speed:0,fuel:1,boost:1,lap:0,travel:0,priorU:INITIAL_POS,u:INITIAL_POS,
  elapsed:0,lapAt:0,lastLap:0,fastest:Infinity,offRoad:false,inPit:false,pitVisit:null,boosting:false,
  mesh:null,colour:CAR_COLOURS[0],braking:false,finished:false,steer:0,rank:0};
const opponents = new Map();
const raceState = { role:'solo', peer:null,hostConn:null,connections:new Map(),remote:new Map(),roomCode:'',name:'Driver',hostId:'',joined:false,started:false,startTime:0,finishers:new Map(),pendingStart:null,round:0,roster:[],ready:new Set() };

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
function getTrackClosest(x,z) {
  let best=Infinity, posU=0, side=0;
  const p=trackPoints;
  for (let i=0;i<TRACK_SAMPLES;i++) {
    const a=p[i], b=p[i+1], dx=b.x-a.x, dz=b.z-a.z, len2=dx*dx+dz*dz;
    const r=clamp(((x-a.x)*dx+(z-a.z)*dz)/len2,0,1),qx=a.x+dx*r,qz=a.z+dz*r;
    const d=(x-qx)**2+(z-qz)**2;
    if(d<best){best=d;posU=(i+r)/TRACK_SAMPLES;side=(x-qx)*dz-(z-qz)*dx;}
  }
  return {dist:Math.sqrt(best),u:posU,side:Math.sign(side)};
}
function getPitClosest(x,z,pit){
  const pts=pit.points;
  let best=Infinity,posU=0;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i],b=pts[i+1],dx=b.x-a.x,dz=b.z-a.z;
    const v=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
    const d=(x-a.x-dx*v)**2+(z-a.z-dz*v)**2;
    if(d<best){best=d;posU=(i+v)/(pts.length-1);}
  }
  return {dist:Math.sqrt(best),u:posU,pit};
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
    const t=(i+.5)/count;
    const span=Math.min(PIT_SPAN, .80/count);
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
function createRibbon(points,minOffset,maxOffset,y,baseColor,alternates=false) {
  const vertices=[],colours=[],indices=[];
  for(let i=0;i<points.length-1;i++) {
    const p=points[i],p0=points[Math.max(0,i-1)],p1=points[Math.min(points.length-1,i+1)],p2=points[Math.min(points.length-1,i+2)];
    const tang=p1.clone().sub(p0).add(p2.clone().sub(p)).normalize();
    const n=new THREE.Vector3(tang.z,0,-tang.x);
    const a=points[i],b=points[i+1];
    const quad=[a.clone().addScaledVector(n,minOffset),a.clone().addScaledVector(n,maxOffset),
      b.clone().addScaledVector(n,maxOffset),b.clone().addScaledVector(n,minOffset)];
    const col=new THREE.Color(alternates?(Math.floor(i/3)%2===0?0xf5f3e3:baseColor):baseColor);
    quad.forEach(q=>{vertices.push(q.x,y,q.z);colours.push(col.r,col.g,col.b);});
    const k=i*4;indices.push(k,k+2,k+1,k,k+3,k+2);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  return new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));
}
function addRibbon(path,lo,hi,y,color,alt=false,group=worldObjects){const m=createRibbon(path,lo,hi,y,color,alt);group.add(m);return m;}
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
  const material=new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide});
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),material);m.position.copy(pos);m.rotation.y=angle;group.add(m);return m;
}
function buildGrassTexture(){
  const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');
  g.fillStyle='#668f6b';g.fillRect(0,0,512,512);
  let seed=85447;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<18000;i++){const x=random()*512,y=random()*512;g.fillStyle=i%3===0?'rgba(13,62,48,.14)':i%3===1?'rgba(198,207,130,.18)':'rgba(242,230,169,.09)';g.fillRect(x,y,2+random()*4,2+random()*5);}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(25,25);t.colorSpace=THREE.SRGBColorSpace;return t;
}
function addTrack(){
  const g=new THREE.Mesh(new THREE.PlaneGeometry(3400,2500),new THREE.MeshStandardMaterial({map:buildGrassTexture(),color:0xffffff,roughness:1}));g.rotation.x=-Math.PI/2;g.position.y=-.45;g.receiveShadow=true;worldObjects.add(g);
  const drain=new THREE.Mesh(new THREE.PlaneGeometry(3400,2500),new THREE.MeshStandardMaterial({color:0x456454,transparent:true,opacity:.08}));drain.rotation.x=-Math.PI/2;drain.position.y=-.42;worldObjects.add(drain);
  addRibbon(trackPoints,-29,29,-.08,0x82917b);
  asphaltMesh=addRibbon(trackPoints,-ROAD_HALF,ROAD_HALF,.07,0x2c3537);
  addRibbon(trackPoints,-ROAD_HALF-3,-ROAD_HALF,.1,0xda574c,true);
  addRibbon(trackPoints,ROAD_HALF,ROAD_HALF+3,.1,0xda574c,true);
  addRibbon(trackPoints,-ROAD_HALF+1,-ROAD_HALF+1.5,.14,0xe7e7d7);
  addRibbon(trackPoints,ROAD_HALF-1.5,ROAD_HALF-1,.14,0xe7e7d7);
  const gridP=trackCurve.getPointAt(0),t=trackCurve.getTangentAt(0),n=new THREE.Vector3(t.z,0,-t.x);
  for(let lane=0;lane<10;lane++){
    const side=-18+lane*3.7;
    for(let r=0;r<2;r++){
      const q=gridP.clone().addScaledVector(n,side).addScaledVector(t,r*4);
      const checker=solidBox(3.7,.06,3.8,(lane+r)%2?0xf2f0db:0x172e31,q.x,.19,q.z);
      checker.rotation.y=getHeading(t);
    }
  }
  for(let line=0;line<12;line++){
    const center=trackCurve.getPointAt((.99-line*.006+1)%1),dir=trackCurve.getTangentAt((.99-line*.006+1)%1),nr=new THREE.Vector3(dir.z,0,-dir.x);
    for(let side of [-1,1]){
      let p=center.clone().addScaledVector(nr,side*12);const mark=solidBox(2,.05,6,0xd9dbc9,p.x,.20,p.z);mark.rotation.y=getHeading(dir);
    }
  }
  const gateP=trackCurve.getPointAt(0),gateT=trackCurve.getTangentAt(0),gateNormal=new THREE.Vector3(gateT.z,0,-gateT.x);
  for(const s of [-1,1]){const p=gateP.clone().addScaledVector(gateNormal,s*27);addCylinder(1.3,1.7,24,0x163c39,p.x,12,p.z);}
  const gantryText=addWorldLabel('GHANTA  /  RC  GRAND PRIX',gateP.clone().setY(23),52,8,'#16352e','#e0f2a2',getHeading(gateT));
  gantryText.userData.billboard=false;
}
function placeArcadeBoostPads(){
  for(const t of [.12,.36,.62,.86]){
    const p=trackCurve.getPointAt(t),dir=trackCurve.getTangentAt(t);
    const m=solidBox(16,.07,13,0x4a9b84,p.x,.25,p.z);m.rotation.y=getHeading(dir);m.material.emissive=new THREE.Color(0x236c4d);m.material.emissiveIntensity=.5;
    addWorldLabel('>> BOOST',p.clone().setY(.42),11,3,'#2e7864','#d9fd9b',getHeading(dir)-Math.PI/2);
  }
}
function createServiceLane(pit){
  addRibbon(pit.points,-PIT_HALF-5,PIT_HALF+5,.045,0x708778);
  addRibbon(pit.points,-PIT_HALF,PIT_HALF,.12,0x35454a);
  addRibbon(pit.points,-PIT_HALF,-PIT_HALF+1.4,.16,0xdde9d4);
  addRibbon(pit.points,PIT_HALF-1.4,PIT_HALF,.16,0xdde9d4);
  // Pair of clear directional markers at the true drive-through entrance.
  const entrance=pit.curve.getPointAt(.10),entranceTan=pit.curve.getTangentAt(.10);
  const name=raceMode==='tour'?`PIT ${String(pit.index+1).padStart(2,'0')} · ${pit.info.name.toUpperCase()}`:'FUEL · DRIVE THROUGH';
  addWorldLabel(name,entrance.clone().setY(11),37,5.5,'#133a36','#e4f5a3',getHeading(entranceTan));
  for(const side of [-1,1]){
    const normal=new THREE.Vector3(entranceTan.z,0,-entranceTan.x);
    const p=entrance.clone().addScaledVector(normal,side*16);
    addCylinder(.45,.72,12,0x26584d,p.x,6,p.z);
  }
  const centre=pit.curve.getPointAt(.5),tangent=pit.curve.getTangentAt(.5),normal=new THREE.Vector3(tangent.z,0,-tangent.x);
  const out=normal.dot(pit.n)>=0?1:-1;
  const ap=centre.clone().addScaledVector(normal,out*138).setY(0);
  const garage=solidBox(29,9,18,raceMode==='tour'?0x284e48:0x335b60,ap.x,5.5,ap.z);garage.rotation.y=getHeading(tangent);
  const roof=solidBox(32,1.3,21,0xd7e7d4,ap.x,10.8,ap.z);roof.rotation.y=garage.rotation.y;
  addWorldLabel(raceMode==='tour'?`SG · PIT ${String(pit.index+1).padStart(2,'0')}`:'FUEL & TYRES',ap.clone().setY(8),24,4,'#123733','#e4f3ad',getHeading(tangent));
  if(raceMode==='tour')createStationBillboards(pit);
  const refuel=addWorldLabel('FULL TANK  /  DRIVE THROUGH',centre.clone().setY(3.5),23,3,'#e7f6b7','#16423b',getHeading(tangent));refuel.userData.pitLabel=true;
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
    pit.boards.push({item,mesh,worldPos:new THREE.Vector3(pos.x,h/2+3,pos.z),towards,
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
    if(load&&!pit.loaded){for(const board of pit.boards){const t=makePoster(board);board.texture=t;board.mesh.material.map=t;board.mesh.material.color.set(0xffffff);board.mesh.material.needsUpdate=true;}pit.loaded=true;}
    if(!load&&pit.loaded&&dist>340&&!force){for(const board of pit.boards){board.mesh.material.map=null;board.mesh.material.color.set(0xf1f3e7);board.mesh.material.needsUpdate=true;board.texture?.dispose();board.texture=null;}pit.loaded=false;}
  }
}
function seededRandom(seed=142857){let k=seed>>>0;return()=>{k=(Math.imul(k,1664525)+1013904223)>>>0;return k/4294967296;};}
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
    const x=(rand()-.5)*1520,z=(rand()-.5)*1220;
    const trackDist=getTrackClosest(x,z).dist;
    if(trackDist<52)continue;
    if(stationData.some(p=>getPitClosest(x,z,p).dist<53))continue;
    if(Math.abs(x)>750||Math.abs(z)>570)continue;
    const scale=.8+rand()*1.4;
    treePositions.push({x,z,scale,ang:rand()*TWO_PI});
    if(treePositions.length>=320)break;
  }
  sceneryTrees=treePositions;
  const trees=treePositions.length;
  const treeMat=new THREE.MeshStandardMaterial({color:PINE_GREEN,roughness:1,flatShading:true});
  const crownGeom=new THREE.ConeGeometry(8,26,7);
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(1.6,2.1,8,6),new THREE.MeshStandardMaterial({color:0x71594a,roughness:1}),trees);
  const crowns=new THREE.InstancedMesh(crownGeom,treeMat,trees);
  const tops=new THREE.InstancedMesh(new THREE.ConeGeometry(5,18,7),new THREE.MeshStandardMaterial({color:0x3c7153,roughness:1,flatShading:true}),trees);
  const o=new THREE.Object3D();
  treePositions.forEach((tree,i)=>{
    o.position.set(tree.x,3.8*tree.scale,tree.z);o.rotation.y=tree.ang;o.scale.setScalar(tree.scale);o.updateMatrix();trunks.setMatrixAt(i,o.matrix);
    o.position.y=15*tree.scale;o.updateMatrix();crowns.setMatrixAt(i,o.matrix);
    o.position.y=27*tree.scale;o.updateMatrix();tops.setMatrixAt(i,o.matrix);
    const c=new THREE.Color().setHSL(.32+rand()*.1,.19+rand()*.17,.24+rand()*.13);crowns.setColorAt(i,c);
  });
  for(const t of [trunks,crowns,tops]){t.castShadow=true;t.receiveShadow=true;t.instanceMatrix.needsUpdate=true;worldObjects.add(t);}
  for(let i=0;i<37;i++){
    const a=i/37*TWO_PI,r=720+rand()*160;
    const x=Math.cos(a)*r,z=Math.sin(a)*r*.82;
    const m=new THREE.Mesh(new THREE.ConeGeometry(110+rand()*90,105+rand()*135,7),new THREE.MeshStandardMaterial({color:i%3===0?0x789b81:0x698b79,flatShading:true,roughness:1}));
    m.position.set(x,48,z);m.rotation.y=rand()*TWO_PI;worldObjects.add(m);
  }
  // Spectator grandstands, clustered along the outside of the racing line.
  for(const u of [.09,.23,.48,.73,.91]){
    const p=trackCurve.getPointAt(u),tan=trackCurve.getTangentAt(u);
    let n=new THREE.Vector3(tan.z,0,-tan.x),side=(p.x*n.x+p.z*n.z)>=0?1:-1;
    n.multiplyScalar(side);
    const pos=p.clone().addScaledVector(n,65);
    const group=new THREE.Group();group.position.set(pos.x,0,pos.z);group.rotation.y=getHeading(tan);
    worldObjects.add(group);
    solidBox(125,5,45,0x496c63,0,2.5,0,group);
    const people=new THREE.InstancedMesh(new THREE.CylinderGeometry(.9,1.1,2,5),new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),7*19);
    const dummy=new THREE.Object3D();let spectator=0;
    for(let step=0;step<7;step++){
      solidBox(120,1.2,5.1,step%2?0x9fb2a4:0xccd3ad,0,5.3+step*2,-18+step*5.1,group);
      for(let person=0;person<19;person++){
        dummy.position.set(-55+person*6+rand()*2,7+step*2,-17+step*5.1);dummy.updateMatrix();
        people.setMatrixAt(spectator,dummy.matrix);
        people.setColorAt(spectator,new THREE.Color(person%5===0?0xe1d3a4:person%4===0?0xe48b6f:0x294f50));
        spectator++;
      }
    }
    people.castShadow=true;people.instanceMatrix.needsUpdate=true;group.add(people);
    const roof=solidBox(131,2.5,52,0xe9e8ca,0,21.8,0,group);roof.castShadow=true;
    for(const s of [-1,1])for(const z of [-1,1])solidBox(1.3,23,1.3,0xd4d6be,s*59,11.3,z*19,group);
    addWorldLabel('SG GRANDSTAND',group.localToWorld(new THREE.Vector3(0,24,-25)),46,5,'#143a35','#deeea5',group.rotation.y);
  }
  // Floodlights and light towers distributed around the circuit.
  for(const u of [.04,.16,.28,.40,.52,.64,.76,.88]){
    const p=trackCurve.getPointAt(u),tan=trackCurve.getTangentAt(u),n=new THREE.Vector3(tan.z,0,-tan.x);
    n.multiplyScalar((p.x*n.x+p.z*n.z)>=0?1:-1);
    const pos=p.clone().addScaledVector(n,53);
    addCylinder(.8,1.5,45,0xb7c9b9,pos.x,22,pos.z);
    const flood=solidBox(17,4,2,0xf7efd5,pos.x,44.5,pos.z);flood.material.emissive=new THREE.Color(0xececc2);flood.material.emissiveIntensity=.2;
    const pole=solidBox(6,.5,2,0x37504b,pos.x,47,pos.z);
  }
  // Small lakes, rock clusters and shrubs away from driving surfaces.
  for(const [x,z,rad] of [[610,390,53],[-670,-390,43],[630,-420,39]]){
    const pond=new THREE.Mesh(new THREE.CircleGeometry(rad,50),new THREE.MeshStandardMaterial({color:0x528e99,metalness:.13,roughness:.35}));pond.rotation.x=-Math.PI/2;pond.position.set(x,-.15,z);worldObjects.add(pond);
    const border=new THREE.Mesh(new THREE.RingGeometry(rad,rad+6,64),new THREE.MeshStandardMaterial({color:0xa1ae91,side:THREE.DoubleSide}));border.rotation.x=-Math.PI/2;border.position.set(x,-.10,z);worldObjects.add(border);
  }
  for(let i=0;i<140;i++){
    const x=(rand()-.5)*1450,z=(rand()-.5)*1100;if(getTrackClosest(x,z).dist<40)continue;
    if(stationData.some(p=>getPitClosest(x,z,p).dist<40))continue;
    const b=new THREE.Mesh(new THREE.DodecahedronGeometry(2+rand()*5,0),new THREE.MeshStandardMaterial({color:i%3===0?0xbfc8ac:0x667e68,roughness:1,flatShading:true}));
    b.position.set(x,1,z);b.scale.y=.6;b.rotation.y=rand()*TWO_PI;worldObjects.add(b);
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
function makeCar(colour=CAR_COLOURS[0],label=''){
  const grp=new THREE.Group(),paint=new THREE.MeshStandardMaterial({color:colour,metalness:.16,roughness:.37});
  const dark=new THREE.MeshStandardMaterial({color:0x13262c,metalness:.06,roughness:.55});
  const black=new THREE.MeshStandardMaterial({color:0x0c1517,roughness:.95});
  const pale=new THREE.MeshStandardMaterial({color:0xe4e8da,roughness:.58});
  const light=new THREE.MeshStandardMaterial({color:0xfbf3c0,emissive:0xe0e29c,emissiveIntensity:.45});
  const red=new THREE.MeshStandardMaterial({color:0xf06564,emissive:0xbf333a,emissiveIntensity:.4});
  function b(w,h,d,x,y,z,mat){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;grp.add(mesh);return mesh;}
  b(8,1.3,15,0,2.4,0,dark);
  b(7.4,2.2,12.5,0,3.7,-.3,paint);
  b(6.5,2.1,5,0,5.15,1.2,dark);
  b(6,1.2,3.5,0,6.2,2,paint);
  b(5.5,.45,3.2,0,6.9,1.4,dark);
  b(9,1,2,0,3.0,-7.0,dark);
  b(9,1,2,0,3.0,7.1,dark);
  b(8,.5,3,0,6.4,6.4,paint);
  b(1,3,.8,-3.3,5.6,6.2,dark);b(1,3,.8,3.3,5.6,6.2,dark);
  b(2,.65,.45,-2.2,4.2,-7.2,light);b(2,.65,.45,2.2,4.2,-7.2,light);
  b(2,.65,.45,-2.2,4.2,7.2,red);b(2,.65,.45,2.2,4.2,7.2,red);
  b(5.9,.2,1,0,4.88,-4.1,pale);
  for(const x of [-4.3,4.3])for(const z of [-4.8,4.8]){
    const wheel=new THREE.Mesh(new THREE.CylinderGeometry(2.2,2.2,2,12),black);
    wheel.rotation.z=Math.PI/2;wheel.position.set(x,2.3,z);wheel.castShadow=true;grp.add(wheel);
    const rim=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.1,2.08,10),new THREE.MeshStandardMaterial({color:0xc4ced0,metalness:.7,roughness:.35}));
    rim.rotation.z=Math.PI/2;rim.position.copy(wheel.position);grp.add(rim);
  }
  const antenna=b(.18,11,.18,2.2,11.6,4.8,dark);
  const antennaBall=new THREE.Mesh(new THREE.SphereGeometry(.7,8,8),red);antennaBall.position.set(2.2,17,4.8);grp.add(antennaBall);
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(9,20),new THREE.MeshBasicMaterial({color:0x081b1b,transparent:true,opacity:.24,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2;shadow.scale.set(1,1.4,1);shadow.position.y=.27;grp.add(shadow);
  grp.scale.setScalar(.54); // true RC-sized vehicle relative to a full race lane
  if(label){
    const text=makeLabelTexture([label.slice(0,18)],'#e2f7b0','#12342d',512,104);
    const nametag=new THREE.Sprite(new THREE.SpriteMaterial({map:text,depthTest:false}));
    nametag.position.set(0,19,0);nametag.scale.set(26,6,1);grp.add(nametag);
  }
  return grp;
}
function setCarPose(car,x,z,heading){car.position.set(x,0,z);car.rotation.y=heading;}
function newScene(){
  if(!renderer){
    renderer=new THREE.WebGLRenderer({canvas:viewport,antialias:true,alpha:false,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.17;
    camera=new THREE.PerspectiveCamera(62,1,.15,4500);
    window.addEventListener('resize',resizeRenderer,{passive:true});
  }
  if(scene){for(const ch of [...scene.children])scene.remove(ch);disposeObject(ch);}
  scene=new THREE.Scene();scene.background=new THREE.Color(0x9dccc9);scene.fog=new THREE.FogExp2(0x9bc4b6,.00061);
  scene.add(new THREE.HemisphereLight(0xe6f5e8,0x5f755b,2.15));
  sun=new THREE.DirectionalLight(0xfff1d5,2.35);sun.position.set(-220,450,170);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.left=-650;sun.shadow.camera.right=650;sun.shadow.camera.top=620;sun.shadow.camera.bottom=-620;sun.shadow.camera.far=1300;sun.shadow.bias=-.00022;scene.add(sun);
  const ambientFill=new THREE.DirectionalLight(0xb8e4d8,.35);ambientFill.position.set(300,130,-300);scene.add(ambientFill);
  worldObjects=new THREE.Group();scene.add(worldObjects);
  addTrack();
  stationData.forEach(createServiceLane);
  if(raceMode==='arcade')placeArcadeBoostPads();
  addTreesAndLandscape();
  player.mesh=makeCar(player.colour);scene.add(player.mesh);
  for(const state of opponents.values()){state.mesh=makeCar(state.colour,state.name);scene.add(state.mesh);}
  resizeRenderer();
  if(!compatibilityRenderer)compatibilityRenderer=new CompatibilityTrackRenderer($('compatCanvas'),trackPoints,trackTangents);
  compatibilityRenderer.setPits(stationData);
  compatibilityRenderer.setTrees(sceneryTrees);
  rendererCheckCount=0;rendererBlankCount=0;lastRendererCheck=0;
  sceneReady=true;
  if(compatibilityForced)setCompatibility(true,'Requested by URL');
}
function disposeObject(root){
  root.traverse(o=>{
    if(o.geometry)o.geometry.dispose();
    if(o.material){for(const mat of (Array.isArray(o.material)?o.material:[o.material])){if(mat.map)mat.map.dispose();mat.dispose();}}
  });
}
function resizeRenderer(){
  if(!renderer)return;
  const rect=viewport.getBoundingClientRect();if(rect.width<1||rect.height<1)return;
  renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();
}
function resetPlayer(u=INITIAL_POS,full=true){
  const pos=trackCurve.getPointAt(u),t=trackCurve.getTangentAt(u);
  player.x=pos.x;player.z=pos.z;player.heading=getHeading(t);player.speed=0;
  player.u=u;player.priorU=u;player.travel=0;player.lap=0;player.lapAt=0;player.elapsed=0;player.lastLap=0;player.fastest=Infinity;
  player.pitVisit=null;player.inPit=false;player.offRoad=false;player.finished=false;player.boost=1;player.steer=0;clearKeys();player._fuelWarn=false;player._emptyWarn=false;
  if(full)player.fuel=1;
  inspector=null;cameraMode=0;$('cameraName').textContent='CHASE';
  localFinishTime=null;setCarPose(player.mesh,player.x,player.z,player.heading);
  camera.position.set(player.x+40,46,player.z+85);
  vectors.currentTarget.set(player.x,4,player.z);
  updateDashboard();
}
function placeCarOnLane(pit,q=.08){
  const p=pit.curve.getPointAt(q),t=pit.curve.getTangentAt(q);
  player.x=p.x;player.z=p.z;player.heading=getHeading(t);player.speed=0;player.steer=0;player.pitVisit=null;player.inPit=true;
  player.priorU=(pit.startT+pit.span*q+1)%1;player.u=player.priorU;
  inspector=null;setCarPose(player.mesh,player.x,player.z,player.heading);
}
function setMode(mode){
  if(raceMode===mode&&gameRunning){
    raceEnded=false;raceStarted=mode==='tour';countdownEnd=0;resetPlayer();
    $('finishOverlay').hidden=true;$('lobbyOverlay').hidden=true;$('welcomeOverlay').hidden=true;
    return;
  }
  worldVersion++;
  raceMode=mode;gameRunning=true;raceEnded=false;raceStarted=mode==='tour';countdownEnd=0;lastModeChange=performance.now();
  setupPits(mode==='tour'?resume.length:1);
  newScene();resetPlayer();
  $('modeLabel').textContent=mode==='tour'?'PADDOCK / RÉSUMÉ TOUR':'ARCADE / GRAND PRIX';
  $('lapLabel').textContent=mode==='tour'?'LAPS DRIVEN':'RACE LAPS';
  $('fuelHint').textContent='≈ 2 full-speed laps / tank';
  $('boostHud').hidden=mode!=='arcade';
  $('pitCount').textContent=mode==='tour'?`${stationData.length} PIT STOPS`:'1 PIT STOP';
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
function keysAllowed(){return gameRunning&&(raceStarted||countdownEnd>performance.now())&&$('welcomeOverlay').hidden&&$('lobbyOverlay').hidden&&$('finishOverlay').hidden&&$('raceGuide').hidden&&!inspector&&!player.finished;}
function updatePhysics(dt){
  if(!gameRunning||!raceStarted||inspector||!$('raceGuide').hidden||raceEnded)return;
  dt=Math.min(dt,.04);
  player.elapsed+=dt;
  const track=getTrackClosest(player.x,player.z),pit=nearestPit(player.x,player.z);
  const pitLane=pit.dist<PIT_HALF+1&&(track.dist>ROAD_HALF-2||pit.dist<track.dist-6);
  player.inPit=pitLane;
  player.offRoad=!(track.dist<ROAD_HALF+4||pit.dist<PIT_HALF+3);
  const maxSpeed=player.offRoad?29:pitLane?35:69;
  const boosting=raceMode==='arcade'&&keys.boost&&player.boost>.012&&player.fuel>0&&!player.offRoad&&!pitLane;
  player.boosting=boosting;
  const speedLimit=maxSpeed*(boosting?1.37:1);
  const accelerating=keys.up&&player.fuel>0;
  const reversing=keys.down&&player.fuel>0;
  if(accelerating)player.speed+=38*dt*(boosting?1.30:1);
  else if(reversing)player.speed-=46*dt;
  else player.speed=THREE.MathUtils.damp(player.speed,0,player.offRoad?1.9:.53,dt);
  player.braking=keys.brake;
  if(keys.brake)player.speed=THREE.MathUtils.damp(player.speed,0,4.8,dt);
  if(player.speed>speedLimit)player.speed=THREE.MathUtils.damp(player.speed,speedLimit,3.5,dt);
  player.speed=clamp(player.speed,-19,boosting?95:maxSpeed);
  player.boost=boosting?Math.max(0,player.boost-dt*.24):Math.min(1,player.boost+dt*(pitLane?.2:.05));
  // Smoothed, speed-sensitive RC steering: no frame-by-frame instant rotation.
  // On track, a light steering assist prevents an uncommanded straight-on departure
  // through each curve, without preventing the player from leaving the road.
  const input=(keys.right?1:0)-(keys.left?1:0);
  player.steer=THREE.MathUtils.damp(player.steer,input,7.5,dt);
  const speedMagnitude=Math.abs(player.speed);
  if(speedMagnitude>0.8){
    const steerStrength=1.30/(1+speedMagnitude/55);
    const yaw=player.steer*steerStrength*clamp(speedMagnitude/19,0,1)*Math.sign(player.speed);
    player.heading+=yaw*dt;
    if(Math.abs(input)<.01&&Math.abs(player.steer)<.25&&!player.offRoad&&speedMagnitude>12){
      const lane=pitLane?pit.pit?.curve:null;
      const tangent=lane?lane.getTangentAt(pit.u):trackCurve.getTangentAt(track.u);
      if(tangent){
        const suggested=getHeading(tangent);
        const error=Math.atan2(Math.sin(suggested-player.heading),Math.cos(suggested-player.heading));
        if(Math.abs(error)<.85)player.heading+=error*dt*.65;
      }
    }
  }
  const step=player.speed*dt;
  player.x+=Math.sin(player.heading)*step;player.z-=Math.cos(player.heading)*step;
  if(Math.abs(player.x)>1750||Math.abs(player.z)>1350){player.x=clamp(player.x,-1745,1745);player.z=clamp(player.z,-1345,1345);player.speed*=.1;}
  if(player.speed>0&&player.fuel>0)player.fuel=Math.max(0,player.fuel-step/(2*trackLength));
  if(player.fuel<=0){player.speed=THREE.MathUtils.damp(player.speed,0,3.2,dt);if(Math.abs(player.speed)<.12)player.speed=0;}
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
  setCarPose(player.mesh,player.x,player.z,player.heading);
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
      if(player.lap>=raceSettings.laps)finishLocalRace();
    }
  }
  player.priorU=u;player.u=u;
}
function updateOpponentMeshes(dt){
  for(const [id,op] of opponents){
    if(!op.mesh)continue;
    const factor=1-Math.exp(-dt*10);
    op.mesh.position.x=THREE.MathUtils.lerp(op.mesh.position.x,op.x,factor);
    op.mesh.position.z=THREE.MathUtils.lerp(op.mesh.position.z,op.z,factor);
    let diff=((op.heading-op.mesh.rotation.y+Math.PI)%TWO_PI+TWO_PI)%TWO_PI-Math.PI;
    op.mesh.rotation.y+=diff*factor;
  }
}
function updateCamera(dt){
  if(!sceneReady||!player.mesh)return;
  const c=player,heading=c.heading;
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
  const distance=cameraMode===0?58:cameraMode===1?95:cameraMode===2?25:0;
  const height=cameraMode===0?31:cameraMode===1?110:cameraMode===2?10:245;
  let desire=new THREE.Vector3(c.x-Math.sin(heading)*distance,height,c.z+Math.cos(heading)*distance);
  const target=new THREE.Vector3(c.x+Math.sin(heading)*18,5,c.z-Math.cos(heading)*18);
  if(cameraMode===3){desire.set(c.x,235,c.z+1);target.set(c.x,0,c.z);}
  camera.position.lerp(desire,1-Math.exp(-dt*4.3));
  vectors.currentTarget.lerp(target,1-Math.exp(-dt*5.8));
  camera.fov=THREE.MathUtils.lerp(camera.fov,cameraMode===3?53:62,Math.min(1,dt*4));camera.updateProjectionMatrix();
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
    if(!latestClosestBoard.texture){const pit=latestClosestBoard.station;for(const board of pit.boards){if(!board.texture){board.texture=makePoster(board);board.mesh.material.map=board.texture;board.mesh.material.needsUpdate=true;}}pit.loaded=true;}
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
  if(raceMode==='arcade'){player.elapsed+=20;}
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
  $('pitStationName').textContent=raceMode==='tour'?active.info.name:'THE FUEL LANE';
  $('pitStationDescription').textContent=raceMode==='tour'?(active.info.lead||'Read the résumé billboards along this curved pit lane.'):'One curved pit lane. Drive all the way through to refill, then launch back onto the main racing circuit.';
  $('pitNext').textContent=raceMode==='tour'?active.info.name:'FUEL & TYRES';
  if(raceMode==='tour')$('pitCount').textContent=`${stationData.length} PIT STOPS`;
  $('fuelHint').textContent=player.fuel<.15?'Refuel by driving through a complete pit lane': '≈ 2 full-speed laps / tank';
  $('towButton').hidden=player.fuel>.03||raceEnded||player.finished;
}
function updateMinimap(){
  if(!sceneReady)return;
  const cvs=$('miniMap'),ctx=cvs.getContext('2d'),W=cvs.width,H=cvs.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0c2627';ctx.fillRect(0,0,W,H);
  const bounds={minX:-1090,maxX:1100,minZ:-770,maxZ:775},sx=(W-18)/(bounds.maxX-bounds.minX),sz=(H-14)/(bounds.maxZ-bounds.minZ);
  const fit=Math.min(sx,sz),offX=(W-(bounds.maxX-bounds.minX)*fit)/2,offY=(H-(bounds.maxZ-bounds.minZ)*fit)/2;
  const point=(p)=>[offX+(p.x-bounds.minX)*fit,H-(offY+(p.z-bounds.minZ)*fit)];
  ctx.strokeStyle='#678781';ctx.lineWidth=7;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
  trackPoints.forEach((p,i)=>{let [x,y]=point(p);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
  ctx.strokeStyle='#d8e7cf';ctx.lineWidth=.8;ctx.stroke();
  for(const p of stationData){ctx.strokeStyle=raceMode==='tour'?'#eeb080':'#d8f386';ctx.lineWidth=3.5;ctx.beginPath();p.points.forEach((pt,i)=>{const [x,y]=point(pt);if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();}
  for(const opponent of opponents.values()){const [x,y]=point(opponent);ctx.fillStyle=opponent.hex||'#faa379';ctx.beginPath();ctx.arc(x,y,3.6,0,TWO_PI);ctx.fill();}
  const [x,y]=point(player);ctx.save();ctx.translate(x,y);ctx.rotate(-player.heading);ctx.fillStyle='#d7f36b';ctx.strokeStyle='#15352d';ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(-5,5);ctx.lineTo(5,5);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}
function tick(now){
  const dt=Math.min(.055,(now-lastTick)/1000||.016);lastTick=now;lastFrameDt=dt;
  if(sceneReady){
    if(raceMode==='arcade'&&countdownEnd>0&&!raceStarted){
      const left=(countdownEnd-now)/1000;
      if(left<=0){countdownEnd=0;raceStarted=true;raceState.started=true;announce('GO! GO! GO!',1.5);}
      else if(left<=3.95){const count=Math.max(1,Math.ceil(left));const text=`${count}`;if(currentBanner!==text||showBannerUntil<now)announce(text,.82);}
    }
    updatePhysics(dt);updateOpponentMeshes(dt);updateCamera(dt);
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
      compatibilityRenderer.render({camera,player,opponents,inspector,mode:raceMode});
      lastCompatibilityFrame=now;
    }
    hudClock+=dt;texturesClock+=dt;minimapClock+=dt;networkClock+=dt;
    if(hudClock>.13){updateDashboard();updateClosestBoard();hudClock=0;}
    if(texturesClock>.9){refreshVisiblePosters();texturesClock=0;}
    if(minimapClock>.16){updateMinimap();minimapClock=0;}
    if(networkClock>.095){networkTick();networkClock=0;}
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
function resetNetwork(){
  if(raceState.peer){try{raceState.peer.destroy();}catch{}}
  raceState.peer=null;raceState.hostConn=null;raceState.connections.clear();raceState.remote.clear();raceState.finishers.clear();
  raceState.role='solo';raceState.hostId='';raceState.roomCode='';raceState.joined=false;raceState.started=false;raceState.pendingStart=null;raceState.round=0;raceState.roster=[];raceState.ready=new Set();raceState._latest=new Map();countdownEnd=0;clearKeys();
  for(const o of opponents.values()){if(o.mesh){scene?.remove(o.mesh);disposeObject(o.mesh);}}
  opponents.clear();
  updateNetworkStatus('SINGLE PLAYER');
}
function allParticipants(){
  const players=[{id:raceState.peer?.id||'local',name:raceState.name,host:raceState.role==='host',lap:player.lap,finished:player.finished,time:localFinishTime}];
  for(const [id,p] of raceState.remote){players.push({id,name:p.name||'Driver',host:false,lap:p.lap||0,finished:!!p.finished,time:p.time||null});}
  return players;
}
function roomRoster(){
  $('lobbyRacers').replaceChildren();
  const racers=allParticipants();
  racers.forEach((p,i)=>{
    const e=document.createElement('div');e.className='lobby-racer';e.textContent=`${i+1<10?'0':''}${i+1}  ${p.name}${p.host?' (HOST)':''}`;$('lobbyRacers').append(e);
  });
  if(raceState.role==='host')$('launchRace').disabled=!raceState.joined||raceState.started;
  else $('launchRace').disabled=true;
  $('launchRace').hidden=raceState.role!=='host';
}
function sendRoster(){
  if(raceState.role!=='host')return;
  const racers=allParticipants();
  broadcast({type:'roster',players:racers,laps:raceSettings.laps});roomRoster();
}
function ensureOpponent(id,name,colourIndex){
  if(!id||id===raceState.peer?.id)return;
  let opponent=opponents.get(id);
  if(!opponent){
    const c=CAR_COLOURS[(colourIndex+1)%CAR_COLOURS.length];const p=trackCurve.getPointAt(INITIAL_POS);
    opponent={id,name:cleanName(name),x:p.x,z:p.z,heading:getHeading(trackCurve.getTangentAt(INITIAL_POS)),speed:0,lap:0,finished:false,
      colour:c,hex:'#'+new THREE.Color(c).getHexString(),mesh:null};
    opponents.set(id,opponent);
  }
  opponent.name=cleanName(name);
  if(sceneReady&&raceMode==='arcade'&&!opponent.mesh){opponent.mesh=makeCar(opponent.colour,opponent.name);scene.add(opponent.mesh);setCarPose(opponent.mesh,opponent.x,opponent.z,opponent.heading);}
  return opponent;
}
function applyRoster(players){
  const accepted=new Set();
  for(let i=0;i<players.length;i++){
    const p=players[i];if(!p||!p.id)continue;
    if(p.id===raceState.peer?.id){raceState.name=cleanName(p.name);continue;}
    accepted.add(p.id);
    raceState.remote.set(p.id,{...raceState.remote.get(p.id),name:cleanName(p.name),lap:p.lap||0,finished:!!p.finished,time:p.time||null});
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
    finished:player.finished,time:localFinishTime};
}
function consumeSnapshot(p){
  if(!p||typeof p.id!=='string'||p.id===raceState.peer?.id)return;
  if(!Number.isFinite(p.x)||!Number.isFinite(p.z)||!Number.isFinite(p.heading))return;
  if(Math.abs(p.x)>1800||Math.abs(p.z)>1450)return;
  if(!raceState.remote.has(p.id))raceState.remote.set(p.id,{name:cleanName(p.name),lap:0});
  const s=raceState.remote.get(p.id);s.lap=Math.max(0,Math.min(200,Number(p.lap)||0));s.finished=!!p.finished;s.time=p.time||null;
  const op=ensureOpponent(p.id,s.name,[...raceState.remote.keys()].indexOf(p.id));
  if(op){op.x=p.x;op.z=p.z;op.heading=p.heading;op.lap=s.lap;op.finished=s.finished;}
  if(s.finished&&s.time)raceState.finishers.set(p.id,{name:s.name,time:s.time});
  if(!$('finishOverlay').hidden)renderResults();
}
function networkTick(){
  if(!raceStarted||raceState.role==='solo'||!raceState.joined)return;
  if(raceState.role==='guest')send(raceState.hostConn,{type:'state',round:raceState.round,driver:sharedSnapshot()});
  else if(raceState.role==='host'){
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
    if(msg.type==='ready'&&msg.round===raceState.round){raceState.ready.add(conn.peer);return;}
    if(msg.type==='hello'){
      if(raceStarted||raceState.started){send(conn,{type:'reject',reason:'This race has already started.'});return;}
      const racerName=cleanName(msg.name);
      raceState.remote.set(conn.peer,{name:racerName,lap:0,finished:false,time:null});
      send(conn,{type:'welcome',id:conn.peer,room:raceState.roomCode,laps:raceSettings.laps,players:allParticipants()});
      sendRoster();$('roomStatus').textContent=`ROOM OPEN · ${allParticipants().length} DRIVER(S) ON GRID`;
    }
    if(msg.type==='state'&&raceStarted&&msg.round===raceState.round&&msg.driver&&msg.driver.id===conn.peer){
      consumeSnapshot(msg.driver);
      if(!raceState._latest)raceState._latest=new Map();
      raceState._latest.set(conn.peer,msg.driver);
    }
    if(msg.type==='finished'&&msg.round===raceState.round&&msg.driver?.id===conn.peer){
      raceState.finishers.set(conn.peer,{name:raceState.remote.get(conn.peer)?.name||'Driver',time:msg.driver.time});
      broadcast({type:'results',round:raceState.round,finishers:Array.from(raceState.finishers.entries())});renderResults();
    }
  });
  conn.on('error',err=>console.warn('Guest connection error:',err));
  conn.on('close',()=>{
    raceState.connections.delete(conn.peer);raceState.remote.delete(conn.peer);raceState._latest?.delete(conn.peer);
    const op=opponents.get(conn.peer);if(op?.mesh){scene?.remove(op.mesh);disposeObject(op.mesh);}opponents.delete(conn.peer);
    if(!raceStarted)sendRoster();
    $('roomStatus').textContent=`ROOM OPEN · ${allParticipants().length} DRIVER(S) ON GRID`;
  });
}
function hostRoom(){
  if(typeof window.Peer!=='function'){setLobbyError('Online networking did not load. Check your connection or use solo arcade.');return;}
  resetNetwork();setLobbyError('');raceState.role='host';raceState.name=cleanName($('playerName').value);
  raceSettings.laps=clamp(parseInt($('lapSelect').value,10)||3,2,12);
  const code=makeRoomCode();raceState.roomCode=code;raceState.hostId=roomId(code);
  $('waitingRoom').hidden=false;$('roomCode').textContent=code;
  $('roomStatus').textContent='CONTACTING PEERJS CLOUD SIGNALING…';
  const peer=new window.Peer(raceState.hostId,{debug:0});raceState.peer=peer;
  const timeout=setTimeout(()=>{if(!raceState.joined)setLobbyError('Signalling took too long. Retry creating a room, or use solo arcade.');},12000);
  peer.on('open',()=>{
    clearTimeout(timeout);raceState.joined=true;$('roomStatus').textContent='ROOM OPEN · SHARE THE LINK TO INVITE FRIENDS';
    updateNetworkStatus('HOST / '+code);roomRoster();
  });
  peer.on('connection',attachHostConnection);
  peer.on('error',err=>{clearTimeout(timeout);setLobbyError(`Could not host (${err.type||'network error'}). Try again or play solo.`);$('roomStatus').textContent='SIGNALLING ERROR';});
  peer.on('disconnected',()=>{updateNetworkStatus('SIGNALLING DISCONNECTED');});
}
function joinRoom(){
  const code=parseRoomCode($('roomInput').value);if(code.length<4){setLobbyError('Enter a valid room code or invite URL.');return;}
  if(typeof window.Peer!=='function'){setLobbyError('Online networking did not load. Check your connection or choose solo mode.');return;}
  resetNetwork();setLobbyError('');raceState.role='guest';raceState.roomCode=code;raceState.hostId=roomId(code);
  raceState.name=cleanName($('playerName').value);
  $('waitingRoom').hidden=false;$('roomCode').textContent=code;$('roomStatus').textContent='FINDING THE HOST…';
  const peer=new window.Peer({debug:0});raceState.peer=peer;
  const timeout=setTimeout(()=>{if(!raceState.joined)setLobbyError('Could not find the host. Check the code and ensure the host has the room open.');},12000);
  peer.on('open',()=>{
    const conn=peer.connect(raceState.hostId,{reliable:true,serialization:'json'});
    raceState.hostConn=conn;
    conn.on('open',()=>{send(conn,{type:'hello',name:raceState.name});$('roomStatus').textContent='CONNECTED · WAITING FOR THE HOST…';});
    conn.on('data',msg=>handleGuestMessage(msg));
    conn.on('error',err=>{setLobbyError('Unable to connect to this room: '+(err.message||'network problem'));});
    conn.on('close',()=>{
      raceState.joined=false;updateNetworkStatus('HOST DISCONNECTED');
      if(raceStarted)announce('HOST DISCONNECTED\nYOU CAN CONTINUE SOLO',3);
      else setLobbyError('Connection to host was lost.');
    });
  });
  peer.on('error',err=>{clearTimeout(timeout);setLobbyError(`Could not join (${err.type||'network error'}). Check the code and retry.`);});
  raceState._joinTimeout=timeout;
}
function handleGuestMessage(msg){
  if(!msg||typeof msg!=='object')return;
  if(msg.type==='reject'){setLobbyError(msg.reason||'Unable to join this room.');$('roomStatus').textContent='JOIN REQUEST REJECTED';}
  if(msg.type==='welcome'){
    clearTimeout(raceState._joinTimeout);raceState.joined=true;raceSettings.laps=clamp(Number(msg.laps)||3,2,12);
    $('roomStatus').textContent=`CONNECTED · ${raceSettings.laps} LAP RACE · WAITING FOR HOST`;
    updateNetworkStatus('JOINED / '+raceState.roomCode);applyRoster(msg.players||[]);
  }
  if(msg.type==='roster'&&!raceState.started){
    raceSettings.laps=clamp(Number(msg.laps)||3,2,12);applyRoster(msg.players||[]);
    $('roomStatus').textContent=`CONNECTED · ${raceSettings.laps} LAP RACE · WAITING FOR HOST`;
  }
  if(msg.type==='start'){
    if(!Number.isInteger(msg.round)||msg.round<=raceState.round)return;
    raceSettings.laps=clamp(Number(msg.laps)||3,2,12);
    applyRoster(msg.players||[]);
    beginArcadeRace({launchAt:Number(msg.launchAt)||Date.now()+6000,round:msg.round,roster:msg.players||[]});
    send(raceState.hostConn,{type:'ready',round:raceState.round});
  }
  if(msg.type==='snapshot'&&msg.round===raceState.round&&Array.isArray(msg.players))for(const state of msg.players)consumeSnapshot(state);
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
  const racers=allParticipants().map(({id,name,host})=>({id,name,host}));
  const nextRound=raceState.round+1;
  const launchAt=Date.now()+7500;
  const packet={type:'start',round:nextRound,launchAt,laps:raceSettings.laps,players:racers};
  broadcast(packet);
  beginArcadeRace({launchAt,round:nextRound,roster:racers});
}
function gridPosition(index){
  const slot=INITIAL_POS+index*.0045;
  const base=trackCurve.getPointAt(slot),t=trackCurve.getTangentAt(slot);
  const n=new THREE.Vector3(t.z,0,-t.x);
  const stagger=base.clone().addScaledVector(n,index%2?6:-6);
  return {x:stagger.x,z:stagger.z,heading:getHeading(t),u:slot};
}
function resetRoundToLobby(){
  raceStarted=false;raceState.started=false;raceEnded=false;countdownEnd=0;raceState.ready.clear();
  raceState.finishers.clear();raceState._latest=new Map();
  for(const remote of raceState.remote.values()){remote.lap=0;remote.finished=false;remote.time=null;}
  for(const op of opponents.values()){op.lap=0;op.finished=false;op.speed=0;}
  clearKeys();resetPlayer(INITIAL_POS,true);
  $('finishOverlay').hidden=true;$('lobbyOverlay').hidden=false;$('waitingRoom').hidden=false;
  $('roomStatus').textContent='GRID RESET · WAITING FOR START';
  roomRoster();
}
function beginArcadeRace(options={}){
  if(typeof options==='number')options={launchAt:Date.now()+options};
  const launchAt=options.launchAt||Date.now()+4500;
  const roster=options.roster?.length?options.roster:allParticipants();
  $('lobbyOverlay').hidden=true;
  setMode('arcade'); // a clean, full-fuel local car on every client, including the host
  clearKeys();
  raceState.round=options.round||raceState.round+1;
  raceState.roster=roster.map(p=>({id:p.id,name:p.name}));
  raceState.ready=new Set();raceState.finishers.clear();raceState._latest=new Map();
  for(const state of raceState.remote.values()){state.lap=0;state.finished=false;state.time=null;}
  const myId=raceState.peer?.id||'local';
  roster.forEach((p,i)=>{
    const start=gridPosition(i);
    if(p.id===myId){
      player.x=start.x;player.z=start.z;player.heading=start.heading;player.u=start.u;player.priorU=start.u;
      setCarPose(player.mesh,player.x,player.z,player.heading);
    }else{
      const op=ensureOpponent(p.id,p.name,i);
      if(op){op.x=start.x;op.z=start.z;op.heading=start.heading;op.speed=0;op.lap=0;op.finished=false;
        if(op.mesh)setCarPose(op.mesh,op.x,op.z,op.heading);}
    }
  });
  player.elapsed=0;player.lapAt=0;player.lap=0;player.travel=0;player.fuel=1;player.speed=0;player.steer=0;
  player.finished=false;player._emptyWarn=false;player._fuelWarn=false;localFinishTime=null;
  raceStarted=false;raceState.started=true;raceEnded=false;
  countdownEnd=performance.now()+Math.max(2100,launchAt-Date.now());
  $('finishOverlay').hidden=true;$('welcomeOverlay').hidden=true;
  // Giving the canvas its own keyboard focus prevents buttons/input fields from
  // consuming WASD on a guest's browser immediately after the start overlay closes.
  if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
  $('raceMain').focus({preventScroll:true});
  announce('GET READY · GRID RESET',2);
  updateNetworkStatus(raceState.role==='solo'?'SOLO TIME ATTACK':raceState.role==='host'?'HOST / '+raceState.roomCode:'ROOM / '+raceState.roomCode);
  updateDashboard();
}
function finishLocalRace(){
  if(player.finished)return;
  player.finished=true;localFinishTime=player.elapsed;player.speed=0;
  raceState.finishers.set(raceState.peer?.id||'local',{name:raceState.name,time:localFinishTime});
  announce('CHECKERED FLAG!\nRACE COMPLETE',3);
  if(raceState.role==='host')broadcast({type:'results',round:raceState.round,finishers:Array.from(raceState.finishers.entries())});
  if(raceState.role==='guest')send(raceState.hostConn,{type:'finished',round:raceState.round,driver:{id:raceState.peer.id,time:localFinishTime}});
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
  if(!results.length)$('finishResults').textContent='Race underway. Waiting for the results…';
  $('raceAgain').textContent=raceState.role==='solo'?'RACE AGAIN →':raceState.role==='host'?'RESET THE GRID →':'RETURN TO LOBBY →';
}
async function copyInvite(){
  const u=new URL(window.location.href);u.searchParams.set('mode','arcade');u.searchParams.set('room',raceState.roomCode);u.hash='';
  const text=u.toString();
  try{await navigator.clipboard.writeText(text);$('copyInvite').textContent='LINK COPIED ✓';setTimeout(()=>$('copyInvite').textContent='COPY INVITE LINK ↗',1600);}
  catch{$('roomInput').value=text;$('roomInput').focus();$('roomInput').select();setLobbyError('Copy the selected link manually.');}
}
function setupEvents(){
  $('tourStart').addEventListener('click',()=>{resetNetwork();setMode('tour');announce('WELCOME TO THE RÉSUMÉ RUN',2.5);});
  $('arcadeStart').addEventListener('click',()=>{setMode('arcade');raceStarted=false;countdownEnd=0;$('welcomeOverlay').hidden=true;$('lobbyOverlay').hidden=false;$('waitingRoom').hidden=true;setLobbyError('');clearKeys();});
  $('lobbyBack').addEventListener('click',()=>{resetNetwork();$('lobbyOverlay').hidden=true;$('welcomeOverlay').hidden=false;clearKeys();});
  $('hostButton').addEventListener('click',hostRoom);$('joinButton').addEventListener('click',joinRoom);
  $('copyInvite').addEventListener('click',copyInvite);$('launchRace').addEventListener('click',launchHostedRace);
  $('soloButton').addEventListener('click',()=>{const laps=clamp(parseInt($('lapSelect').value,10)||3,2,12);resetNetwork();raceSettings.laps=laps;raceState.name=cleanName($('playerName').value);beginArcadeRace({launchAt:Date.now()+3800,roster:[{id:'local',name:raceState.name}]});});
  $('showGuide').addEventListener('click',()=>showGuide(true));$('guideClose').addEventListener('click',()=>showGuide(false));
  $('inspectButton').addEventListener('click',toggleInspect);
  $('towButton').addEventListener('click',pitTow);
  $('cameraButton').addEventListener('click',toggleCamera);
  $('renderModeButton').addEventListener('click',()=>{
    if(compatibilityActive){setCompatibility(false);rendererCheckCount=0;rendererBlankCount=0;lastModeChange=performance.now()-1300;}
    else setCompatibility(true,'Manually selected');
  });
  viewport.addEventListener('webglcontextlost',e=>{e.preventDefault();setCompatibility(true,'WebGL context lost');});
  viewport.addEventListener('webglcontextrestored',()=>{rendererCheckCount=0;rendererBlankCount=0;});
  $('resetButton').addEventListener('click',()=>{if(!gameRunning)return;const fuel=player.fuel;resetPlayer(INITIAL_POS,raceMode==='tour');if(raceMode==='arcade'){player.fuel=fuel;player.lap=0;player.travel=0;}announce('BACK ON THE GRID',1.4);});
  $('menuButton').addEventListener('click',()=>{
    clearKeys();gameRunning=false;raceStarted=false;resetNetwork();$('welcomeOverlay').hidden=false;$('lobbyOverlay').hidden=true;$('finishOverlay').hidden=true;$('raceGuide').hidden=true;
    raceMode='tour';document.body.classList.remove('in-arcade');setupPits(resume.length);newScene();resetPlayer();
  });
  $('raceAgain').addEventListener('click',()=>{
    if(raceState.role==='solo'){beginArcadeRace({launchAt:Date.now()+3700,roster:[{id:'local',name:raceState.name}]});return;}
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
  const controls={w:'up',ArrowUp:'up',s:'down',ArrowDown:'down',a:'left',ArrowLeft:'left',d:'right',ArrowRight:'right',' ':'brake',Shift:'boost'};
  document.addEventListener('keydown',e=>{
    const key=controls[e.key]||controls[e.key.toLowerCase?.()];
    if(key&&keysAllowed()){keys[key]=true;e.preventDefault();}
    if((e.key==='e'||e.key==='E')&&keysAllowed()&&!e.repeat){toggleInspect();e.preventDefault();}
    else if((e.key==='e'||e.key==='E')&&inspector&&!e.repeat){toggleInspect();e.preventDefault();}
    if((e.key==='c'||e.key==='C')&&keysAllowed()&&!e.repeat){toggleCamera();e.preventDefault();}
    if((e.key==='p'||e.key==='P')&&gameRunning&&raceMode==='tour'&&!e.repeat){showGuide($('raceGuide').hidden);e.preventDefault();}
    if((e.key==='t'||e.key==='T')&&keysAllowed()&&!e.repeat){pitTow();e.preventDefault();}
    if(e.key==='Escape'){
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
  }catch(error){console.error(error);reportError(error.message||'WebGL initialisation failed. Try a modern browser.');}
}
window.RC_GAME_STATUS=()=>({mode:raceMode,gameRunning,raceStarted,
  round:raceState.round,networkRole:raceState.role,remotePlayers:raceState.remote.size,
  countdownMs:Math.max(0,Math.round(countdownEnd-performance.now())),
  position:{x:player.x,z:player.z},speed:player.speed,steer:player.steer,
  fuel:player.fuel,lap:player.lap,keys:{...keys},compatible:compatibilityActive});
initialise();
