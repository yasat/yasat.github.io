/* RC Grand Prix: projection-based compatibility renderer.
   The driving physics, cameras and resume content remain shared with the WebGL game.
   This renderer provides an immediately visible racing circuit if a browser/GPU
   renders Three.js' sky colour but fails to draw its meshes. */
const PI2=Math.PI*2;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const TRACK_WIDTH=20, PIT_WIDTH=10;
const take=(p,a)=>[p.x,p.y||0,p.z,a];
const tint=['#d7ec9d','#edae79','#bbabeb','#e6c16f','#82cad6','#dc9a93','#a4ce99','#e7c2ac','#a5c7e8','#cfc4a3','#c7e398'];

export class CompatibilityTrackRenderer {
  constructor(canvas,trackPoints,trackTangents){
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});
    this.track=trackPoints;this.tangents=trackTangents;
    this.trees=[];this.frame=0;this.segments=[];this.width=0;this.height=0;
    this.setPits([]);this.makeTrackSegments();
  }
  setTrees(trees){this.trees=trees||[];}
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
    const m=camera.matrixWorldInverse.elements, f=1/Math.tan(camera.fov*Math.PI/360);
    const aspect=camera.aspect||this.width/this.height;
    this.project=(x,y,z)=>{
      const vx=m[0]*x+m[4]*y+m[8]*z+m[12];
      const vy=m[1]*x+m[5]*y+m[9]*z+m[13];
      const vz=m[2]*x+m[6]*y+m[10]*z+m[14];
      const depth=-vz;
      if(depth<.5||depth>3300)return null;
      const nx=vx*f/(depth*aspect),ny=vy*f/depth;
      // Bound very-near vertices so drawing them cannot overflow canvas rasterisation.
      return {x:clamp((nx*.5+.5)*this.width,-this.width*6,this.width*7),
        y:clamp((.5-ny*.5)*this.height,-this.height*6,this.height*7),depth};
    };
  }
  poly(points,color,stroke=null){
    const p=points.map(v=>this.project(v[0],v[1],v[2]));
    if(p.some(v=>!v))return false;
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
      this.quad(seg,-PIT_WIDTH-4,PIT_WIDTH+4,-.05,'#6b8b75');
      this.quad(seg,-PIT_WIDTH,PIT_WIDTH,.13,'#4a5050');
      this.quad(seg,-PIT_WIDTH,-PIT_WIDTH+1.1,.19,'#eed79e');
      this.quad(seg,PIT_WIDTH-1.1,PIT_WIDTH,.19,'#eed79e');
      if(seg.index%8===0)this.quad(seg,-.13,.13,.21,'#b9cdb5');
    }else{
      this.quad(seg,-27,27,-.12,'#819784');
      this.quad(seg,-TRACK_WIDTH,TRACK_WIDTH,.1,'#333e3e');
      this.quad(seg,-TRACK_WIDTH-3,-TRACK_WIDTH,.14,seg.index%24<12?'#e9ede3':'#b9574a');
      this.quad(seg,TRACK_WIDTH,TRACK_WIDTH+3,.14,seg.index%24<12?'#e9ede3':'#b9574a');
      this.quad(seg,-TRACK_WIDTH+1,-TRACK_WIDTH+1.6,.17,'#d5dccf');
      this.quad(seg,TRACK_WIDTH-1.6,TRACK_WIDTH-1,.17,'#d5dccf');
      if(seg.index%30<3)this.quad(seg,-.23,.23,.19,'#d8dcd0');
    }
  }
  drawSky(camera){
    const c=this.ctx,W=this.width,H=this.height;
    c.fillStyle='#9dc8c4';c.fillRect(0,0,W,H);
    let h=H*(.47+clamp((camera.position.y-30)/1000,-.13,.3));
    if(camera.position.y>130)h=H*.05;
    const sky=c.createLinearGradient(0,0,0,H);
    sky.addColorStop(0,'#7ca7b8');sky.addColorStop(clamp(h/H,.05,.95),'#bcd6c0');sky.addColorStop(1,'#91b18a');
    c.fillStyle=sky;c.fillRect(0,0,W,H);
    const grass=c.createLinearGradient(0,h,0,H);grass.addColorStop(0,'#9aa994');grass.addColorStop(1,'#6c9b69');
    c.fillStyle=grass;c.fillRect(0,h,W,H-h);
    // Faint rolling-hill silhouette; terrain remains visibly present even if shaders fail.
    if(camera.position.y<170){c.fillStyle='rgba(64,115,91,.18)';c.beginPath();c.moveTo(0,h+10);
      for(let i=0;i<=W;i+=20)c.lineTo(i,h+12+17*Math.sin(i/139)+9*Math.sin(i/57));
      c.lineTo(W,h+65);c.lineTo(0,h+65);c.fill();}
  }
  drawTrees(player){
    const near=[];
    for(const tree of this.trees){
      const d=Math.hypot(tree.x-player.x,tree.z-player.z);
      if(d>800)continue;
      near.push({tree,d});
    }
    near.sort((a,b)=>b.d-a.d);
    for(const {tree,d} of near){
      const {x,z,scale}=tree,h=32*scale,r=9*scale;
      const base=this.project(x,0,z),top=this.project(x,h,z);
      if(!base||!top||base.x<-180||base.x>this.width+180||base.y<-200||top.y>this.height+100)continue;
      if(d>550)this.ctx.globalAlpha=.55;
      this.poly([[x-r*.15,0,z],[x-r*.15,8*scale,z],[x+r*.15,8*scale,z],[x+r*.15,0,z]],'#6e5440');
      this.poly([[x-r,8*scale,z],[x,26*scale,z],[x+r,8*scale,z]],'#235e46');
      this.poly([[x-r*.78,18*scale,z],[x,37*scale,z],[x+r*.78,18*scale,z]],'#2c7653');
      this.ctx.globalAlpha=1;
    }
  }
  drawGrandstands(){
    for(const u of [.09,.23,.48,.73,.91]){
      const i=Math.round(u*(this.track.length-1)),p=this.track[i],t=this.tangents[i];
      const n={x:t.z,z:-t.x},side=p.x*n.x+p.z*n.z>=0?1:-1;
      const x=p.x+side*n.x*65,z=p.z+side*n.z*65;
      const L=57;
      this.poly([[x-t.x*L,0,z-t.z*L],[x+t.x*L,0,z+t.z*L],[x+t.x*L,8,z+t.z*L],[x-t.x*L,8,z-t.z*L]],'#52665a');
      for(let k=0;k<5;k++){
        let y=7+k*2;
        this.poly([[x-t.x*L,y,z-t.z*L],[x+t.x*L,y,z+t.z*L],[x+t.x*L,y+1.3,z+t.z*L],[x-t.x*L,y+1.3,z-t.z*L]],k%2?'#d8ddc7':'#789788');
      }
      this.poly([[x-t.x*(L+3),21,z-t.z*(L+3)],[x+t.x*(L+3),21,z+t.z*(L+3)],
        [x+t.x*(L+3),23,z+t.z*(L+3)],[x-t.x*(L+3),23,z-t.z*(L+3)]],'#e7e8d6');
    }
  }
  drawStations(player,inspector){
    const ctx=this.ctx;
    const entries=[];
    for(const pit of this.pits){
      const mid=pit.points[Math.floor(pit.points.length/2)];
      const d=Math.hypot(mid.x-player.x,mid.z-player.z);
      if(d<700)entries.push({pit,d});
    }
    entries.sort((a,b)=>b.d-a.d);
    for(const {pit} of entries){
      const c=pit.points[40],a=pit.points[37],b=pit.points[43],n=this.normal(a,b);
      const x=c.x+n.x*23,z=c.z+n.z*23;
      this.poly([[x-12,0,z-8],[x+12,0,z-8],[x+12,15,z-8],[x-12,15,z-8]],'#385d55');
      this.poly([[x-14,15,z-9],[x+14,15,z-9],[x+14,17,z-9],[x-14,17,z-9]],'#e9f0cd');
      const q=this.project(x,12,z-9);
      if(q&&q.depth<270&&q.x>0&&q.x<this.width){ctx.textAlign='center';ctx.fillStyle='#e1f4a9';ctx.font=`900 ${clamp(260/q.depth,8,20)}px sans-serif`;ctx.fillText('PIT '+String(pit.index+1).padStart(2,'0'),q.x,q.y);}
      // Actual content posters are painted onto sign surfaces, not presented as modal dialogs.
      const boards=(pit.boards||[]).filter(board=>Math.hypot(board.worldPos.x-player.x,board.worldPos.z-player.z)<390);
      boards.sort((a,b)=>Math.hypot(b.worldPos.x-player.x,b.worldPos.z-player.z)-Math.hypot(a.worldPos.x-player.x,a.worldPos.z-player.z));
      for(const board of boards)this.drawBoard(board,inspector?.board===board);
    }
  }
  drawBoard(board,active){
    const ctx=this.ctx,p=board.group.position,heading=board.group.rotation.y;
    const side={x:Math.cos(heading),z:-Math.sin(heading)};
    const bottomLeft=this.project(p.x-side.x*15.25,2,p.z-side.z*15.25);
    const bottomRight=this.project(p.x+side.x*15.25,2,p.z+side.z*15.25);
    const topLeft=this.project(p.x-side.x*15.25,38.2,p.z-side.z*15.25);
    if(!bottomLeft||!bottomRight||!topLeft)return;
    const mid=this.project(p.x,21,p.z);
    if(!mid||(!active&&(mid.x< -250||mid.x>this.width+250||mid.y< -300||mid.y>this.height+300)))return;
    const cross=(bottomRight.x-bottomLeft.x)*(topLeft.y-bottomLeft.y)-(bottomRight.y-bottomLeft.y)*(topLeft.x-bottomLeft.x);
    if(Math.abs(cross)<40)return;
    ctx.save();
    // Texture is drawn to the actual projected in-world billboard quadrilateral.
    ctx.setTransform((bottomRight.x-bottomLeft.x)/1400,(bottomRight.y-bottomLeft.y)/1400,
      (bottomLeft.x-topLeft.x)/1872,(bottomLeft.y-topLeft.y)/1872,topLeft.x,topLeft.y);
    ctx.fillStyle='#153e3c';ctx.fillRect(-48,-48,1496,1968);
    ctx.fillStyle='#d9f29e';ctx.fillRect(-48,-48,1496,32);
    const img=board.texture?.image;
    if(img&&img.width&&img.height)ctx.drawImage(img,0,0,1400,1872);
    else{
      ctx.fillStyle='#f4f3e5';ctx.fillRect(0,0,1400,1872);
      ctx.fillStyle='#173f3b';ctx.fillRect(0,0,1400,190);
      ctx.fillStyle='#e2f7a3';ctx.font='900 80px Arial';ctx.fillText('SG. / '+board.section.name.toUpperCase().slice(0,19),55,122,1290);
      ctx.fillStyle='#123c38';ctx.font='900 85px Arial';
      const words=board.item.title.split(' ');let line='',y=305;
      for(const word of words){if((line+' '+word).length>27){ctx.fillText(line,55,y,1300);y+=103;line=word;}else line+=(line?' ':'')+word;}
      if(line)ctx.fillText(line,55,y,1300);
      ctx.font='500 51px Arial';ctx.fillText('Drive closer to read all details',55,1500,1280);
    }
    ctx.restore();
  }
  transformCar(x,y,z,heading,dx,dy,dz){
    return [x+dx*Math.cos(heading)+dz*Math.sin(heading),y+dy,z-dx*Math.sin(heading)+dz*Math.cos(heading)];
  }
  drawCar(x,z,heading,colour='#d7f36b',ghost=false){
    const t=(dx,dy,dz)=>this.transformCar(x,0,z,heading,dx,dy,dz);
    if(ghost)this.ctx.globalAlpha=.87;
    const shadow=[t(-4.8,.35,-8),t(4.8,.35,-8),t(4.8,.35,8),t(-4.8,.35,8)];
    this.poly(shadow,'rgba(3,25,24,.3)');
    for(const side of [-1,1])for(const zPos of [-5,5]){
      this.poly([t(side*3,1,zPos-2.5),t(side*5.8,1,zPos-2.5),t(side*5.8,4.7,zPos+2.5),t(side*3,4.7,zPos+2.5)],'#111e24');
      this.poly([t(side*5.8,2,zPos-1.5),t(side*5.8,2,zPos+1.5),t(side*5.8,3.5,zPos+1.5),t(side*5.8,3.5,zPos-1.5)],'#b6c8c0');
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
    this.startProjection(camera);
    const ctx=this.ctx;
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;
    this.drawSky(camera);
    // Draw distant scenery, then road surfaces from back to front.
    this.drawTrees(player);
    const all=[...this.segments,...this.pitSegments];
    all.sort((l,r)=>{
      const dl=Math.hypot((l.a.x+l.b.x)*.5-camera.position.x,(l.a.z+l.b.z)*.5-camera.position.z);
      const dr=Math.hypot((r.a.x+r.b.x)*.5-camera.position.x,(r.a.z+r.b.z)*.5-camera.position.z);
      return dr-dl;
    });
    for(const seg of all)this.drawSegment(seg);
    if(mode==='arcade')this.drawArcadePads();
    this.drawGrandstands();
    this.drawStations(player,inspector);
    this.drawGantry();
    for(const o of opponents.values())this.drawCar(o.x,o.z,o.heading,o.hex||'#ffb37d',true);
    if(!inspector)this.drawCar(player.x,player.z,player.heading,'#d7f36b');
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
