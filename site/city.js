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
  const miniMap = $('cityMiniMap');
  const miniCtx = miniMap.getContext('2d');
  const xy = [
    [-400,400], [0,400], [400,400], [-400,0],
    [400,0], [-400,-400], [0,-400], [400,-400]
  ];
  const short = ['Research','Papers','Teaching','Engineering','AI Innovation','Education','Community','Contact'];
  const cityZones = zones.map((z,i) => ({...z,cx:xy[i][0],cz:xy[i][1],short:short[i],index:i}));
  const roadCoords = [-600,-200,200,600];
  const items = cityZones.flatMap(zone => zone.items.map((item,j) => {
    const positions = [
      {x:zone.cx,z:zone.cz-120,side:'south'},
      {x:zone.cx+120,z:zone.cz,side:'east'},
      {x:zone.cx,z:zone.cz+120,side:'north'},
      {x:zone.cx-120,z:zone.cz,side:'west'}
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
  function quad(collection, v, color, stroke=null) {
    const n=v.length;
    collection.push({verts:v,color,stroke,
      cx:v.reduce((sum,pt)=>sum+pt[0],0)/n,
      cz:v.reduce((sum,pt)=>sum+pt[2],0)/n});
  }
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
  // Small, detailed architecture rather than untextured perimeter cubes.
  function facadeQuad(points,color,side=0,bx=0,bz=0) {
    quad(solids,points,color);
    const face=solids[solids.length-1];
    face.side=side;face.bx=bx;face.bz=bz;
  }
  function tree(x,z,n) {
    addBox(solids,x,0,z,3,16,3,'#806b55');
    addBox(solids,x,14,z,22,22,22,n%3?'#549b78':'#347f69');
    addBox(solids,x,28,z,16,12,16,'#85c199');
    plane(ground,x,z,17,17,.62,'#a4bd97');
  }
  function lamp(x,z) {
    addBox(solids,x,0,z,2,34,2,'#365a61');
    addBox(solids,x,34,z,12,2,3,'#365a61');
    addBox(solids,x+4,32,z,6,2,5,'#fff4c7');
    plane(ground,x,z,7,7,.6,'#a9bdb5');
  }
  function building(x,z,w,d,h,color,index) {
    const id=index+Math.round(x*7+z*3), glass=['#84c3c6','#7eb1b8','#bedce0','#99c7c9'];
    plane(ground,x+4,z+4,w+15,d+15,.56,'#b0b9b0');
    addBox(solids,x,.75,z,w,h,d,color);
    // A structural foundation and an overhanging, detailed parapet.
    addBox(solids,x,.8,z,w+2,4,d+2,colorHex(color,.66));
    addBox(solids,x,h+.75,z,w+4,3,d+4,colorHex(color,.63));
    const rowCount=Math.max(2,Math.floor((h-15)/13));
    const colX=Math.max(2,Math.floor((w-9)/12));
    const colZ=Math.max(2,Math.floor((d-9)/12));
    // Flat facade quads sit in front of each wall. They cannot become occluded
    // behind the building by sorting an entire 3D window box as one object.
    for(let floor=0;floor<rowCount;floor++) {
      const y=11+floor*13;
      const ledge=y-2;
      facadeQuad([[x-w/2-.45,ledge,z+d/2+1.05],[x+w/2+.45,ledge,z+d/2+1.05],[x+w/2+.45,ledge+1,z+d/2+1.05],[x-w/2-.45,ledge+1,z+d/2+1.05]],colorHex(color,.65));
      for(let j=0;j<colX;j++) {
        const px=x-w/2+(j+.5)*w/colX, ww=Math.min(8.5,w/colX-3.2);
        const tone=glass[Math.floor(rand(id+floor*13+j*23)*glass.length)];
        for(const side of [-1,1]) {
          const zz=z+side*(d/2+1.3);
          facadeQuad([[px-ww/2,y,zz],[px+ww/2,y,zz],[px+ww/2,y+7.5,zz],[px-ww/2,y+7.5,zz]],tone,side*2,x,z);
          facadeQuad([[px-.4,y,zz+side*.16],[px+.4,y,zz+side*.16],[px+.4,y+7.5,zz+side*.16],[px-.4,y+7.5,zz+side*.16]],'#e4f0e7',side*2,x,z);
        }
      }
      for(let j=0;j<colZ;j++) {
        const pz=z-d/2+(j+.5)*d/colZ, ww=Math.min(8.5,d/colZ-3.2);
        for(const side of [-1,1]) {
          const xx=x+side*(w/2+1.3);
          facadeQuad([[xx,y,pz-ww/2],[xx,y,pz+ww/2],[xx,y+7.5,pz+ww/2],[xx,y+7.5,pz-ww/2]],glass[Math.floor(rand(id+floor*15+j*29+side)*4)],side,x,z);
          facadeQuad([[xx+side*.16,y,pz-.4],[xx+side*.16,y,pz+.4],[xx+side*.16,y+7.5,pz+.4],[xx+side*.16,y+7.5,pz-.4]],'#d7ece9',side,x,z);
        }
      }
    }
    // Shopfront doors, glass awnings and rooftop machinery.
    addBox(solids,x,1,z+d/2+1.6,13,14,1.2,'#275c67');
    addBox(solids,x,13,z+d/2+6,24,2,11,index%2?'#cf9b6f':'#dfe9de');
    addBox(solids,x,1,z-d/2-1.6,12,13,1.2,'#365f69');
    addBox(solids,x,h+3,z,Math.min(18,w*.33),6,Math.min(18,d*.3),'#7a9695');
    addBox(solids,x+w*.28,h+3,z-d*.22,9,3,9,'#6f8d8d');
    // Visible window rhythm even on lower-rise blocks.
    addBox(solids,x,h-1,z+d/2+1.3,w-6,1,1.4,'#f0e0bf');
  }
  function makeWorld() {
    const asphalt='#465a65', curbs='#b7bcb6';
    // Roadbed, pavements, verge and markings are grounded at different heights.
    for (const v of roadCoords) {
      // Short segments avoid losing entire roads to camera distance culling.
      for(let pos=-825;pos<850;pos+=110) {
        plane(ground,v,pos,106,110,.03,curbs);
        plane(ground,pos,v,110,106,.04,curbs);
        plane(ground,v,pos,96,110,.1,asphalt);
        plane(ground,pos,v,110,96,.11,asphalt);
        for(const side of [-1,1]) {
          plane(ground,v+side*49,pos,2.4,110,.28,'#f0e8d4');
          plane(ground,pos,v+side*49,110,2.4,.29,'#f0e8d4');
        }
      }
      for(let pos=-825;pos<850;pos+=50) {
        if(roadCoords.some(j=>Math.abs(pos-j)<70))continue;
        plane(ground,v,pos,2,23,.35,'#ead9ab');
        plane(ground,pos,v,23,2,.36,'#ead9ab');
      }
    }
    // Crosswalks end at road edges and signs are placed on corner pavements.
    for(const x of roadCoords) for(const z of roadCoords) {
      for(let q=-33;q<=33;q+=11) {
        plane(ground,x+q,z+57,5.6,13,.4,'#f5f1e7');
        plane(ground,x+q,z-57,5.6,13,.4,'#f5f1e7');
        plane(ground,x+57,z+q,13,5.6,.4,'#f5f1e7');
        plane(ground,x-57,z+q,13,5.6,.4,'#f5f1e7');
      }
      plane(ground,x,z,8,8,.27,'#50656e');
      const near=cityZones.filter(a=>Math.abs(a.cx-x)<255&&Math.abs(a.cz-z)<255);
      const sx=x+74,sz=z+74;
      signposts.push({x:sx,z:sz,nearby:near});
      plane(ground,sx,sz,16,16,.47,'#d6dbd2');
      addBox(solids,sx,0,sz,2.6,27,2.6,'#365d58');
      addBox(solids,sx,24,sz,38,13,3,'#205a57');
      addBox(solids,sx,37,sz,40,2.2,4,'#ebb06c');
      lamp(x-66,z-66);
    }
    const palettes=['#b9cec9','#dab49c','#aaa8c5','#9fbbcd','#c8a6a3','#bcc8a2','#d7bc96','#a6cfbf'];
    for(let index=0; index<9; index++) {
      const x=(index%3-1)*400,z=(1-Math.floor(index/3))*400;
      const zone=cityZones.find(q=>q.cx===x&&q.cz===z);
      // A setback of at least 47 city units separates every building from roads.
      plane(ground,x,z,294,294,.32,'#d4d8d0');
      plane(ground,x,z,282,282,.42,'#e8e4d9');
      plane(ground,x,z,272,272,.48,zone?colorHex(zone.tone,.95):'#9bd6ba');
      // Four narrow paths make an actual pedestrian court through the block.
      plane(ground,x,z,27,282,.53,'#dfe1d7');
      plane(ground,x,z,282,27,.54,'#dfe1d7');
      if(zone) {
        const c=palettes[zone.index];
        const layouts=[[-70,-70,60,57,92], [70,-70,59,56,72],
                       [-70,70,57,59,61], [70,70,58,59,112]];
        layouts.forEach(([bx,bz,w,d,h],n)=>building(x+bx,z+bz,w,d,h+Math.floor(rand(index*19+n)*20),colorHex(c,.86+rand(index*10+n)*.19),index*6+n));
        // Low civic building or research hub with a welcoming glass entrance.
        building(x,z,49,49,43+zone.index%3*8,'#a8c7be',index*6+4);
        for(const [tx,tz] of [[-113,-111],[113,-111],[-113,111],[113,111]])tree(x+tx,z+tz,zone.index);
        // Bollards keep the four information boards completely on pedestrian land.
        for (const b of items.filter(t=>t.zone.index===zone.index)) {
          const flat=b.side==='south'||b.side==='north';
          plane(ground,b.x,b.z,flat?61:17,flat?17:61,.65,'#f6e6c9');
          for(const dir of [-1,1]) {
            const px=b.x+(flat?dir*28:0),pz=b.z+(flat?0:dir*28);
            addBox(solids,px,.55,pz,2.2,6,2.2,'#638780');
          }
        }
      }else{
        // Town square in the centre replaces the previous undetailed cubes.
        plane(ground,x,z,200,200,.56,'#d8dfcf');
        plane(ground,x,z,126,126,.61,'#b7d8c7');
        addBox(solids,x,1,z,54,12,54,'#629f91');
        addBox(solids,x,13,z,43,15,43,'#bddbd3');
        addBox(solids,x,29,z,13,25,13,'#386d66');
        for(let t=0;t<8;t++){const a=t*Math.PI/4;tree(x+Math.cos(a)*116,z+Math.sin(a)*116,t);}
      }
    }
    // Outer neighbourhoods prevent blank fields along the playable perimeter.
    // Centres at +/-800 lie beyond the boundary roads but remain visible to drivers.
    for(const gx of [-800,-400,0,400,800]) for(const gz of [-800,-400,0,400,800]) {
      if(Math.abs(gx)<600 && Math.abs(gz)<600)continue;
      plane(ground,gx,gz,292,292,.38,'#cedacb');
      plane(ground,gx,gz,279,279,.44,'#e5ded2');
      plane(ground,gx,gz,265,265,.49,'#bbd9c0');
      for(const [k,[ox,oz]] of [[-73,-72],[74,-67],[-69,70],[72,76]].entries()) {
        const tint=['#adbbb0','#c4b4a5','#a4bcc0','#dfba9d','#adbd9e'][(Math.abs(gx+gz)+k)%5];
        building(gx+ox,gz+oz,50+rand(k+gx)*15,52+rand(k+gz)*12,
          52+rand(k+gx+gz)*85,tint,116+(gx+800)/400*5+(gz+800)/400+k);
      }
    }
    // Distant blocks remain recognisable as skyscrapers with patterned windows.
    for(let i=0;i<22;i++) {
      const theta=i*Math.PI/11,x=Math.cos(theta)*1020,z=Math.sin(theta)*1020;
      building(x,z,48+rand(i)*25,45+rand(i+6)*27,55+rand(i+19)*110,i%3?'#b2c5bc':'#c9b9a6',i+90);
    }
    // All 32 billboard frames and legs live entirely inside their block boundary.
    for(const b of items) {
      const flat=b.side==='south'||b.side==='north';
      if(flat)for(const dx of [-22,22])addBox(solids,b.x+dx,.65,b.z,2.6,17,2.6,'#43625c');
      else for(const dz of [-22,22])addBox(solids,b.x,.65,b.z+dz,2.6,17,2.6,'#43625c');
    }
  }
  makeWorld();

  function resize() {
    const r=canvas.getBoundingClientRect();
    W=Math.max(1,r.width);H=Math.max(1,r.height);
    dpr=Math.min(window.devicePixelRatio||1,1.6);
    canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    scale=Math.min(W*.88,H*1.08);
  }
  window.addEventListener('resize',resize);
  resize();

  function camera() {
    const c=state.car, fx=Math.sin(c.yaw),fz=Math.cos(c.yaw);
    // Raised third-person camera maintains enough view for a useful city map.
    const px=c.x-fx*208,py=119,pz=c.z-fz*208;
    let dx=fx*310,dy=-114,dz=fz*310;
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
    const vs=face.verts, dx=face.cx-cam.x, dz=face.cz-cam.z;
    if(dx*dx+dz*dz>810000)return;
    if(face.side) {
      // Do not rasterise windows on the face of a building pointing away.
      if(Math.abs(face.side)===1&&(cam.x-face.bx)*face.side<0)return;
      if(Math.abs(face.side)===2&&(cam.z-face.bz)*face.side<0)return;
    }
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
  function excerpt(str) {
    // A concise, information-rich sentence rather than an overlong header.
    const clean=str.replace(/\s+/g,' ').trim();
    return clean.length>180?clean.slice(0,176).replace(/\s+\S*$/,'')+'...':clean;
  }
  function addBillboard(b) {
    if(distance(b.x,b.z,cam.x,cam.z)>590)return;
    const rx=cam.rx,rz=cam.rz;
    const top=pointScreen([b.x,47,b.z]);
    const bottom=pointScreen([b.x,18,b.z]);
    const left=pointScreen([b.x-rx*23.5,24,b.z-rz*23.5]);
    const right=pointScreen([b.x+rx*23.5,24,b.z+rz*23.5]);
    const center=pointScreen([b.x,30,b.z]);
    if(!top||!bottom||!left||!right||!center)return;
    const w=Math.abs(right.x-left.x),h=Math.abs(bottom.y-top.y);
    if(w<47||h<30)return;
    faces.push({depth:center.z-1,draw:()=>{
      const x=center.x, y=top.y;
      if(x< -w/2||x>W+w/2)return;
      const t=clamp(w/18,8,15);
      // One projected sign face keeps the cream panel intact at any camera angle.
      ctx.save();ctx.fillStyle='#315e57';
      ctx.beginPath();ctx.roundRect(x-w*.5-4,y-4,w+8,h+8,3);ctx.fill();
      ctx.fillStyle='#fffaf0';ctx.fillRect(x-w*.5,y,w,h);
      ctx.fillStyle='#24655c';ctx.fillRect(x-w*.5,y,w,h*.20);
      ctx.fillStyle=b.zone.tone;ctx.fillRect(x-w*.5,y+h*.94,w,h*.06);
      ctx.restore();
      ctx.save();ctx.textAlign='left';ctx.textBaseline='top';
      const pad=w*.085,l=x-w*.5+pad,inner=w-pad*2;
      ctx.fillStyle='#f6fff5';ctx.font=`800 ${clamp(t*.62,7,10)}px Arial, sans-serif`;
      if(h>38)ctx.fillText(`${String(b.num).padStart(2,'0')}  ${b.zone.short.toUpperCase()}`,l,y+Math.max(3,h*.065),inner);
      ctx.fillStyle='#163b35';
      const titleFont=`800 ${t}px Arial, sans-serif`;
      const lines=textLines(b.title,inner,2,titleFont);
      ctx.font=titleFont;let ty=y+h*.26;
      for(const line of lines){ctx.fillText(line,l,ty,inner);ty+=t*1.15;}
      const metaFont=clamp(t*.62,7.5,10);
      if(h>66) {
        ctx.fillStyle='#427566';ctx.font=`800 ${metaFont}px Arial, sans-serif`;
        ctx.fillText(b.meta.slice(0,45),l,Math.max(ty+3,y+h*.53),inner);
      }
      if(h>88){
        ctx.fillStyle='#425b52';const fs=clamp(t*.62,7,10);
        const descLines=textLines(excerpt(b.description),inner,3,`500 ${fs}px Arial, sans-serif`);
        ctx.font=`500 ${fs}px Arial, sans-serif`;
        descLines.forEach((line,i)=>ctx.fillText(line,l,y+h*.67+i*fs*1.18,inner));
      }
      if(h>105){ctx.fillStyle='#2b7568';ctx.font='800 8px Arial, sans-serif';ctx.fillText('PARK NEARBY TO READ MORE',l,y+h*.88,inner);}
      ctx.restore();
    }});
  }
  function quadDynamic(v,color) {renderFace({verts:v,color});}
  function addLabels() {
    signposts.forEach(s=>{
      if(distance(s.x,s.z,cam.x,cam.z)>420)return;
      const p=pointScreen([s.x,31,s.z]);
      if(!p||p.z<20)return;
      const left=pointScreen([s.x-18,31,s.z]);const right=pointScreen([s.x+18,31,s.z]);
      if(!left||!right)return;
      const w=Math.abs(right.x-left.x);
      if(w<30||w>440)return;
      faces.push({depth:p.z-2,draw:()=>{
        ctx.save();ctx.fillStyle='#fffbed';ctx.textAlign='center';
        ctx.font=`900 ${clamp(w/8,8,12)}px Arial, sans-serif`;
        ctx.fillText('DISTRICTS',p.x,p.y-5);
        const adjacent=s.nearby.slice(0,2).map(z=>{
          const dx=z.cx-(s.x-74),dz=z.cz-(s.z-74);
          const heading=Math.abs(dx)>Math.abs(dz)?(dx>0?'E':'W'):(dz>0?'N':'S');
          return `${heading}  ${z.short.toUpperCase()}`;
        });
        ctx.font=`800 ${clamp(w/11,6.5,9)}px Arial, sans-serif`;
        for(let i=0;i<adjacent.length;i++)ctx.fillText(adjacent[i],p.x,p.y+7+i*10,Math.max(20,w*.87));
        ctx.restore();
      }});
    });
    cityZones.forEach(z=>{
      if(distance(z.cx,z.cz,cam.x,cam.z)>630)return;
      const p=pointScreen([z.cx,150,z.cz]);
      if(p&&p.z>170&&p.z<560){faces.push({depth:p.z-1,draw:()=>{
        ctx.save();ctx.textAlign='center';ctx.font='800 10px Arial, sans-serif';
        const txt=z.short.toUpperCase(),tw=ctx.measureText(txt).width+22;
        ctx.fillStyle='#fffaf0ed';ctx.strokeStyle='#a7c8b9';ctx.lineWidth=1;
        ctx.beginPath();ctx.roundRect(p.x-tw/2,p.y-16,tw,23,6);ctx.fill();ctx.stroke();
        ctx.fillStyle='#235848';ctx.fillText(txt,p.x,p.y-1);ctx.restore();
      }});}
    });
  }
  function addCar() {
    const c=state.car,f=[],bx=c.x,bz=c.z;
    const put=(side,forward,y,w,h,d,color)=>{
      const x=bx+side*Math.cos(c.yaw)+forward*Math.sin(c.yaw);
      const z=bz-side*Math.sin(c.yaw)+forward*Math.cos(c.yaw);
      addBox(f,x,y,z,w,h,d,color,c.yaw);
    };
    // Subcompact proportions relative to a 96-unit road. Detailed cabin,
    // windscreen, bumpers, brake lights and four real wheel shapes.
    put(0,0,3,17,7,32,'#ef865a');
    put(0,-4,10,14,7,19,'#eaa780');
    put(0,2,11,14.3,3,10,'#376777');
    put(0,-10,8,14,3,5,'#376777');
    put(0,15.5,3,18,2,2,'#eccab0');
    put(0,-16,4,18,2,2,'#45636b');
    for(const side of [-9.5,9.5]) for(const forward of [-10.5,10.5])
      put(side,forward,1.5,3.3,6.5,7.5,'#23343d');
    for(const side of [-5.7,5.7]){
      put(side,15.8,6,3.2,1.6,1.4,'#fff5cd');
      put(side,-15.8,6,3.2,1.6,1.4,'#b73f40');
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
    state.nearest=dist<91?billboard:null;
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
    if(!b || (!fromMenu&&(distance(b.x,b.z,state.car.x,state.car.z)>96||Math.abs(state.car.speed)>7)))return;
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
    $('citySidebar').inert=!open;
    $('cityMenuButton').setAttribute('aria-expanded',String(open));
    if(open) $('citySidebarClose').focus({preventScroll:true});
    else $('cityMenuButton').focus({preventScroll:true});
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
    miniCtx.drawImage(map,0,0,miniMap.width,miniMap.height);
  }
  function driving(dt) {
    const key=state.key,c=state.car;
    const throttle=key.up||key.ArrowUp||key.w||key.W;
    const reverse=key.down||key.ArrowDown||key.s||key.S;
    const left=key.left||key.ArrowLeft||key.a||key.A;
    const right=key.right||key.ArrowRight||key.d||key.D;
    const brake=key.brake||key[' ']||key.Space;
    if(throttle)c.speed=Math.min(125,c.speed+112*dt);
    if(reverse)c.speed=Math.max(-57,c.speed-140*dt);
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
    const solid = cityZones.some(z=> {
      const dx=Math.abs(nx-z.cx),dz=Math.abs(nz-z.cz);
      return (dx<104&&dz<104) || (dx<118&&dz<116 && (dx>35&&dz>35));
    }) || (Math.abs(nx)<39&&Math.abs(nz)<39);
    if(solid){c.speed*=-.28;}else{c.x=nx;c.z=nz;}
    $('citySpeed').textContent=String(Math.round(Math.abs(c.speed)*.72)).padStart(2,'0');
    if(!state.detail){
      const {billboard,dist}=getClosestBillboard();
      if(billboard&&dist<86&&Math.abs(c.speed)<3&&state.ridden&&state.lastOpened!==billboard.index){
        state.parking+=dt;
        if(state.parking>2.2){state.lastOpened=billboard.index;openBillboard(billboard);}
      }else if(dist>100||Math.abs(c.speed)>8){state.parking=0;}
      if(dist>115)state.lastOpened=-1;
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
  $('citySidebar').inert=true;
  addDistrictNav();updateNearby();routing();mapDraw();
  $('cityStart').addEventListener('click',start);
  $('cityReadButton').addEventListener('click',()=>openBillboard(state.nearest));
  $('cityDetailClose').addEventListener('click',closeBillboard);
  $('cityDetailContinue').addEventListener('click',closeBillboard);
  $('cityMenuButton').addEventListener('click',()=>toggleMap());
  $('citySidebarClose').addEventListener('click',()=>toggleMap(false));
  $('cityReset').addEventListener('click',()=>{state.car={x:-200,z:-720,yaw:0,speed:0};state.parking=0;state.ridden=false;});
  $('cityDetail').addEventListener('click',e=>{if(e.target===$('cityDetail'))closeBillboard();});
  const known=['w','W','s','S','a','A','d','D','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','e','E','m','M','Escape'];
  document.addEventListener('keydown',e=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
    if(known.includes(e.key)&&!(e.altKey||e.ctrlKey||e.metaKey)){
      if([' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault();
      if(e.key==='Escape'){if(state.detail)closeBillboard();else toggleMap(false);return;}
      if((e.key==='m'||e.key==='M')&&!state.detail){toggleMap();return;}
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
