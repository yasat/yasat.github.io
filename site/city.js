/* Research City 3D: a dependency-free software-rendered perspective city.
   Three-dimensional geometry is projected onto Canvas using a follow camera.
   GitHub Pages needs no WebGL package, build system, server, or external assets. */
(() => {
  'use strict';
  const zones = window.RESUME_ZONES;
  if (!zones || zones.length !== 8) return;
  const $ = id => document.getElementById(id);
  const canvas = $('cityCanvas');
  const ctx = canvas.getContext('2d', {alpha:false});
  const map = $('cityMap');
  const mapCtx = map.getContext('2d');
  const xy = [
    [-400,400], [0,400], [400,400], [-400,0],
    [400,0], [-400,-400], [0,-400], [400,-400]
  ];
  const short = ['Research','Papers','Teaching','Engineering','AI Innovation','Education','Community','Contact'];
  const cityZones = zones.map((z,i) => ({...z,cx:xy[i][0],cz:xy[i][1],short:short[i],index:i}));
  const roadCoords = [-600,-200,200,600];
  const items = cityZones.flatMap(zone => zone.items.map((item,j) => {
    const positions = [
      {x:zone.cx,z:zone.cz-151,side:'south'},
      {x:zone.cx+151,z:zone.cz,side:'east'},
      {x:zone.cx,z:zone.cz+151,side:'north'},
      {x:zone.cx-151,z:zone.cz,side:'west'}
    ];
    return { ...item, ...positions[j],zone,index:zone.index*4+j,num:zone.index*4+j+1 };
  }));
  const state = {
    car:{x:-200,z:-720,yaw:0,speed:0},
    target:0, active:false, paused:true, detail:null,
    discovered:new Set(), key:{}, nearest:null, nearbyIntersection:null,
    last:0, parking:0, ridden:false, lastOpened:-1, drag:false
  };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W=1200,H=750,dpr=1,scale=1,cam=null,faces=[],detailsFocus=null;

  const colorHex = (hex,amount=1) => {
    const v = parseInt(hex.replace('#',''),16);
    return '#'+[16,8,0].map(shift=> Math.max(0,Math.min(255,Math.round(((v>>shift)&255)*amount))).toString(16).padStart(2,'0')).join('');
  };
  const hash = n => Math.sin(n*91.123+2.42)*43758.5453%1;
  const rand = n => Math.abs(hash(n));
  const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
  const distance = (a,b,c,d) => Math.hypot(a-c,b-d);
  const ground = [], solids = [], signposts = [];
  function quad(collection, v, color, stroke=null) {collection.push({verts:v,color,stroke});}
  function plane(collection,x,z,w,d,y,color) {
    quad(collection, [[x-w/2,y,z-d/2],[x+w/2,y,z-d/2],[x+w/2,y,z+d/2],[x-w/2,y,z+d/2]],color);
  }
  function addBox(collection,x,y,z,w,h,d,color,yaw=0) {
    const co=Math.cos(yaw),si=Math.sin(yaw);
    const point=(a,b,c)=>[x+a*co+c*si,y+b,z-a*si+c*co];
    const A=point(-w/2,0,-d/2),B=point(w/2,0,-d/2),C=point(w/2,0,d/2),D=point(-w/2,0,d/2);
    const E=point(-w/2,h,-d/2),F=point(w/2,h,-d/2),G=point(w/2,h,d/2),I=point(-w/2,h,d/2);
    quad(collection,[E,F,G,I],colorHex(color,1.13));
    quad(collection,[A,B,F,E],colorHex(color,.92));
    quad(collection,[B,C,G,F],colorHex(color,.77));
    quad(collection,[C,D,I,G],color);
    quad(collection,[D,A,E,I],colorHex(color,.82));
  }
  function tree(x,z,n) {
    addBox(solids,x,1,z,5,19,5,'#7e8a68');
    addBox(solids,x,17,z,27,24,28, n%3?'#76b98a':'#5bab8d');
    addBox(solids,x,35,z,19,12,19,'#99d0a2');
  }
  function building(x,z,w,d,h,color,index) {
    addBox(solids,x,.8,z,w,h,d,color);
    addBox(solids,x,h+.8,z,w+4,3,d+4,colorHex(color,.78));
    // Repeated glass bands convey scale without external texture assets.
    for(let y=15;y<h-7;y+=18) {
      for(let v=-w/2+11;v<w/2-4;v+=16) {
        addBox(solids,x+v,y,z+d/2+1,9,8,.6,index%2?'#c1edf1':'#7ab8bb');
        addBox(solids,x+v,y,z-d/2-1,9,8,.6,'#a3dadd');
      }
      for(let v=-d/2+11;v<d/2-4;v+=16) {
        addBox(solids,x+w/2+1,y,z+v,.6,8,9,'#91c8c9');
        addBox(solids,x-w/2-1,y,z+v,.6,8,9,'#ccefe9');
      }
    }
  }
  function makeWorld() {
    // Road grid, markings and off-road blocks are actual ground-plane polygons.
    for(const g of roadCoords) {
      for(let p=-840;p<840;p+=80) {
        plane(ground,g,p+40,94,80,.09,'#687f89');
        plane(ground,p+40,g,80,94,.12,'#687f89');
        plane(ground,g-49,p+40,6,80,.4,'#f1e0c8');
        plane(ground,g+49,p+40,6,80,.4,'#f1e0c8');
        plane(ground,p+40,g-49,80,6,.4,'#f1e0c8');
        plane(ground,p+40,g+49,80,6,.4,'#f1e0c8');
      }
      for(let p=-824;p<=820;p+=50) {
        const inCrossing = roadCoords.some(t=>Math.abs(p-t)<70);
        if (!inCrossing) {
          plane(ground,g,p,2,26,.28,'#fff3ba');
          plane(ground,p,g,26,2,.29,'#fff3ba');
        }
      }
    }
    // Pedestrian crossings at every intersection.
    for(const x of roadCoords) for(const z of roadCoords) {
      for(let q=-30;q<34;q+=10) {
        plane(ground,x+q,z+62,5,17,.32,'#f9f4dc');
        plane(ground,x+q,z-62,5,17,.32,'#f9f4dc');
        plane(ground,x+62,z+q,17,5,.32,'#f9f4dc');
        plane(ground,x-62,z+q,17,5,.32,'#f9f4dc');
      }
      const nearby = cityZones.filter(a=>Math.abs(a.cx-x)<260&&Math.abs(a.cz-z)<260);
      signposts.push({x:x+50,z:z+50,nearby});
      addBox(solids,x+50,1,z+50,5,30,5,'#49766f');
      addBox(solids,x+50,31,z+50,68,29,8,'#1d5e52');
      addBox(solids,x+50,61,z+50,75,3,10,'#ffc386');
    }
    for (let index=0; index<9; index++) {
      const x=(index%3-1)*400, z=(1-Math.floor(index/3))*400;
      const zone=cityZones.find(q=>q.cx===x&&q.cz===z);
      const shade=zone?zone.tone:'#a9dcc1';
      plane(ground,x,z,300,300,.26,'#e8ece2');
      plane(ground,x,z,275,275,.37,colorHex(shade,1.02));
      plane(ground,x,z,244,244,.42,'#e2efe0');
      // Parked city centre and surrounding zones have distinct silhouettes.
      if(zone) {
        const colors=['#90b9ad','#e5bb99','#b3a8ce','#a5bfd1','#d89d9d','#b6c998','#dcc28a','#9bc9c1'];
        const base=colors[zone.index];
        const b=[
          [-55,-45,60,51,76], [61,47,51,59,63],
          [-71,69,46,48,42], [76,-63,40,48,54],
          [0,1,53,53,113]
        ];
        b.forEach(([bx,bz,bw,bd,bh],n)=>building(x+bx,z+bz,bw,bd,bh+(zone.index*11+n*7)%27,colorHex(base,.85+rand(zone.index*10+n)*.20),n));
        for(const [tx,tz] of [[-125,-119],[123,-118],[-120,120],[122,120]]) tree(x+tx,z+tz,zone.index);
      } else {
        plane(ground,x,z,145,145,.47,'#b5dfc9');
        addBox(solids,x,.6,z,75,22,75,'#74bda6');
        addBox(solids,x,23,z,60,15,60,'#c4e2d2');
        addBox(solids,x,39,z,43,30,43,'#3e9685');
        addBox(solids,x,69,z,11,40,11,'#f3d09d');
        for(let t=0;t<6;t++) {const a=t*Math.PI/3;tree(x+Math.cos(a)*116,z+Math.sin(a)*116,t);}
      }
    }
    // Low perimeter city skyline for depth.
    for(let i=0;i<40;i++) {
      const theta=i*Math.PI/20;
      const x=Math.cos(theta)*1000,z=Math.sin(theta)*1000;
      const h=40+rand(i+19)*105;
      addBox(solids,x,0,z,60+rand(i)*30,h,60+rand(i*2)*30,i%3?'#a7c6b6':'#d5c7ac');
    }
    // Support posts of the 32 full-information billboards.
    items.forEach((b,i)=> {
      addBox(solids,b.x-19,1,b.z,4,33,4,'#4b6c61');
      addBox(solids,b.x+19,1,b.z,4,33,4,'#4b6c61');
      plane(ground,b.x,b.z,87,33,.6,'#ecdfc6');
    });
  }
  makeWorld();

  function resize() {
    const r=canvas.getBoundingClientRect();
    W=Math.max(1,r.width);H=Math.max(1,r.height);
    dpr=Math.min(window.devicePixelRatio||1,1.6);
    canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    scale=Math.min(W*.92,H*1.26);
  }
  window.addEventListener('resize',resize);
  resize();

  function camera() {
    const c=state.car, fx=Math.sin(c.yaw),fz=Math.cos(c.yaw);
    // Raised third-person camera maintains enough view for a useful city map.
    const px=c.x-fx*135,py=93,pz=c.z-fz*135;
    let dx=fx*225,dy=-83,dz=fz*225;
    const len=Math.hypot(dx,dy,dz);dx/=len;dy/=len;dz/=len;
    const horizontal=Math.hypot(dx,dz);
    const rx=dz/horizontal,rz=-dx/horizontal,ux=dy*rz,uy=horizontal,uz=-dy*rx;
    return {x:px,y:py,z:pz,fx:dx,fy:dy,fz:dz,rx,rz,ux,uy,uz};
  }
  function view(pt) {
    const x=pt[0]-cam.x,y=pt[1]-cam.y,z=pt[2]-cam.z;
    return [x*cam.rx+z*cam.rz, x*cam.ux+y*cam.uy+z*cam.uz,x*cam.fx+y*cam.fy+z*cam.fz];
  }
  function pointScreen(pt) {
    const v=view(pt);
    if(v[2]<5||v[2]>1300) return null;
    return {x:W/2+v[0]*scale/v[2],y:H/2-v[1]*scale/v[2],z:v[2]};
  }
  function clipped(poly) {
    let a=poly.map(view);const near=4;
    let b=[];
    for(let i=0;i<a.length;i++) {
      const u=a[i],v=a[(i+1)%a.length],iu=u[2]>near,iv=v[2]>near;
      if(iu) b.push(u);
      if(iu!==iv) {const t=(near-u[2])/(v[2]-u[2]);b.push([u[0]+(v[0]-u[0])*t,u[1]+(v[1]-u[1])*t,near]);}
    }
    if(b.length<3) return null;
    return b;
  }
  function renderFace(face) {
    const vs=face.verts,centroid=vs.reduce((r,p)=>[r[0]+p[0]/vs.length,r[1]+p[1]/vs.length,r[2]+p[2]/vs.length],[0,0,0]);
    if(Math.hypot(centroid[0]-cam.x,centroid[2]-cam.z)>960) return;
    const poly=clipped(vs);
    if(!poly) return;
    const mx=poly.reduce((s,p)=>s+p[2],0)/poly.length;
    if(mx>1110) return;
    const p2=poly.map(v=>[W/2+v[0]*scale/v[2],H/2-v[1]*scale/v[2]]);
    const left=Math.min(...p2.map(p=>p[0])),right=Math.max(...p2.map(p=>p[0]));
    const top=Math.min(...p2.map(p=>p[1])),bottom=Math.max(...p2.map(p=>p[1]));
    if(right<0||left>W||bottom<0||top>H) return;
    faces.push({depth:mx,points:p2,color:face.color});
  }
  function sprite(pt,depthDraw) {
    const p=pointScreen(pt);
    if(p&&p.x>-220&&p.x<W+220&&p.y>-190&&p.y<H+250) faces.push({depth:p.z,draw:()=>depthDraw(p)});
    return p;
  }
  function textLines(text,maxwidth,maxlines,font) {
    ctx.font=font;
    const words=text.split(/\s+/),lines=[];let cur='';
    for(const word of words) {
      const candidate=(cur?cur+' ':'')+word;
      if(ctx.measureText(candidate).width>maxwidth&&cur) {lines.push(cur);cur=word;} else cur=candidate;
      if(lines.length>=maxlines) break;
    }
    if(lines.length<maxlines&&cur)lines.push(cur);
    if(lines.length===maxlines&&words.join(' ').length>lines.join(' ').length) lines[maxlines-1]=lines[maxlines-1].replace(/[ .,;:]*$/,'')+'...';
    return lines;
  }
  function addBillboard(b) {
    if(distance(b.x,b.z,cam.x,cam.z)>820) return;
    const rx=cam.rx,rz=cam.rz;
    const panel=(halfWidth,y1,y2,color)=>quadDynamic([
      [b.x-rx*halfWidth,y1,b.z-rz*halfWidth],
      [b.x+rx*halfWidth,y1,b.z+rz*halfWidth],
      [b.x+rx*halfWidth,y2,b.z+rz*halfWidth],
      [b.x-rx*halfWidth,y2,b.z-rz*halfWidth]
    ],color);
    panel(44,25,81,'#31594e');
    panel(41,29,78,b.zone.tone);
    panel(41,69,78,'#214f48');
    const p=pointScreen([b.x,56,b.z]);
    const bl=pointScreen([b.x-rx*41,56,b.z-rz*41]);
    const br=pointScreen([b.x+rx*41,56,b.z+rz*41]);
    const top=pointScreen([b.x,78,b.z]);
    const bottom=pointScreen([b.x,29,b.z]);
    if(!p||!bl||!br||!top||!bottom)return;
    let w=Math.abs(br.x-bl.x),h=Math.abs(bottom.y-top.y);
    if(w<36||h<18)return;
    faces.push({depth:p.z-1,draw:()=>{
      const font=clamp(w/15,8,19);const x=p.x;
      if(p.x<-w/2||p.x>W+w/2) return;
      ctx.save();
      // Text is drawn in front of a 3D-facing sign, retaining legibility while driving.
      ctx.textAlign='center';ctx.fillStyle='#ffffff';ctx.font=`900 ${clamp(font*.67,8,11)}px Arial, sans-serif`;
      if(h>55) ctx.fillText(`${String(b.num).padStart(2,'0')} / ${b.zone.short.toUpperCase()}`,x,top.y+clamp(h*.15,12,26));
      ctx.fillStyle='#173f39';
      if(h>40) {
        const f=`900 ${font}px Arial, sans-serif`;
        const lines=textLines(b.title,Math.max(30,w*.78),3,f);
        ctx.font=f;const lh=font*1.15;
        const yy=p.y+(h>80?0:font*.16)-(lines.length-1)*lh/2;
        lines.forEach((line,i)=>ctx.fillText(line,x,yy+i*lh));
      }else{ctx.font='900 9px Arial, sans-serif';ctx.fillText(b.title.slice(0,20),x,p.y+4);}
      ctx.restore();
    }});
  }
  function quadDynamic(v,color) {renderFace({verts:v,color});}
  function addLabels() {
    // Crossing signs. Each one lists the actual neighbourhoods adjoining that junction.
    signposts.forEach(s=>{
      if(distance(s.x,s.z,cam.x,cam.z)>560)return;
      const p=pointScreen([s.x,48,s.z]);
      if(!p)return;
      faces.push({depth:p.z-23,draw:()=>{
        const px=pointScreen([s.x-28,48,s.z]);const qx=pointScreen([s.x+28,48,s.z]);
        const sz=px&&qx?Math.abs(qx.x-px.x):95;
        if(sz<30||p.x<0||p.x>W)return;
        ctx.save();ctx.fillStyle='#fffde9';ctx.textAlign='center';
        const font=clamp(sz/9,7,11);ctx.font=`900 ${font}px Arial, sans-serif`;
        ctx.fillText('WAYPOINT',p.x,p.y-3);
        let label=s.nearby.slice(0,2).map(n=>{
          const dx=n.cx-(s.x-50), dz=n.cz-(s.z-50);
          const road=Math.abs(dx)>=Math.abs(dz)?(dx<0?'WEST':'EAST'):(dz<0?'SOUTH':'NORTH');
          return `${road} ${n.short.toUpperCase()}`;
        }).join(' / ')||'CITY CENTRE';
        ctx.font=`800 ${clamp(font*.8,6,9)}px Arial, sans-serif`;
        if(label.length>33)label=label.slice(0,31)+'..';
        ctx.fillText(label,p.x,p.y+font*1.2);ctx.restore();
      }});
    });
    cityZones.forEach(z=>{
      if(distance(z.cx,z.cz,cam.x,cam.z)>770)return;
      const p=pointScreen([z.cx,170,z.cz]);
      if(p && p.z>80 && p.z<700){faces.push({depth:p.z-1,draw:()=>{
        ctx.save();ctx.textAlign='center';ctx.font='900 12px Arial, sans-serif';
        const txt=z.short.toUpperCase();const tw=ctx.measureText(txt).width+25;
        ctx.fillStyle='#fffcf0e9';ctx.strokeStyle='#a6c6ab';ctx.lineWidth=1;
        ctx.beginPath();ctx.roundRect(p.x-tw/2,p.y-17,tw,25,6);ctx.fill();ctx.stroke();
        ctx.fillStyle='#255a4c';ctx.fillText(txt,p.x,p.y);ctx.restore();
      }});}
    });
  }
  function addCar() {
    const c=state.car;
    const f=[];
    const bx=c.x,bz=c.z;
    addBox(f,bx,2,bz,23,11,45,'#f59365',c.yaw);
    addBox(f,bx,13,bz-2*Math.cos(c.yaw),19,9,24,'#f8d5ae',c.yaw);
    const shift=(side,front)=>({x:bx+side*Math.cos(c.yaw)+front*Math.sin(c.yaw),z:bz-side*Math.sin(c.yaw)+front*Math.cos(c.yaw)});
    for(const side of [-14,14]) for(const front of [-15,15]) {
      const t=shift(side,front);addBox(f,t.x,3,t.z,5,8,12,'#293f42',c.yaw);
    }
    for(const side of [-7,7]) {
      let t=shift(side,23);addBox(f,t.x,7,t.z,5,4,1,'#fff9d2',c.yaw);
      t=shift(side,-23);addBox(f,t.x,7,t.z,5,3,1,'#cf4f45',c.yaw);
    }
    f.forEach(renderFace);
  }
  function render() {
    cam=camera();faces=[];
    const sky=ctx.createLinearGradient(0,0,0,H*.76);
    sky.addColorStop(0,'#acdded');sky.addColorStop(.55,'#dff5f1');sky.addColorStop(1,'#eff4cb');
    ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    // Light and horizon frame.
    ctx.fillStyle='#fff4bfbb';ctx.beginPath();ctx.arc(W*.66,H*.14,Math.min(60,H*.07),0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#b8ddbb';ctx.fillRect(0,H*.42,W,H*.58);
    // Ground draws before buildings, which avoids near ground cards masking facades.
    const g=[];
    const original=faces;faces=g;
    ground.forEach(renderFace);
    g.sort((a,b)=>b.depth-a.depth);
    for(const f of g) drawFace(f);
    faces=original;
    solids.forEach(renderFace);
    items.forEach(addBillboard);
    addLabels();addCar();
    faces.sort((a,b)=>b.depth-a.depth);
    for(const f of faces)drawFace(f);
    // Subtle atmospheric distance fades the world into the soft afternoon sky.
    const v=ctx.createLinearGradient(0,0,0,H);
    v.addColorStop(0,'#f6f9e511');v.addColorStop(1,'#183d2d06');
    ctx.fillStyle=v;ctx.fillRect(0,0,W,H);
  }
  function drawFace(f) {
    if(f.draw){f.draw();return;}
    ctx.beginPath();
    f.points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));
    ctx.closePath();ctx.fillStyle=f.color;ctx.fill();
    if(f.depth>500){ctx.fillStyle=`rgba(211,235,225,${clamp((f.depth-500)/1200,0,.3)})`;ctx.fill();}
  }
  function districtAt(x,z) {
    const z0=cityZones.find(a=>Math.abs(x-a.cx)<180&&Math.abs(z-a.cz)<180);
    return z0||null;
  }
  function getClosestBillboard() {
    let best=null,dist=Infinity;
    for(const b of items){const d=distance(state.car.x,state.car.z,b.x,b.z);if(d<dist){dist=d;best=b;}}
    return {billboard:best,dist};
  }
  function nearestIntersection() {
    let best=null,dist=Infinity;
    for(const x of roadCoords)for(const z of roadCoords){const d=distance(state.car.x,state.car.z,x,z);if(d<dist){dist=d;best={x,z};}}
    return {junction:best,dist};
  }
  function direction(degrees) {
    const a=(degrees+Math.PI*2)%(Math.PI*2);
    return a<Math.PI/4||a>=Math.PI*7/4?'north':a<Math.PI*3/4?'east':a<Math.PI*5/4?'south':'west';
  }
  function routing() {
    const zone=cityZones[state.target];
    const {junction,dist}=nearestIntersection();
    const nearZones=cityZones.filter(a=>Math.abs(a.cx-junction.x)<260&&Math.abs(a.cz-junction.z)<260);
    let result=`Head toward ${zone.short}. Follow the signs at crossings.`;
    if(dist<125) {
      const dx=zone.cx-junction.x,dz=zone.cz-junction.z;
      let next;
      if(Math.abs(dx)>120 && Math.abs(dz)>120) next=Math.abs(dx)>Math.abs(dz)?(dx>0?'east':'west'):(dz>0?'north':'south');
      else if(Math.abs(dx)>120)next=dx>0?'east':'west';
      else if(Math.abs(dz)>120)next=dz>0?'north':'south';
      else next='nearby';
      const heading=direction(state.car.yaw);
      if(next==='nearby')result=`${zone.short} is just off this crossing. Park next to a billboard.`;
      else {
        const order=['north','east','south','west'];
        const diff=(order.indexOf(next)-order.indexOf(heading)+4)%4;
        const turn=['Go straight','Turn right','Turn around','Turn left'][diff];
        result=`At this crossing: ${turn.toLowerCase()} toward ${next}.`;
      }
      if(state.nearbyIntersection!==`${junction.x},${junction.z}`){state.nearbyIntersection=`${junction.x},${junction.z}`;}
    }
    $('cityWaypointName').textContent=zone.name;
    $('cityWaypointRoute').textContent=result;
    $('cityJunctionNearby').textContent=dist<145 ? (nearZones.length?`Roads nearby: ${nearZones.map(n=>n.short).join(', ')}.`:'City centre crossing.') : 'Follow signs at the next intersection.';
    const near=districtAt(state.car.x,state.car.z);
    $('cityLocation').textContent=(near?near.name:'City streets').toUpperCase();
  }
  function addDistrictNav() {
    const nav=$('cityDistricts');
    nav.replaceChildren();
    cityZones.forEach((z,i)=>{
      const b=document.createElement('button');b.type='button';b.className='city-district';
      b.setAttribute('aria-label',`Jump to ${z.name}`);
      const dot=document.createElement('span');dot.className='city-dot';dot.style.setProperty('--dot',z.tone);
      const label=document.createElement('span');label.textContent=z.short;
      b.append(dot,label);
      b.addEventListener('click',()=>{visitDistrict(i);if(window.innerWidth<=800)toggleMap(false);});
      nav.append(b);
    });
    updateDistrictNav();
  }
  function updateDistrictNav() {
    [...$('cityDistricts').children].forEach((b,i)=>{
      b.classList.toggle('active',state.target===i);b.setAttribute('aria-pressed',String(state.target===i));
    });
    const zone=cityZones[state.target];
    const holder=$('cityDistrictItems');holder.replaceChildren();
    zone.items.forEach((item,j)=>{
      const b=document.createElement('button');b.type='button';b.className='city-item';
      b.textContent=item.title;b.addEventListener('click',()=>openBillboard(items[state.target*4+j],true));
      holder.append(b);
    });
  }
  function visitDistrict(i) {
    state.target=i;
    const z=cityZones[i];
    state.car.x=z.cx-200;state.car.z=z.cz;state.car.yaw=0;state.car.speed=0;
    state.parking=0;state.lastOpened=-1;state.ridden=false;
    updateDistrictNav();updateNearby();routing();mapDraw();
  }
  function updateNearby() {
    const {billboard,dist}=getClosestBillboard();
    state.nearest=dist<107?billboard:null;
    const parked=Math.abs(state.car.speed)<6;
    const ready=!!state.nearest&&parked;
    $('cityReadButton').disabled=!ready;
    if(state.nearest) {
      $('cityNearbyLabel').textContent=`${state.nearest.zone.short.toUpperCase()} / BILLBOARD ${String(state.nearest.num).padStart(2,'0')}`;
      $('cityNearbyTitle').textContent=ready?state.nearest.title:`Slow down and stop to read: ${state.nearest.title}`;
      $('cityReadButton').textContent=ready?'Read billboard':'Park to read';
    }else{
      $('cityNearbyLabel').textContent='DISCOVER THE CITY';
      $('cityNearbyTitle').textContent='Pull up to a billboard, stop, and read its story.';
      $('cityReadButton').textContent='Read billboard';
    }
  }
  function openBillboard(b,fromMenu=false) {
    if(!b || (!fromMenu&&(distance(b.x,b.z,state.car.x,state.car.z)>112||Math.abs(state.car.speed)>7)))return;
    detailsFocus=document.activeElement;
    state.detail=b;state.paused=true;state.key={};state.car.speed=0;
    state.discovered.add(b.index);
    $('cityDetailNumber').textContent=`FIELD NOTE ${String(b.num).padStart(2,'0')} / ${items.length} | ${state.discovered.size} DISCOVERED`;
    $('cityDetailDistrict').textContent=b.zone.name.toUpperCase();
    $('cityDetailTitle').textContent=b.title;
    $('cityDetailMeta').textContent=b.meta;
    $('cityDetailDescription').textContent=b.description;
    const link=$('cityDetailLink');
    if(b.url && /^https?:\/\/|^mailto:/.test(b.url)){
      link.hidden=false;link.href=b.url;link.textContent=b.linkLabel||'Open source';
    }else{link.hidden=true;link.removeAttribute('href');}
    $('cityDetail').setAttribute('aria-hidden','false');
    $('cityDetailClose').focus();
  }
  function closeBillboard() {
    $('cityDetail').setAttribute('aria-hidden','true');state.detail=null;
    state.paused=!state.active;state.parking=0;state.lastOpened=-1;
    if(detailsFocus&&detailsFocus.focus) detailsFocus.focus({preventScroll:true});
    else canvas.focus({preventScroll:true});
  }
  function toggleMap(force) {
    const open=typeof force==='boolean'?force:!$('citySidebar').classList.contains('open');
    $('citySidebar').classList.toggle('open',open);
    $('cityMenuButton').setAttribute('aria-expanded',String(open));
  }
  function mapDraw() {
    const c=mapCtx, mw=map.width,mh=map.height;
    c.clearRect(0,0,mw,mh);c.fillStyle='#e3efe3';c.fillRect(0,0,mw,mh);
    const project=(x,z)=>[27+(x+800)/1600*246,15+(800-z)/1600*194];
    // Miniature road grid shows true relative neighbourhood locations.
    roadCoords.forEach(v=>{
      let a=project(v,-790),b=project(v,790);
      c.strokeStyle='#91a6a3';c.lineWidth=11;c.beginPath();c.moveTo(...a);c.lineTo(...b);c.stroke();
      a=project(-790,v);b=project(790,v);c.beginPath();c.moveTo(...a);c.lineTo(...b);c.stroke();
    });
    cityZones.forEach((z,i)=>{
      const [x,y]=project(z.cx,z.cz);
      c.fillStyle=z.tone;c.strokeStyle=i===state.target?'#1b5c49':'#b6c7bb';c.lineWidth=i===state.target?3:1;
      c.fillRect(x-23,y-17,46,34);c.strokeRect(x-23,y-17,46,34);
      c.fillStyle='#245043';c.font='900 8px Arial, sans-serif';c.textAlign='center';
      c.fillText(short[i].slice(0,10),x,y+3);
    });
    const [px,py]=project(state.car.x,state.car.z);c.save();c.translate(px,py);c.rotate(state.car.yaw);
    c.fillStyle='#f47f56';c.strokeStyle='#fffbe9';c.lineWidth=2;c.beginPath();c.moveTo(0,-10);c.lineTo(-7,8);c.lineTo(7,8);c.closePath();c.fill();c.stroke();c.restore();
  }
  function driving(dt) {
    const key=state.key,c=state.car;
    const throttle=key.up||key.ArrowUp||key.w||key.W;
    const reverse=key.down||key.ArrowDown||key.s||key.S;
    const left=key.left||key.ArrowLeft||key.a||key.A;
    const right=key.right||key.ArrowRight||key.d||key.D;
    const brake=key.brake||key[' ']||key.Space;
    if(throttle)c.speed=Math.min(155,c.speed+125*dt);
    if(reverse)c.speed=Math.max(-70,c.speed-165*dt);
    if(!throttle&&!reverse)c.speed*=Math.pow(.987,dt*60);
    if(brake)c.speed*=Math.pow(.77,dt*60);
    if(Math.abs(c.speed)<.23)c.speed=0;
    if((left||right)&&Math.abs(c.speed)>.75){
      let rotate=1.8*clamp(Math.abs(c.speed)/60,.25,1.0)*dt;
      c.yaw+=(right?rotate:-rotate)*(c.speed<0?-1:1);
    }
    if(Math.abs(c.speed)>1)state.ridden=true;
    const nx=clamp(c.x+Math.sin(c.yaw)*c.speed*dt,-811,811);
    const nz=clamp(c.z+Math.cos(c.yaw)*c.speed*dt,-811,811);
    // Buildings are solid. Sidewalks and streets remain driveable near signs.
    const solid = cityZones.some(z=>Math.abs(nx-z.cx)<112&&Math.abs(nz-z.cz)<112)
      || (Math.abs(nx)<99&&Math.abs(nz)<99);
    if(solid){c.speed*=-.28;}else{c.x=nx;c.z=nz;}
    $('citySpeed').textContent=String(Math.round(Math.abs(c.speed)*.72)).padStart(2,'0');
    if(!state.detail){
      const {billboard,dist}=getClosestBillboard();
      if(billboard&&dist<95&&Math.abs(c.speed)<3&&state.ridden&&state.lastOpened!==billboard.index){
        state.parking+=dt;
        if(state.parking>1.5){state.lastOpened=billboard.index;openBillboard(billboard);}
      }else if(dist>112||Math.abs(c.speed)>8){state.parking=0;}
      if(dist>145)state.lastOpened=-1;
    }
  }
  let uiTimer=0;
  function tick(now) {
    const dt=state.last?clamp((now-state.last)/1000,0,.042):.016;state.last=now;
    if(state.active&&!state.paused)driving(dt);
    render();
    uiTimer+=dt;
    if(uiTimer>.16){uiTimer=0;updateNearby();routing();mapDraw();}
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  function start() {
    state.active=true;state.paused=false;state.last=0;
    $('cityIntro').classList.add('hidden');
    canvas.focus({preventScroll:true});
  }
  addDistrictNav();updateNearby();routing();mapDraw();
  $('cityStart').addEventListener('click',start);
  $('cityReadButton').addEventListener('click',()=>openBillboard(state.nearest));
  $('cityDetailClose').addEventListener('click',closeBillboard);
  $('cityDetailContinue').addEventListener('click',closeBillboard);
  $('cityMenuButton').addEventListener('click',()=>toggleMap());
  $('citySidebarClose').addEventListener('click',()=>toggleMap(false));
  $('cityReset').addEventListener('click',()=>{state.car={x:-200,z:-720,yaw:0,speed:0};state.parking=0;state.ridden=false;});
  $('cityDetail').addEventListener('click',e=>{if(e.target===$('cityDetail'))closeBillboard();});
  const known=['w','W','s','S','a','A','d','D','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','e','E','Escape'];
  document.addEventListener('keydown',e=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
    if(known.includes(e.key)&&!(e.altKey||e.ctrlKey||e.metaKey)){
      if([' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault();
      if(e.key==='Escape'){if(state.detail)closeBillboard();else toggleMap(false);return;}
      if(state.detail)return;
      if(e.key==='e'||e.key==='E'){openBillboard(state.nearest);return;}
      state.key[e.key]=true;
    }
  });
  document.addEventListener('keyup',e=>{state.key[e.key]=false;});
  window.addEventListener('blur',()=>{state.key={};});
  document.querySelectorAll('[data-city-control]').forEach(b=>{
    const control=b.dataset.cityControl;
    b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);state.key[control]=true;b.classList.add('active');});
    for(const ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,()=>{state.key[control]=false;b.classList.remove('active');});
  });
  if(new URLSearchParams(location.search).get('start')==='1')start();
  // Exposed for manual testing of driving, detail, and accessible district selection.
  window.__cityDebug=()=>({car:{...state.car},target:cityZones[state.target].name,nearest:state.nearest?.title||null,discovered:state.discovered.size,active:state.active,detail:state.detail?.title||null});
})();
