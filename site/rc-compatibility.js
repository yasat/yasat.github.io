/* RC Grand Prix: projection-based compatibility renderer.
   The driving physics, cameras and resume content remain shared with the WebGL game.
   This renderer provides an immediately visible racing circuit if a browser/GPU
   renders Three.js' sky colour but fails to draw its meshes. */
const PI2=Math.PI*2;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const TRACK_WIDTH=23, PIT_WIDTH=12;
const STAND_POINTS=[.035,.13,.215,.305,.405,.51,.605,.70,.805,.91];
const take=(p,a)=>[p.x,p.y||0,p.z,a];
const tint=['#d7ec9d','#edae79','#bbabeb','#e6c16f','#82cad6','#dc9a93','#a4ce99','#e7c2ac','#a5c7e8','#cfc4a3','#c7e398'];

export class CompatibilityTrackRenderer {
  constructor(canvas,trackPoints,trackTangents){
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});
    this.track=trackPoints;this.tangents=trackTangents;
    this.trees=[];this.grandstands=[];this.frame=0;this.segments=[];this.width=0;this.height=0;this.lastCamera=null;
    this.setPits([]);this.makeTrackSegments();
  }
  setTrees(trees){this.trees=trees||[];}
  setGrandstands(stands){this.grandstands=stands||[];}
  setPits(pits){
    this.pits=pits||[];
    this.pitSegments=[];
    for(const pit of this.pits){
      for(let i=0;i<pit.points.length-2;i+=2){
        const a=pit.points[i],b=pit.points[Math.min(pit.points.length-1,i+2)];
        const a0=pit.points[Math.max(0,i-1)],a1=pit.points[Math.min(pit.points.length-1,i+1)];
        const b0=pit.points[Math.max(0,i+1)],b1=pit.points[Math.min(pit.points.length-1,i+3)];
        this.pitSegments.push({a,b,na:this.normal(a0,a1),nb:this.normal(b0,b1),lane:true,index:i,pit});
      }
    }
  }
  normal(a,b){const dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz)||1;return {x:dz/l,z:-dx/l};}
  makeTrackSegments(){
    this.segments=[];
    for(let i=0;i<this.track.length-3;i+=3){
      const a=this.track[i],b=this.track[Math.min(this.track.length-1,i+3)];
      const ta=this.tangents[i],tb=this.tangents[Math.min(this.track.length-1,i+3)];
      this.segments.push({a,b,na:{x:ta.z,z:-ta.x},nb:{x:tb.z,z:-tb.x},lane:false,index:i});
    }
  }
  size(){
    const rect=this.canvas.getBoundingClientRect();
    const w=Math.max(1,Math.floor(rect.width)),h=Math.max(1,Math.floor(rect.height));
    if(w!==this.width||h!==this.height){this.width=w;this.height=h;this.canvas.width=w;this.canvas.height=h;}
  }
  startProjection(camera){
    camera.updateMatrixWorld(true);
    this.projMatrix=camera.matrixWorldInverse.elements;
    this.focal=1/Math.tan(camera.fov*Math.PI/360);
    this.projAspect=camera.aspect||this.width/this.height;
    this.toEye=(x,y,z)=>{
      const m=this.projMatrix;
      return {x:m[0]*x+m[4]*y+m[8]*z+m[12],
        y:m[1]*x+m[5]*y+m[9]*z+m[13],
        z:-(m[2]*x+m[6]*y+m[10]*z+m[14])};
    };
    this.projectEye=(p)=>({x:clamp(((p.x*this.focal/(p.z*this.projAspect))*.5+.5)*this.width,-this.width*5,this.width*6),
      y:clamp((.5-p.y*this.focal/(2*p.z))*this.height,-this.height*5,this.height*6),depth:p.z});
    this.project=(x,y,z)=>{
      const p=this.toEye(x,y,z);
      if(p.z<.8||p.z>3800)return null;
      return this.projectEye(p);
    };
  }
  poly(points,color,stroke=null){
    const near=1.25;
    let polygon=points.map(p=>this.toEye(p[0],p[1],p[2]));
    // Clip facets rather than discarding any road polygon crossing the camera.
    const clipped=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],aIn=a.z>=near,bIn=b.z>=near;
      if(aIn)clipped.push(a);
      if(aIn!==bIn){const t=(near-a.z)/(b.z-a.z);
        clipped.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:near});}
    }
    if(clipped.length<3)return false;
    const p=clipped.map(v=>this.projectEye(v));
    if(p.every(v=>v.x<0)||p.every(v=>v.x>this.width)||p.every(v=>v.y<0)||p.every(v=>v.y>this.height))return false;
    const ctx=this.ctx;
    ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);
    for(let i=1;i<p.length;i++)ctx.lineTo(p[i].x,p[i].y);
    ctx.closePath();ctx.fillStyle=color;ctx.fill();
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}
    return true;
  }
  point(x,y,z,color,r=3){
    const p=this.project(x,y,z);if(!p||p.x<0||p.x>this.width||p.y<0||p.y>this.height)return;
    this.ctx.fillStyle=color;this.ctx.beginPath();this.ctx.arc(p.x,p.y,clamp(r*80/p.depth,.7,r*3),0,PI2);this.ctx.fill();
  }
  quad(seg,min,max,y,col){
    const a=seg.a,b=seg.b,na=seg.na,nb=seg.nb;
    return this.poly([[a.x+na.x*min,y,a.z+na.z*min],[a.x+na.x*max,y,a.z+na.z*max],
      [b.x+nb.x*max,y,b.z+nb.z*max],[b.x+nb.x*min,y,b.z+nb.z*min]],col);
  }
  drawSegment(seg){
    if(seg.lane){
      this.quad(seg,-PIT_WIDTH-4,PIT_WIDTH+4,-.05,'#718977');
      this.quad(seg,-PIT_WIDTH,PIT_WIDTH,.13,'#3b4849');
      this.quad(seg,-PIT_WIDTH,-PIT_WIDTH+1.1,.19,'#eed79e');
      this.quad(seg,PIT_WIDTH-1.1,PIT_WIDTH,.19,'#eed79e');
      if(seg.index%8===0)this.quad(seg,-.13,.13,.21,'#b9cdb5');
    }else{
      this.quad(seg,-41,41,-.18,'#607d75');
      this.quad(seg,-34,34,-.12,'#8fa29a');
      this.quad(seg,-TRACK_WIDTH,TRACK_WIDTH,.1,'#263238');
      this.quad(seg,-TRACK_WIDTH-3,-TRACK_WIDTH,.14,seg.index%24<12?'#f7f3df':'#cf5146');
      this.quad(seg,TRACK_WIDTH,TRACK_WIDTH+3,.14,seg.index%24<12?'#f7f3df':'#cf5146');
      this.quad(seg,-TRACK_WIDTH+1,-TRACK_WIDTH+1.6,.17,'#d5dccf');
      this.quad(seg,TRACK_WIDTH-1.6,TRACK_WIDTH-1,.17,'#d5dccf');
      if(seg.index%30<3)this.quad(seg,-.23,.23,.19,'#d8dcd0');
    }
  }
  drawSky(camera){
    const c=this.ctx,W=this.width,H=this.height;
    c.fillStyle='#9dc8c4';c.fillRect(0,0,W,H);
    const v=this.projMatrix;
    const horizon=this.project(camera.position.x-v[2]*1800,camera.position.y,camera.position.z-v[10]*1800);
    let h=horizon?clamp(horizon.y,0,H*.72):H*.26;
    if(camera.position.y>160)h=0;
    const sky=c.createLinearGradient(0,0,0,H);
    sky.addColorStop(0,'#7ca7b8');sky.addColorStop(clamp(h/H,.05,.95),'#bcd6c0');sky.addColorStop(1,'#91b18a');
    c.fillStyle=sky;c.fillRect(0,0,W,H);
    // Sun and a handful of slow-moving cloud layers add depth without external assets.
    if(h>35){
      c.fillStyle='rgba(250,241,194,.35)';c.beginPath();c.arc(W*.77,h*.36,32,0,PI2);c.fill();
      c.fillStyle='rgba(243,250,241,.20)';
      for(const [u,v,wid] of [[.11,.32,145],[.48,.22,110],[.68,.52,175]]){
        const x=W*u,y=h*v;c.beginPath();c.ellipse(x,y,wid*.6,11,0,0,PI2);c.ellipse(x+wid*.2,y-5,wid*.38,15,0,0,PI2);c.fill();
      }
    }
    const grass=c.createLinearGradient(0,h,0,H);grass.addColorStop(0,'#819e91');grass.addColorStop(1,'#617c6d');
    c.fillStyle=grass;c.fillRect(0,h,W,H-h);
    // Faint rolling-hill silhouette; terrain remains visibly present even if shaders fail.
    if(camera.position.y<170){c.fillStyle='rgba(64,115,91,.18)';c.beginPath();c.moveTo(0,h+10);
      for(let i=0;i<=W;i+=20)c.lineTo(i,h+12+17*Math.sin(i/139)+9*Math.sin(i/57));
      c.lineTo(W,h+65);c.lineTo(0,h+65);c.fill();}
  }
  drawTrees(player){
    const ctx=this.ctx;const near=[];
    for(const tree of this.trees){
      const d=Math.hypot(tree.x-player.x,tree.z-player.z);
      if(d>640)continue;
      near.push({tree,d});
    }
    near.sort((a,b)=>b.d-a.d);
    for(const {tree,d} of near.slice(0,65)){
      const {x,z,scale}=tree;
      const leaf1=tree.kind==='cedar'?'#315a4a':'#437960',leaf2=tree.kind==='cedar'?'#416e55':'#5a9874';
      // Solid trunks, three volumetric leaf clusters and specular light facets.
      const h=28*scale;
      this.poly([[x-1.2*scale,.2,z],[x+1.2*scale,.2,z],[x+1.2*scale,h*.71,z],[x-1.2*scale,h*.71,z]],'#735849');
      const sphere=(cx,cy,cz,rx,ry,color)=>{
        const facets=8;const rings=3;
        for(let ring=0;ring<rings;ring++){
          const a=-Math.PI/2+ring*Math.PI/rings,b=-Math.PI/2+(ring+1)*Math.PI/rings;
          for(let j=0;j<facets;j++){
            const u=j*PI2/facets,v=(j+1)*PI2/facets;
            const p=(e,t)=>[cx+rx*Math.cos(e)*Math.cos(t),cy+ry*Math.sin(e),cz+rx*.85*Math.cos(e)*Math.sin(t)];
            this.poly([p(a,u),p(a,v),p(b,v),p(b,u)],j%4===0?leaf2:color);
          }
        }
      };
      sphere(x-4.3*scale,h*.72,z,7.5*scale,8.4*scale,leaf1);
      sphere(x+5.5*scale,h*.74,z,8*scale,9*scale,leaf1);
      sphere(x,h*.94,z,9*scale,10.2*scale,leaf2);
      const highlight=this.project(x-3*scale,h*1.16,z-3*scale);
      if(highlight&&highlight.depth<260){ctx.fillStyle='rgba(181,222,168,.15)';ctx.beginPath();ctx.arc(highlight.x,highlight.y,Math.max(1,30*scale/highlight.depth),0,PI2);ctx.fill();}
    }
  }
  drawStadiumPerimeter(){
    const max=96,panels=[];
    for(let i=0;i<max;i++){
      const a=i/max*PI2,b=(i+1)/max*PI2,m=(a+b)*.5;
      const x=1520*Math.cos(a),z=1170*Math.sin(a),xx=1520*Math.cos(b),zz=1170*Math.sin(b);
      const dist=Math.hypot(x-this.cameraX,z-this.cameraZ);
      if(dist>1900)continue;
      panels.push({x,z,xx,zz,m,dist});
    }
    panels.sort((a,b)=>b.dist-a.dist);
    for(const p of panels){
      this.poly([[p.x,0,p.z],[p.xx,0,p.zz],[p.xx,20,p.zz],[p.x,20,p.z]],'#294c50');
      this.poly([[p.x,20,p.z],[p.xx,20,p.zz],[p.xx,21.6,p.zz],[p.x,21.6,p.z]],'#bad7c6');
      if((p.m*96/PI2|0)%4===0){
        this.poly([[p.x-1,0,p.z-1],[p.x+1,0,p.z+1],[p.x+1,39,p.z+1],[p.x-1,39,p.z-1]],'#a6c6bf');
        this.point(p.x,39,p.z,'#f3eece',3.5);
      }
    }
  }
  drawGrandstands(){
    const stands=[];
    for(const stand of this.grandstands){
      const {x,z,side,u}=stand;
      const i=Math.round(u*(this.track.length-1)),t=this.tangents[i];
      const n={x:t.z,z:-t.x};
      const d=Math.hypot(x-this.cameraX,z-this.cameraZ);
      if(d<900)stands.push({x,z,t,n,side,d});
    }
    stands.sort((a,b)=>b.d-a.d);
    for(const {x,z,t,n,side,d} of stands){
      const back={x:n.x*side,z:n.z*side};
      const v=(sideX,y,depth)=>[x+t.x*sideX+back.x*depth,y,z+t.z*sideX+back.z*depth];
      const L=88;
      this.poly([v(-L,0,-44),v(L,0,-44),v(L,9,44),v(-L,9,44)],'#394e53');
      this.poly([v(-L,7,-44),v(L,7,-44),v(L,37,37),v(-L,37,37)],'#59736f');
      for(let row=0;row<11;row++){
        const h=7+row*2.45,depth=-37+row*6.5;
        this.poly([v(-L,h,depth),v(L,h,depth),v(L,h+1.65,depth+3),v(-L,h+1.65,depth+3)],row%2?'#79928e':'#91aaa2');
        if(d<510)for(let k=0;k<23;k++){
          const x1=-L+5+k*7.5;
          const c=['#e1e6b4','#a1dec0','#ecba86','#8fc3cf','#d7a3a7'][(k*2+row)%5];
          const q=this.project(...v(x1,h+2.8,depth));
          if(q&&q.depth<500&&q.x>0&&q.x<this.width&&q.y>0&&q.y<this.height){this.ctx.fillStyle=c;this.ctx.fillRect(q.x-1,q.y-1,Math.max(1.2,300/q.depth),Math.max(1.2,300/q.depth));}
        }
      }
      this.poly([v(-L-7,42,-53),v(L+7,42,-53),v(L+7,43,58),v(-L-7,43,58)],'#e8eee3');
      this.poly([v(-L-7,40,-53),v(L+7,40,-53),v(L+7,42,-53),v(-L-7,42,-53)],'#b8df8b');
      for(const k of [-75,-37,0,37,75]){
        this.poly([v(k,0,50),v(k+1.4,0,50),v(k+1.4,42,50),v(k,42,50)],'#526e71');
      }
      const sign=this.project(...v(0,43,-52));
      if(sign&&sign.depth<430&&sign.x>0&&sign.x<this.width){
        const ctx=this.ctx;ctx.save();ctx.textAlign='center';ctx.font=`900 ${clamp(680/sign.depth,8,18)}px Arial`;ctx.fillStyle='#294548';ctx.fillText('GHANTA GRAND PRIX',sign.x,sign.y);ctx.restore();
      }
    }
  }
  drawTrackBarriers(player){
    const visible=[];
    for(let i=0;i<this.track.length-1;i+=9){
      const p=this.track[i],q=this.track[Math.min(i+9,this.track.length-1)],t=this.tangents[i];
      const d=Math.hypot(p.x-player.x,p.z-player.z);
      if(d>430)continue;
      visible.push({p,q,t,i,d});
    }
    visible.sort((a,b)=>b.d-a.d);
    for(const {p,q,t,i} of visible){
      const n={x:t.z,z:-t.x};
      for(const side of [-1,1]){
        const xa=p.x+side*n.x*33,za=p.z+side*n.z*33;
        const nq=this.tangents[Math.min(i+9,this.track.length-1)];
        const xb=q.x+side*nq.z*33,zb=q.z-side*nq.x*33;
        let cleared=false;
        for(const pit of this.pits){
          for(let k=0;k<pit.points.length;k+=12){
            if(Math.hypot(xa-pit.points[k].x,za-pit.points[k].z)<24){cleared=true;break;}
          }
          if(cleared)break;
        }
        if(cleared)continue;
        for(const h of [2.5,4.5]){
          this.poly([[xa,h-.5,za],[xb,h-.5,zb],[xb,h+.5,zb],[xa,h+.5,za]],'#c8d7d4');
        }
        this.poly([[xa-.8,0,za-.8],[xa+.8,0,za+.8],[xa+.8,5.5,za+.8],[xa-.8,5.5,za-.8]],'#476164');
      }
    }
  }
  drawPitWayfinding(player){
    for(const pit of this.pits){
      const a=pit.points[9],b=pit.points[12],t={x:b.x-a.x,z:b.z-a.z};
      const len=Math.hypot(t.x,t.z)||1;t.x/=len;t.z/=len;
      const n={x:t.z,z:-t.x};
      if(Math.hypot(a.x-player.x,a.z-player.z)>290)continue;
      const w=14;
      for(const side of [-1,1]){
        const x=a.x+side*n.x*w,z=a.z+side*n.z*w;
        this.poly([[x-.8,0,z-.8],[x+.8,0,z+.8],[x+.8,14,z+.8],[x-.8,14,z-.8]],'#54716c');
      }
      this.poly([[a.x-n.x*w,11.2,a.z-n.z*w],[a.x+n.x*w,11.2,a.z+n.z*w],
        [a.x+n.x*w,15,a.z+n.z*w],[a.x-n.x*w,15,a.z-n.z*w]],'#d7ef84');
      const sign=this.project(a.x,13,a.z);
      if(sign&&sign.depth<320&&sign.x>0&&sign.x<this.width){
        this.ctx.save();this.ctx.textAlign='center';this.ctx.font=`900 ${clamp(600/sign.depth,10,24)}px Arial`;
        this.ctx.fillStyle='#163a3b';this.ctx.fillText('PIT '+String(pit.index+1).padStart(2,'0')+'  /  REFUEL',sign.x,sign.y);this.ctx.restore();
      }
    }
  }
  drawStations(player,inspector){
    const ctx=this.ctx;
    const entries=[];
    for(const pit of this.pits){
      const mid=pit.points[Math.floor(pit.points.length/2)];
      const d=Math.hypot(mid.x-player.x,mid.z-player.z);
      if(d<450)entries.push({pit,d});
    }
    entries.sort((a,b)=>b.d-a.d);
    for(const {pit} of entries){
      const c=pit.points[40],a=pit.points[37],b=pit.points[43],n=this.normal(a,b);
      const outer=pit.n||n;const x=c.x+outer.x*138,z=c.z+outer.z*138;
      this.poly([[x-12,0,z-8],[x+12,0,z-8],[x+12,15,z-8],[x-12,15,z-8]],'#385d55');
      this.poly([[x-14,15,z-9],[x+14,15,z-9],[x+14,17,z-9],[x-14,17,z-9]],'#e9f0cd');
      const q=this.project(x,12,z-9);
      if(q&&q.depth<270&&q.x>0&&q.x<this.width){ctx.textAlign='center';ctx.fillStyle='#e1f4a9';ctx.font=`900 ${clamp(260/q.depth,8,20)}px sans-serif`;ctx.fillText('PIT '+String(pit.index+1).padStart(2,'0'),q.x,q.y);}
      // Actual content posters are painted onto sign surfaces, not presented as modal dialogs.
      const boards=(pit.boards||[]).filter(board=>{
        const d=Math.hypot(board.worldPos.x-player.x,board.worldPos.z-player.z);
        if(d>150||!player.inPit)return false;
        // A touring billboard is visible from its service lane, not across
        // the main race track where it would fill the windscreen.
        const toEyeX=this.cameraX-board.worldPos.x,toEyeZ=this.cameraZ-board.worldPos.z;
        return board.towards.x*toEyeX+board.towards.z*toEyeZ>4;
      });
      boards.sort((a,b)=>Math.hypot(b.worldPos.x-player.x,b.worldPos.z-player.z)-Math.hypot(a.worldPos.x-player.x,a.worldPos.z-player.z));
      for(const board of boards)this.drawBoard(board,inspector?.board===board);
    }
  }
  drawBoard(board,active){
    const ctx=this.ctx,p=board.group.position,heading=board.group.rotation.y;
    const side={x:Math.cos(heading),z:-Math.sin(heading)};
    const width=board.width||36,height=board.height||22,bottom=3;
    const tl=this.project(p.x-side.x*width/2,bottom+height,p.z-side.z*width/2);
    const tr=this.project(p.x+side.x*width/2,bottom+height,p.z+side.z*width/2);
    const bl=this.project(p.x-side.x*width/2,bottom,p.z-side.z*width/2);
    const br=this.project(p.x+side.x*width/2,bottom,p.z+side.z*width/2);
    if(!tl||!tr||!bl||!br)return;
    const cx=(tl.x+tr.x+bl.x+br.x)/4,cy=(tl.y+tr.y+bl.y+br.y)/4;
    if(!active&&(cx< -200||cx>this.width+200||cy< -200||cy>this.height+200))return;
    const bwidth=Math.hypot(tr.x-tl.x,tr.y-tl.y);
    const bheight=Math.hypot(bl.x-tl.x,bl.y-tl.y);
    if(bwidth<13||bheight<9)return;
    // The painting is on the physical board surface. Ignore it when seen from behind.
    // Supporting posts keep the exhibition grounded in the landscape.
    const pole=(offset)=>{
      const bx=p.x+side.x*offset,bz=p.z+side.z*offset;
      this.poly([[bx-.35,0,bz-.35],[bx+.35,0,bz+.35],[bx+.35,4,bz+.35],[bx-.35,4,bz-.35]],'#153c38');
    };
    pole(-width*.41);pole(width*.41);
    ctx.save();
    ctx.setTransform((tr.x-tl.x)/1536,(tr.y-tl.y)/1536,
      (bl.x-tl.x)/928,(bl.y-tl.y)/928,tl.x,tl.y);
    ctx.fillStyle='#163b38';ctx.fillRect(-18,-18,1572,964);
    ctx.fillStyle='#cde98a';ctx.fillRect(-18,-18,1572,19);
    const img=board.texture?.image;
    if(img?.width&&img?.height)ctx.drawImage(img,0,0,1536,928);
    else{
      ctx.fillStyle='#fffdf3';ctx.fillRect(0,0,1536,928);
      ctx.fillStyle='#153b38';ctx.fillRect(0,0,1536,101);
      ctx.fillStyle='#e2f5a6';ctx.font='bold 35px Arial';ctx.fillText('SG.   /   '+board.section.name.toUpperCase().slice(0,40),60,65,1400);
      ctx.fillStyle='#173b38';ctx.font='bold 54px Arial';
      const words=board.item.title.split(' ');let line='',y=180;
      for(const word of words){if((line+' '+word).length>39){ctx.fillText(line,60,y,1410);y+=70;line=word;}else line+=(line?' ':'')+word;}
      if(line)ctx.fillText(line,60,y,1410);
      ctx.font='500 33px Arial';ctx.fillText('Drive closer to read the complete entry',60,800,1400);
    }
    ctx.restore();
  }
  transformCar(x,y,z,heading,dx,dy,dz){
    return [x+dx*Math.cos(heading)-dz*Math.sin(heading),y+dy,z+dx*Math.sin(heading)+dz*Math.cos(heading)];
  }
  drawCar(x,z,heading,colour='#d7f36b',ghost=false,steering=0){
    const t=(dx,dy,dz)=>this.transformCar(x,0,z,heading,dx*.54,dy*.54,dz*.54);
    if(ghost)this.ctx.globalAlpha=.87;
    const shadow=[t(-4.8,.35,-8),t(4.8,.35,-8),t(4.8,.35,8),t(-4.8,.35,8)];
    this.poly(shadow,'rgba(3,25,24,.3)');
    for(const side of [-1,1])for(const zPos of [-5,5]){
      // The front wheel rectangles swivel around their kingpin.
      const wheelSteer=zPos<0?-steering:0;
      const wp=(dx,dy,dz)=>{
        const off=dx-side*4.5,along=dz-zPos;
        const cs=Math.cos(wheelSteer),sn=Math.sin(wheelSteer);
        return t(side*4.5+off*cs+along*sn,dy,zPos+along*cs-off*sn);
      };
      this.poly([wp(side*3,1,zPos-2.5),wp(side*5.8,1,zPos-2.5),wp(side*5.8,4.7,zPos+2.5),wp(side*3,4.7,zPos+2.5)],'#111e24');
      this.poly([wp(side*5.8,2,zPos-1.5),wp(side*5.8,2,zPos+1.5),wp(side*5.8,3.5,zPos+1.5),wp(side*5.8,3.5,zPos-1.5)],'#b6c8c0');
    }
    this.poly([t(-4.5,2.5,-7.6),t(4.5,2.5,-7.6),t(4.5,4.5,7.1),t(-4.5,4.5,7.1)],'#16262c');
    this.poly([t(-3.85,4.6,-6),t(3.85,4.6,-6),t(3.85,5.4,5.6),t(-3.85,5.4,5.6)],colour);
    this.poly([t(-3.4,5.5,-2.6),t(3.4,5.5,-2.6),t(3.2,6.6,2.1),t(-3.2,6.6,2.1)],'#20363f');
    this.poly([t(-4.9,3,-7.6),t(4.9,3,-7.6),t(4.9,3.9,-5.8),t(-4.9,3.9,-5.8)],'#171f26');
    this.poly([t(-5,7,6),t(5,7,6),t(5,8.2,7.1),t(-5,8.2,7.1)],colour);
    this.poly([t(2.2,5.8,5.1),t(2.3,5.8,5.1),t(2.3,18,5.1)],'#eae5bc');
    this.point(...t(2.3,18,5.1),'#ff7776',1.5);
    if(ghost)this.ctx.globalAlpha=1;
  }
  drawArcadePads(){
    for(const u of [.12,.36,.62,.86]){
      const i=Math.round(u*(this.track.length-1)),p=this.track[i],t=this.tangents[i];
      const n={x:t.z,z:-t.x};
      this.poly([[p.x-n.x*7-t.x*5,.23,p.z-n.z*7-t.z*5],
        [p.x+n.x*7-t.x*5,.23,p.z+n.z*7-t.z*5],
        [p.x+n.x*7+t.x*5,.23,p.z+n.z*7+t.z*5],
        [p.x-n.x*7+t.x*5,.23,p.z-n.z*7+t.z*5]],'#74daaa');
      const label=this.project(p.x,2,p.z);
      if(label&&label.depth<250){this.ctx.save();this.ctx.fillStyle='#dbffad';this.ctx.font='bold 15px sans-serif';this.ctx.textAlign='center';this.ctx.fillText('BOOST',label.x,label.y);this.ctx.restore();}
    }
  }
  drawGantry(){
    const p=this.track[0],n=this.normal(this.track[0],this.track[3]);
    for(const side of [-1,1]){
      const x=p.x+n.x*side*27,z=p.z+n.z*side*27;
      this.poly([[x-.9,0,z],[x+.9,0,z],[x+.9,24,z],[x-.9,24,z]],'#234941');
    }
    const side={x:n.x,z:n.z};
    this.poly([[p.x-side.x*27,20,p.z-side.z*27],[p.x+side.x*27,20,p.z+side.z*27],
      [p.x+side.x*27,24,p.z+side.z*27],[p.x-side.x*27,24,p.z-side.z*27]],'#153c38');
    const pt=this.project(p.x,22,p.z);if(pt&&pt.depth<450){const c=this.ctx;c.fillStyle='#def19d';c.font=`900 ${clamp(750/pt.depth,8,22)}px sans-serif`;c.textAlign='center';c.fillText('SG / RC GRAND PRIX',pt.x,pt.y);}
  }
  render({camera,player,opponents,inspector,mode}){
    this.size();if(!this.width||!this.height)return;
    this.startProjection(camera);this.cameraX=camera.position.x;this.cameraZ=camera.position.z;
    const ctx=this.ctx;
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;
    this.drawSky(camera);
    // Draw distant scenery, then road surfaces from back to front.
    this.drawStadiumPerimeter();
    this.drawTrees(player);
    const all=[...this.segments,...this.pitSegments];
    all.sort((l,r)=>{
      const dl=this.toEye((l.a.x+l.b.x)*.5,0,(l.a.z+l.b.z)*.5).z;
      const dr=this.toEye((r.a.x+r.b.x)*.5,0,(r.a.z+r.b.z)*.5).z;
      return dr-dl;
    });
    for(const seg of all)this.drawSegment(seg);
    if(mode==='arcade')this.drawArcadePads();
    this.drawTrackBarriers(player);
    this.drawGrandstands();
    this.drawPitWayfinding(player);
    this.drawStations(player,inspector);
    this.drawGantry();
    for(const o of opponents.values())this.drawCar(o.x,o.z,o.heading,o.hex||'#ffb37d',true);
    if(!inspector)this.drawCar(player.x,player.z,player.heading,'#d7f36b',false,player.steerAngle||0);
    if(mode==='arcade'){
      const ctx=this.ctx;ctx.save();ctx.fillStyle='rgba(10,26,27,.78)';ctx.fillRect(this.width/2-85,6,170,23);
      ctx.textAlign='center';ctx.font='900 11px Arial';ctx.fillStyle='#dff1a1';ctx.fillText('ARCADE  /  RACE VIEW',this.width/2,22);ctx.restore();
    }
    // A tiny visible UI label makes the compatibility state unambiguous.
    ctx.save();ctx.globalAlpha=.8;ctx.fillStyle='#0c2426';ctx.fillRect(14,this.height-75,162,23);
    ctx.fillStyle='#e0f3a1';ctx.font='700 10px Arial';ctx.fillText('COMPATIBILITY CAMERA',22,this.height-59);ctx.restore();
    this.frame++;
  }
}
