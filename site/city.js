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
    car:{x:-200,z:-380,yaw:0,speed:0},
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
  const ground = [], solids = [], signposts = [], buildingFootprints = [], fixedPropFootprints = [];
  const WORLD_LIMIT = 795;
  const ROAD_END = 600;
  const billboardTextures = new Map();
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
    // The footprint is the same geometry used to render the building, so
    // collision walls always line up with the visible facades.
    buildingFootprints.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});
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
    // Every street ends on the perimeter loop at +/-600. No asphalt spurs
    // extend outside the closed playable square into the building wall.
    for (const v of roadCoords) {
      for(let pos=-ROAD_END; pos<ROAD_END; pos+=100) {
        const len=Math.min(100,ROAD_END-pos),mid=pos+len/2;
        plane(ground,v,mid,106,len,.03,curbs);
        plane(ground,mid,v,len,106,.04,curbs);
        plane(ground,v,mid,96,len,.1,asphalt);
        plane(ground,mid,v,len,96,.11,asphalt);
        for(const side of [-1,1]) {
          plane(ground,v+side*49,mid,2.4,len,.28,'#f0e8d4');
          plane(ground,mid,v+side*49,len,2.4,.29,'#f0e8d4');
        }
      }
      for(let pos=-ROAD_END+24;pos<ROAD_END-24;pos+=50) {
        if(roadCoords.some(j=>Math.abs(pos-j)<70))continue;
        plane(ground,v,pos,2,23,.35,'#ead9ab');
        plane(ground,pos,v,23,2,.36,'#ead9ab');
      }
    }
    // A fixed, highly visible road edge. The four +/-600 streets connect
    // around the city and allow driving a complete lap in either direction.
    for(const edge of [-600,600]) {
      for(let p=-565;p<=565;p+=30) {
        if(roadCoords.some(v=>Math.abs(p-v)<69))continue;
        plane(ground,edge,p,2,16,.37,'#ffedc7');
        plane(ground,p,edge,16,2,.38,'#ffedc7');
      }
    }
    // Crosswalks end at road edges and signs are placed on corner pavements.
    for(const x of roadCoords) for(const z of roadCoords) {
      for(let q=-33;q<=33;q+=11) {
        // No zebra crossings into buildings at the outer edges.
        if(z<600)plane(ground,x+q,z+57,5.6,13,.4,'#f5f1e7');
        if(z>-600)plane(ground,x+q,z-57,5.6,13,.4,'#f5f1e7');
        if(x<600)plane(ground,x+57,z+q,13,5.6,.4,'#f5f1e7');
        if(x>-600)plane(ground,x-57,z+q,13,5.6,.4,'#f5f1e7');
      }
      plane(ground,x,z,8,8,.27,'#50656e');
      // Junction signboards use fixed world coordinates, cardinal directions,
      // and fixed destination labels. Nothing rotates or follows the camera.
      // Keep signs on the city-facing pavement even at the outer edges.
      const sx=x+(x===600?-82:82),sz=z+(z===600?-82:82);
      signposts.push({x:sx,z:sz,crossX:x,crossZ:z});
      fixedPropFootprints.push({minX:sx-2,maxX:sx+2,minZ:sz-2,maxZ:sz+2});
      plane(ground,sx,sz,16,16,.47,'#d6dbd2');
      addBox(solids,sx,0,sz,3.2,61,3.2,'#365d58');
      addBox(solids,sx,61,sz,6.3,2.8,6.3,'#f5c484');
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
        buildingFootprints.push({minX:x-27,maxX:x+27,minZ:z-27,maxZ:z+27});
        addBox(solids,x,1,z,54,12,54,'#629f91');
        addBox(solids,x,13,z,43,15,43,'#bddbd3');
        addBox(solids,x,29,z,13,25,13,'#386d66');
        for(let t=0;t<8;t++){const a=t*Math.PI/4;tree(x+Math.cos(a)*116,z+Math.sin(a)*116,t);}
      }
    }
    // One continuous architectural wall encloses the city outside the
    // perimeter road. Each building touches or overlaps its neighbours, with
    // no drivable holes at corners. Buildings remain collidable and detailed.
    const boundaryPalettes=['#a9bec4','#c5b2a1','#bdd1bc','#b2b7c7','#c8b79f','#aabeb2'];
    for(const side of [-1,1]) {
      for(let k=-8;k<=8;k++) {
        const along=k*88;
        const seed=(side+2)*100+k+20;
        const base=boundaryPalettes[(Math.abs(k)+ (side===1?2:0))%boundaryPalettes.length];
        const height=66+rand(seed*3)*75;
        // Wall-facing facades begin around 692, safely behind the sidewalk
        // beyond the road edge (648).
        building(side*742,along,104,90,height,base,300+seed);
        building(along,side*742,90,104,65+rand(seed*5)*90,
          boundaryPalettes[(Math.abs(k)+3+(side===1?1:0))%boundaryPalettes.length],600+seed);
      }
      for(const other of [-1,1]) {
        building(side*743,other*743,96,96,96+rand(side*5+other)*42,
          '#a8c6bc',850+side*3+other);
      }
    }
    // Inset pedestrian strips run between outer building fronts and the loop.
    for (const side of [-1,1]) {
      plane(ground,side*666,0,31,1300,.48,'#deddd3');
      plane(ground,0,side*666,1300,31,.49,'#deddd3');
    }
    // Permanent billboard panels, posts and frames stay in world coordinates.
    for(const b of items) {
      const horizontal=b.side==='south'||b.side==='north';
      if(horizontal) {
        for(const dx of [-24,24])addBox(solids,b.x+dx,.65,b.z,2.6,21,2.6,'#43625c');
        // Open rectangular frame. The textured print IS the sign surface;
        // a solid backing quad previously covered its lettering in Canvas2D.
        addBox(solids,b.x,19,b.z,60,3,2.8,'#325a53');
        addBox(solids,b.x,52,b.z,60,3,2.8,'#325a53');
        addBox(solids,b.x-29.5,21,b.z,2.8,31,2.8,'#325a53');
        addBox(solids,b.x+29.5,21,b.z,2.8,31,2.8,'#325a53');
        fixedPropFootprints.push({minX:b.x-30,maxX:b.x+30,minZ:b.z-2,maxZ:b.z+2});
      } else {
        for(const dz of [-24,24])addBox(solids,b.x,.65,b.z+dz,2.6,21,2.6,'#43625c');
        addBox(solids,b.x,19,b.z,2.8,3,60,'#325a53');
        addBox(solids,b.x,52,b.z,2.8,3,60,'#325a53');
        addBox(solids,b.x,21,b.z-29.5,2.8,31,2.8,'#325a53');
        addBox(solids,b.x,21,b.z+29.5,2.8,31,2.8,'#325a53');
        fixedPropFootprints.push({minX:b.x-2,maxX:b.x+2,minZ:b.z-30,maxZ:b.z+30});
      }
    }
    // Fixed four-way pointer brackets, physically aligned to cardinal axes.
    for(const sign of signposts)for(const [i,[dx,dz]] of [[0,1],[1,0],[0,-1],[-1,0]].entries()) {
      const sx=sign.x+dx*16,sz=sign.z+dz*16,y=34+i*7.8;
      if(dx)addBox(solids,sx,y,sz,32,6.8,2.2,'#20584f');
      else addBox(solids,sx,y,sz,2.2,6.8,32,'#20584f');
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
    // Keep the camera inside the building wall even on the perimeter loop.
    // Aim toward the car and the next stretch of road, not through a facade.
    // Use the requested 95/58/.50 chase-camera preset. Move the eye forward
    // only when a building or a permanent roadside billboard would otherwise
    // end up BETWEEN the car and the camera (preventing a giant sign filling
    // the entire screen). The sign itself never moves.
    let chaseDistance=95;
    const cameraBlocked=(x,z)=>{
      const radius=5;
      return buildingFootprints.some(b=>x>b.minX-radius&&x<b.maxX+radius&&z>b.minZ-radius&&z<b.maxZ+radius)||
        fixedPropFootprints.some(b=>x>b.minX-radius&&x<b.maxX+radius&&z>b.minZ-radius&&z<b.maxZ+radius);
    };
    for(let step=22;step<=95;step+=4){
      if(cameraBlocked(c.x-fx*step,c.z-fz*step)){
        chaseDistance=Math.max(20,step-10);break;
      }
    }
    const px=clamp(c.x-fx*chaseDistance,-664,664),py=58,
          pz=clamp(c.z-fz*chaseDistance,-664,664);
    const followGap=Math.max(32,(c.x-px)*fx+(c.z-pz)*fz);
    const ahead=followGap*.50;
    let dx=c.x+fx*ahead-px,dy=-58,dz=c.z+fz*ahead-pz;
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
  // These canvases are generated once, like printed billboard artwork.
  // Their text cannot face or move with the camera during driving.
  function makePrintedCanvas(width,height,paint) {
    const c=document.createElement('canvas');c.width=width;c.height=height;
    paint(c.getContext('2d'),width,height);return c;
  }
  function wrapPrinted(g,value,maxWidth,maxLines,lineHeight,atX,atY) {
    const words=String(value).split(/\s+/);let lines=[],line='';
    for(const word of words) {
      const trial=line?line+' '+word:word;
      if(line&&g.measureText(trial).width>maxWidth) {lines.push(line);line=word;}else line=trial;
    }
    if(line)lines.push(line);
    if(lines.length>maxLines){lines=lines.slice(0,maxLines);lines[maxLines-1]=lines[maxLines-1].replace(/[ .,;:]*$/,'')+'...';}
    lines.forEach((txt,i)=>g.fillText(txt,atX,atY+i*lineHeight,maxWidth));
    return lines.length;
  }
  function createBillboardArt(b) {
    return makePrintedCanvas(720,430,(g,w,h)=>{
      g.fillStyle='#fff9ee';g.fillRect(0,0,w,h);
      g.fillStyle='#215e56';g.fillRect(0,0,w,76);
      g.fillStyle='#fff9ee';g.font='bold 25px Arial';
      g.fillText(`${String(b.num).padStart(2,'0')}   ${b.zone.short.toUpperCase()}`,32,48,660);
      g.textBaseline='top';
      g.fillStyle='#163f38';g.font='bold 44px Arial';
      const n=wrapPrinted(g,b.title,660,2,51,32,96);
      const next=96+n*51+13;
      g.fillStyle='#347263';g.font='bold 22px Arial';
      g.fillText(String(b.meta).slice(0,110),32,next,660);
      g.fillStyle='#3b5650';g.font='24px Arial';
      wrapPrinted(g,excerpt(b.description),655,4,32,32,next+42);
      g.fillStyle=b.zone.tone;g.fillRect(0,h-19,w,19);
      g.fillStyle='#215e56';g.font='bold 17px Arial';
      g.fillText('PARK AND PRESS E FOR FULL DETAILS',32,h-45,660);
    });
  }
  function createDirectionArt(dir,label) {
    return makePrintedCanvas(620,140,(g,w,h)=>{
      g.fillStyle='#20584f';g.fillRect(0,0,w,h);
      g.fillStyle='#f1b87d';g.fillRect(0,0,114,h);
      g.fillStyle='#183f36';g.font='bold 82px Arial';g.textAlign='center';
      g.fillText(dir,57,102);
      g.fillStyle='#fffbed';g.textAlign='left';g.font='bold 40px Arial';
      g.fillText(label.toUpperCase(),132,90,455);
      g.fillStyle='#a6ddd1';g.fillRect(130,108,430,4);
    });
  }
  function cardinalDestination(x,z,dir) {
    const vec={N:[0,1],E:[1,0],S:[0,-1],W:[-1,0]}[dir];
    if((vec[0]&&x*vec[0]>=600)||(vec[1]&&z*vec[1]>=600))return 'CITY LIMIT';
    const candidates=cityZones.filter(q=>((q.cx-x)*vec[0]+(q.cz-z)*vec[1])>60);
    if(!candidates.length)return 'CENTRAL PLAZA';
    candidates.sort((a,b)=>{
      const v=q=>Math.abs((q.cx-x)*vec[1]-(q.cz-z)*vec[0])*.95 +
        Math.abs((q.cx-x)*vec[0]+(q.cz-z)*vec[1])*.6;
      return v(a)-v(b);
    });
    return candidates[0].short;
  }
  const directionBoards=[];
  for(const s of signposts) {
    for(const [i,[name,dx,dz]] of [['N',0,1],['E',1,0],['S',0,-1],['W',-1,0]].entries()) {
      const destination=cardinalDestination(s.crossX,s.crossZ,name);
      directionBoards.push({
        x:s.x+dx*16,z:s.z+dz*16,
        y:34+i*7.8,w:30,h:6.5,dir:name,dx,dz,
        texture:createDirectionArt(name,destination)
      });
    }
  }
  for(const b of items)billboardTextures.set(b.index,createBillboardArt(b));

  // Render a texture on a real, fixed vertical plane in world space, not a
  // camera-facing sprite. A two-triangle affine projection maintains the
  // orientation and readability of the printed sign from either approach.
  // Fallback: map an exact print or ground image crop to a triangle. The
  // triangles are small enough to keep affine and true perspective almost equal.
  function drawPrintTriangle(tex,src,dst) {
    const [t0,t1,t2]=src,[p0,p1,p2]=dst;
    const [u0,v0]=t0,[u1,v1]=t1,[u2,v2]=t2;
    const det=(u1-u0)*(v2-v0)-(u2-u0)*(v1-v0);
    if(Math.abs(det)<1e-5)return;
    const a=((p1.x-p0.x)*(v2-v0)-(p2.x-p0.x)*(v1-v0))/det;
    const c=((p2.x-p0.x)*(u1-u0)-(p1.x-p0.x)*(u2-u0))/det;
    const b=((p1.y-p0.y)*(v2-v0)-(p2.y-p0.y)*(v1-v0))/det;
    const d=((p2.y-p0.y)*(u1-u0)-(p1.y-p0.y)*(u2-u0))/det;
    const e=p0.x-a*u0-c*v0,f=p0.y-b*u0-d*v0;
    // Drawing a cropped portion avoids wasting time resampling the whole atlas
    // for each tile in the fallback renderer.
    const sx=Math.max(0,Math.floor(Math.min(u0,u1,u2))-2);
    const sy=Math.max(0,Math.floor(Math.min(v0,v1,v2))-2);
    const ex=Math.min(tex.width,Math.ceil(Math.max(u0,u1,u2))+2);
    const ey=Math.min(tex.height,Math.ceil(Math.max(v0,v1,v2))+2);
    if(ex<=sx||ey<=sy)return;
    // Overlap clip boundaries by a fraction of a screen pixel, avoiding the
    // diagonal hairline seams caused by Canvas2D's per-triangle antialiasing.
    const cx=(p0.x+p1.x+p2.x)/3,cy=(p0.y+p1.y+p2.y)/3;
    const padded=[p0,p1,p2].map(p=>{
      const l=Math.hypot(p.x-cx,p.y-cy)||1;
      return {x:p.x+(p.x-cx)*.75/l,y:p.y+(p.y-cy)*.75/l};
    });
    ctx.save();ctx.beginPath();ctx.moveTo(padded[0].x,padded[0].y);
    ctx.lineTo(padded[1].x,padded[1].y);ctx.lineTo(padded[2].x,padded[2].y);ctx.closePath();ctx.clip();
    ctx.transform(a,b,c,d,e,f);
    ctx.drawImage(tex,sx,sy,ex-sx,ey-sy,sx,sy,ex-sx,ey-sy);
    ctx.restore();
  }
  // Clip an arbitrary world-space textured polygon against the camera's near
  // plane, interpolating its printed UVs so it does not pop out when approached.
  function clipPrinted(poly){
    const raw=poly.map(v=>{
      const a=view(v);return [a[0],a[1],a[2],v[3],v[4]];
    });
    const near=4,clip=[];
    for(let i=0;i<raw.length;i++){
      const p=raw[i],q=raw[(i+1)%raw.length],pin=p[2]>near,qin=q[2]>near;
      if(pin)clip.push(p);
      if(pin!==qin){
        const t=(near-p[2])/(q[2]-p[2]);
        clip.push(p.map((n,j)=>n+(q[j]-n)*t));
      }
    }
    if(clip.length<3)return [];
    return clip.map(v=>({x:W*.5+v[0]*scale/v[2],y:H*.5-v[1]*scale/v[2],z:v[2],u:v[3],v:v[4]}));
  }
  function texturedPatch(tex,polygon){
    const pt=clipPrinted(polygon);
    if(pt.length<3)return;
    if(pt.every(p=>p.x<-8)||pt.every(p=>p.x>W+8)||pt.every(p=>p.y<-8)||pt.every(p=>p.y>H+8))return;
    const depth=pt.reduce((s,p)=>s+p.z,0)/pt.length;
    const patch={depth,draw:()=>{
      for(let i=1;i<pt.length-1;i++){
        const v=[pt[0],pt[i],pt[i+1]];
        drawPrintTriangle(tex,v.map(p=>[p.u,p.v]),v);
      }
    }};
    faces.push(patch);
  }
  function staticPanel(x,y,z,w,h,rx,rz,nx,nz,texture,range=650) {
    if(distance(x,z,cam.x,cam.z)>range)return;
    const front=(cam.x-x)*nx+(cam.z-z)*nz>=0;
    // Print once on each face of the physical board. Both are readable.
    const side=front?1:-1,ux=rx*side,uz=rz*side,ox=nx*side*1.72,oz=nz*side*1.72;
    const across=9,down=5;
    for(let row=0;row<down;row++)for(let col=0;col<across;col++){
      const corners=[];
      for(const [a,b] of [[col,row],[col+1,row],[col+1,row+1],[col,row+1]]){
        const u=a/across,v=b/down;
        corners.push([x+ux*(u-.5)*w+ox,y+h*(1-v),z+uz*(u-.5)*w+oz,u*texture.width,v*texture.height]);
      }
      texturedPatch(texture,corners);
    }
  }
  function drawContinuousGroundFallback(){
    // Split the continuous atlas into non-overlapping 80-unit world tiles.
    // Each tile is clipped at the near plane and painted in perspective.
    const step=95,tex=continuousGround;
    for(let x=-WORLD_LIMIT;x<WORLD_LIMIT;x+=step)for(let z=-WORLD_LIMIT;z<WORLD_LIMIT;z+=step){
      const nx=Math.min(x+step,WORLD_LIMIT),nz=Math.min(z+step,WORLD_LIMIT);
      const midx=(x+nx)*.5,midz=(z+nz)*.5;
      if(distance(midx,midz,cam.x,cam.z)>790)continue;
      const v=view([midx,.05,midz]);
      if(v[2]<-step*1.2||v[2]>900||Math.abs(v[0])>Math.max(0,v[2])*W/(2*scale)+step*1.6)continue;
      const px=t=>(t+WORLD_LIMIT)/(WORLD_LIMIT*2)*tex.width;
      const pz=t=>(WORLD_LIMIT-t)/(WORLD_LIMIT*2)*tex.height;
      texturedPatch(tex,[[x,.05,z,px(x),pz(z)],[nx,.05,z,px(nx),pz(z)],
          [nx,.05,nz,px(nx),pz(nz)],[x,.05,nz,px(x),pz(nz)]]);
    }
  }
  function drawBillboards() {
    for(const b of items){
      // Each board faces its nearest road for the lifetime of the page.
      const normal={south:[0,-1],north:[0,1],east:[1,0],west:[-1,0]}[b.side];
      const [nx,nz]=normal;
      staticPanel(b.x,19,b.z,57,33,-nz,nx,nx,nz,billboardTextures.get(b.index));
    }
    for(const board of directionBoards) {
      const {dx,dz}=board;
      // Each of the four fixed arrows has a textured front and rear. Neither
      // the printed text nor its direction changes when the car turns.
      staticPanel(board.x,board.y,board.z,board.w,board.h,dx,dz,dz,-dx,board.texture,430);
      staticPanel(board.x,board.y,board.z,board.w,board.h,-dx,-dz,-dz,dx,board.texture,430);
    }
  }

  // A single baked map is shared by WebGL and the Canvas fallback. The road,
  // grass, pedestrian paths and intersection paint are no longer separate
  // overlapping 3D polygons, so they never compete for rendering order.
  function makeContinuousGround() {
    const art=document.createElement('canvas');art.width=2560;art.height=2560;
    const paint=art.getContext('2d',{alpha:false});
    const span=WORLD_LIMIT*2;
    const xPx=x=>(x+WORLD_LIMIT)/span*art.width;
    const zPx=z=>(WORLD_LIMIT-z)/span*art.height;
    paint.fillStyle='#b5d6b9';paint.fillRect(0,0,art.width,art.height);
    for(const face of ground){
      paint.beginPath();face.verts.forEach((p,i)=>i?paint.lineTo(xPx(p[0]),zPx(p[2])):paint.moveTo(xPx(p[0]),zPx(p[2])));
      paint.closePath();paint.fillStyle=face.color;paint.fill();
    }
    return art;
  }
  const continuousGround=makeContinuousGround();

  // Version 6: perspective-correct, depth-tested WebGL city renderer.
  // World geometry is static. Only the car and camera change when driving.
  // The entire street surface is rasterized once into ONE continuous texture:
  // there are no overlapping coplanar road rectangles to flicker or show holes.
  // Sign lettering is permanently baked into static world-space textures.
  function createWebGLScene() {
    const glCanvas=document.createElement('canvas');
    glCanvas.id='cityWorldGL';
    glCanvas.setAttribute('aria-hidden','true');
    canvas.after(glCanvas);
    const options={alpha:true,depth:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:false};
    let gl=glCanvas.getContext('webgl2',options);
    const isWebGL2=!!gl;
    if(!gl)gl=glCanvas.getContext('webgl',options);
    if(!gl){glCanvas.remove();return null;}
    const vertex=`${isWebGL2?'#version 300 es\n':''}
      precision highp float;
      ${isWebGL2?'in':'attribute'} vec3 a_position;
      ${isWebGL2?'in':'attribute'} vec4 a_color;
      ${isWebGL2?'in':'attribute'} vec2 a_uv;
      uniform vec3 u_eye,u_right,u_up,u_forward;
      uniform vec2 u_screen;
      ${isWebGL2?'out':'varying'} vec4 v_color;
      ${isWebGL2?'out':'varying'} vec2 v_uv;
      void main(){
        vec3 p=a_position-u_eye;
        float x=dot(p,u_right),y=dot(p,u_up),z=dot(p,u_forward);
        float near=2.0,far=2400.0;
        gl_Position=vec4(x*u_screen.x,y*u_screen.y,z*(far+near)/(far-near)-(2.0*far*near)/(far-near),z);
        v_color=a_color;
        v_uv=a_uv;
      }`;
    const fragment=`${isWebGL2?'#version 300 es\n':''}
      precision mediump float;
      ${isWebGL2?'in':'varying'} vec4 v_color;
      ${isWebGL2?'in':'varying'} vec2 v_uv;
      uniform sampler2D u_image;
      uniform bool u_textured;
      ${isWebGL2?'out vec4 outColor;':''}
      void main(){${isWebGL2?'outColor':'gl_FragColor'}=u_textured?${isWebGL2?'texture':'texture2D'}(u_image,v_uv):v_color;}`;
    const shader=(type,source)=>{
      const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog=gl.createProgram();
    gl.attachShader(prog,shader(gl.VERTEX_SHADER,vertex));
    gl.attachShader(prog,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const attr={p:gl.getAttribLocation(prog,'a_position'),c:gl.getAttribLocation(prog,'a_color'),t:gl.getAttribLocation(prog,'a_uv')};
    const uni={eye:gl.getUniformLocation(prog,'u_eye'),right:gl.getUniformLocation(prog,'u_right'),up:gl.getUniformLocation(prog,'u_up'),front:gl.getUniformLocation(prog,'u_forward'),screen:gl.getUniformLocation(prog,'u_screen'),textured:gl.getUniformLocation(prog,'u_textured')};
    const rgb=(hex)=>{const n=parseInt(hex.slice(1),16);return [(n>>16)/255,((n>>8)&255)/255,(n&255)/255,1];};
    // 9 floats per vertex: XYZ + RGBA + UV. All polygons are triangles.
    const vertexData=(faces)=>{
      const out=[];
      for(const face of faces){
        const c=rgb(face.color),v=face.verts;
        for(let i=1;i<v.length-1;i++)for(const j of [0,i,i+1])out.push(...v[j],...c,0,0);
      }
      return new Float32Array(out);
    };
    const makeBuffer=(data,usage=gl.STATIC_DRAW)=>{
      const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,usage);
      return {buffer,count:data.length/9};
    };
    const bind=(mesh)=>{
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
      const stride=9*4;
      gl.enableVertexAttribArray(attr.p);gl.vertexAttribPointer(attr.p,3,gl.FLOAT,false,stride,0);
      gl.enableVertexAttribArray(attr.c);gl.vertexAttribPointer(attr.c,4,gl.FLOAT,false,stride,3*4);
      gl.enableVertexAttribArray(attr.t);gl.vertexAttribPointer(attr.t,2,gl.FLOAT,false,stride,7*4);
    };
    const uploadTexture=(source)=>{
      const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      // WebGL 1 requires non-power-of-two textures without mipmaps.
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,isWebGL2?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      if(isWebGL2)gl.generateMipmap(gl.TEXTURE_2D);
      return tex;
    };
    const groundTexture=uploadTexture(continuousGround);
    const groundVerts=new Float32Array([
      -WORLD_LIMIT,0,-WORLD_LIMIT,1,1,1,1,0,0,
      WORLD_LIMIT,0,-WORLD_LIMIT,1,1,1,1,1,0,
      WORLD_LIMIT,0,WORLD_LIMIT,1,1,1,1,1,1,
      -WORLD_LIMIT,0,-WORLD_LIMIT,1,1,1,1,0,0,
      WORLD_LIMIT,0,WORLD_LIMIT,1,1,1,1,1,1,
      -WORLD_LIMIT,0,WORLD_LIMIT,1,1,1,1,0,1
    ]);
    const groundMesh=makeBuffer(groundVerts);
    const solidMesh=makeBuffer(vertexData(solids));
    const carBuffer=gl.createBuffer();
    const signs=[];
    // Text on both sides is right-reading. There is no camera-facing sprite,
    // no frame-by-frame text layout and no orientation tracking.
    const addPrintedFace=(x,y,z,w,h,rx,rz,nx,nz,texture,offset=1.7)=>{
      const hw=w*.5,verts=[];
      const corners=[
        [x-rx*hw+nx*offset,y+h,z-rz*hw+nz*offset,0,1],
        [x+rx*hw+nx*offset,y+h,z+rz*hw+nz*offset,1,1],
        [x+rx*hw+nx*offset,y,z+rz*hw+nz*offset,1,0],
        [x-rx*hw+nx*offset,y,z-rz*hw+nz*offset,0,0]
      ];
      for(const i of [0,1,2,0,2,3]){
        const pt=corners[i];verts.push(pt[0],pt[1],pt[2],1,1,1,1,pt[3],pt[4]);
      }
      signs.push({x,z,mesh:makeBuffer(new Float32Array(verts)),texture});
    };
    for(const b of items){
      const normals={south:[0,-1],north:[0,1],east:[1,0],west:[-1,0]};
      const [nx,nz]=normals[b.side];
      const texture=uploadTexture(billboardTextures.get(b.index));
      addPrintedFace(b.x,21,b.z,55.5,31.5,-nz,nx,nx,nz,texture);
      addPrintedFace(b.x,21,b.z,55.5,31.5,nz,-nx,-nx,-nz,texture);
    }
    for(const sign of directionBoards){
      const {dx,dz}=sign,texture=uploadTexture(sign.texture);
      // Sign brackets are 2.2 units thick, so both prints are just beyond the frame.
      addPrintedFace(sign.x,sign.y+.2,sign.z,sign.w-1,sign.h-1,dx,dz,dz,-dx,texture,1.4);
      addPrintedFace(sign.x,sign.y+.2,sign.z,sign.w-1,sign.h-1,-dx,-dz,-dz,dx,texture,1.4);
    }
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);
    const draw=(mesh,texture=null)=>{
      gl.uniform1i(uni.textured,!!texture);
      if(texture)gl.bindTexture(gl.TEXTURE_2D,texture);
      bind(mesh);gl.drawArrays(gl.TRIANGLES,0,mesh.count);
    };
    const renderGL=()=>{
      const ww=Math.round(W*dpr),hh=Math.round(H*dpr);
      if(glCanvas.width!==ww||glCanvas.height!==hh){glCanvas.width=ww;glCanvas.height=hh;}
      gl.viewport(0,0,glCanvas.width,glCanvas.height);
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform3f(uni.eye,cam.x,cam.y,cam.z);
      gl.uniform3f(uni.right,cam.rx,0,cam.rz);
      gl.uniform3f(uni.up,cam.ux,cam.uy,cam.uz);
      gl.uniform3f(uni.front,cam.fx,cam.fy,cam.fz);
      gl.uniform2f(uni.screen,2*scale/W,2*scale/H);
      // One continuous flat ground. Depth test handles all building/window
      // occlusion, even at oblique angles and intersections.
      draw(groundMesh,groundTexture);
      draw(solidMesh);
      // Frustum distance check only changes whether an object is rendered;
      // the artwork, location and rotation always stay fixed.
      for(const s of signs)if(Math.abs(s.x-cam.x)<720&&Math.abs(s.z-cam.z)<720)draw(s.mesh,s.texture);
      const f=[];
      const c=state.car,bx=c.x,bz=c.z;
      const put=(side,forward,y,w,h,d,color)=>{
        const x=bx+side*Math.cos(c.yaw)+forward*Math.sin(c.yaw);
        const z=bz-side*Math.sin(c.yaw)+forward*Math.cos(c.yaw);
        addBox(f,x,y,z,w,h,d,color,c.yaw);
      };
      put(0,0,3,17,7,32,'#ef865a');put(0,-4,10,14,7,19,'#eaa780');
      put(0,2,11,14.3,3,10,'#376777');put(0,-10,8,14,3,5,'#376777');
      put(0,15.5,3,18,2,2,'#eccab0');put(0,-16,4,18,2,2,'#45636b');
      for(const side of [-9.5,9.5])for(const forward of [-10.5,10.5])put(side,forward,1.5,3.3,6.5,7.5,'#23343d');
      for(const side of [-5.7,5.7]){put(side,15.8,6,3.2,1.6,1.4,'#fff5cd');put(side,-15.8,6,3.2,1.6,1.4,'#b73f40');}
      const data=vertexData(f);
      gl.bindBuffer(gl.ARRAY_BUFFER,carBuffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
      draw({buffer:carBuffer,count:data.length/9});
    };
    // Keep a diagnostic so the user can confirm WebGL is active.
    return {render:renderGL,signCount:signs.length,ground:'single continuous textured plane',type:isWebGL2?'WebGL2 depth tested':'WebGL1 depth tested'};
  }
  let webglScene=null;
  try{webglScene=createWebGLScene();}catch(err){console.warn('WebGL renderer unavailable, using Canvas2D fallback:',err);}

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
    if(webglScene){
      // The original 2D canvas supplies only the sky and green horizon.
      // The transparent WebGL layer renders all world geometry with a depth buffer.
      const sky=ctx.createLinearGradient(0,0,0,H*.76);
      sky.addColorStop(0,'#acdded');sky.addColorStop(.55,'#dff5f1');sky.addColorStop(1,'#eff4cb');
      ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#b5d6b9';ctx.fillRect(0,H*.42,W,H*.58);
      webglScene.render();return;
    }
    const sky=ctx.createLinearGradient(0,0,0,H*.76);
    sky.addColorStop(0,'#acdded');sky.addColorStop(.55,'#dff5f1');sky.addColorStop(1,'#eff4cb');
    ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    // Light and horizon frame.
    ctx.fillStyle='#fff4bfbb';ctx.beginPath();ctx.arc(W*.66,H*.14,Math.min(60,H*.07),0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#b8ddbb';ctx.fillRect(0,H*.42,W,H*.58);
    // Ground is ONE continuous raster rather than hundreds of overlapping
    // road planes. Depth-sorted tiles are joined without z-fighting.
    const g=[];
    const original=faces;faces=g;
    drawContinuousGroundFallback();
    g.sort((a,b)=>b.depth-a.depth);
    for(const f of g)drawFace(f);
    faces=original;
    solids.forEach(renderFace);
    drawBillboards();addCar();
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
    // Enclosing buildings make the outermost four roads a true closed loop.
    c.strokeStyle='#7b9c96';c.lineWidth=9;
    c.strokeRect(...project(-752,752),231,183);
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
    const nx=c.x+Math.sin(c.yaw)*c.speed*dt;
    const nz=c.z+Math.cos(c.yaw)*c.speed*dt;
    // The collision footprint follows actual 3D building positions, rather
    // than blocking invisible squares. All edge buildings are impassable.
    // OBB versus AABB collision: respect the car's actual length when nose-on
    // to a wall, and its width when sliding sideways, including while turning.
    const rx=Math.cos(c.yaw),rz=-Math.sin(c.yaw),fx=Math.sin(c.yaw),fz=Math.cos(c.yaw);
    const hw=9.2,hl=17.7;
    const carExtentX=Math.abs(rx)*hw+Math.abs(fx)*hl;
    const carExtentZ=Math.abs(rz)*hw+Math.abs(fz)*hl;
    const hits=(b)=>{
      const hx=(b.maxX-b.minX)/2+1,hz=(b.maxZ-b.minZ)/2+1;
      const tx=nx-(b.minX+b.maxX)/2,tz=nz-(b.minZ+b.maxZ)/2;
      if(Math.abs(tx)>hx+carExtentX||Math.abs(tz)>hz+carExtentZ)return false;
      if(Math.abs(tx*rx+tz*rz)>hw+hx*Math.abs(rx)+hz*Math.abs(rz))return false;
      if(Math.abs(tx*fx+tz*fz)>hl+hx*Math.abs(fx)+hz*Math.abs(fz))return false;
      return true;
    };
    const solid=Math.abs(nx)>WORLD_LIMIT-carExtentX||Math.abs(nz)>WORLD_LIMIT-carExtentZ||
      buildingFootprints.some(hits)||fixedPropFootprints.some(hits);
    if(solid){c.speed*=-.20;}else{c.x=nx;c.z=nz;}
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
  $('cityReset').addEventListener('click',()=>{state.car={x:-200,z:-380,yaw:0,speed:0};state.parking=0;state.ridden=false;});
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
  window.__cityDebug=()=>({car:{...state.car},target:cityZones[state.target].name,nearest:state.nearest?.title||null,discovered:state.discovered.size,active:state.active,detail:state.detail?.title||null,buildingCount:buildingFootprints.length,closedBoundary:WORLD_LIMIT,staticBillboards:billboardTextures.size,staticFourWaySigns:directionBoards.length,renderer:webglScene?.type||'Canvas2D fallback',ground:webglScene?.ground||'continuous ground texture (Canvas2D)'});
})();
