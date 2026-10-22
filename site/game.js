/* A small dependency-free driving game, suitable for GitHub Pages static hosting. */
(() => {
  'use strict';
  const zones = window.RESUME_ZONES;
  if (!Array.isArray(zones)) return;
  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const miniCanvas = document.getElementById('minimap');
  const miniCtx = miniCanvas.getContext('2d');
  if (!ctx) return;

  // All dimensions use one tabletop scale. The RC car is 40 x 70 units;
  // a smartphone is about 48 x 92, a pen 155 long and a laptop 550 wide.
  const ARENA = { x: 740, y: 580, w: 4000, h: 3350, rail: 42 };
  const WORLD = { width: 5500, height: 4550 };
  const car = { x: ARENA.x + 2010, y: ARENA.y + 1580, angle: -Math.PI / 2, speed: 0 };
  const camera = { x: 0, y: 0 };
  const keys = new Set();
  const picked = new Set();
  const particles = [];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.getElementById('districtNav');
  const mapPanel = document.getElementById('mapPanel');
  const mapToggle = document.getElementById('mapToggle');
  const discovery = document.getElementById('discoveryContent');
  const detailToggle = document.getElementById('detailToggle');
  const detailPanel = document.getElementById('discoveryPanel');
  const app = document.querySelector('.app-shell');
  app.inert = true;
  const intro = document.getElementById('introOverlay');
  const startButton = document.getElementById('startButton');
  const toast = document.getElementById('toast');
  const deskToggle = document.getElementById('deskViewToggle');
  let overview = false;
  let started = false, lastTime = 0, w = 1, h = 1, dpr = 1, currentZoneId = null, toastUntil = 0;

  for (const zone of zones) {
    zone.x += ARENA.x; zone.y += ARENA.y;
    zone.blocks = zone.items.map((item, index) => ({
      ...item,
      id: `${zone.id}-${index}`,
      x: zone.x + 86 + (index % 2) * 378,
      y: zone.y + 206 + Math.floor(index / 2) * 210,
      w: 277, h: 132, broken: false,
      zone
    }));
    const button = document.createElement('button');
    button.className = 'district-button';
    button.type = 'button';
    button.dataset.zone = zone.id;
    button.setAttribute('aria-label', `Jump to ${zone.name}`);
    const number = String(zones.indexOf(zone) + 1).padStart(2, '0');
    button.innerHTML = `<span class="district-number">${number}</span><span class="district-color" style="background:${zone.tone}"></span><span class="district-name"></span><span class="district-arrow" aria-hidden="true">+</span>`;
    button.querySelector('.district-name').textContent = zone.name;
    button.addEventListener('click', () => jumpTo(zone));
    nav.appendChild(button);
  }
  const blocks = zones.flatMap(z => z.blocks);
  const count = blocks.length;

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, r.width);
    h = Math.max(1, r.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    centerCamera(true);
  }
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const color = (hex, opacity) => {
    const digits = hex.replace('#', '');
    const num = parseInt(digits, 16);
    return `rgba(${num >> 16},${(num >> 8) & 255},${num & 255},${opacity})`;
  };
  function rounded(x, y, width, height, radius, fill, stroke, lineWidth = 1) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lineWidth; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function rectVisible(x, y, width, height, margin = 0) {
    return x + width > camera.x - margin && y + height > camera.y - margin &&
      x < camera.x + w + margin && y < camera.y + h + margin;
  }
  function centerCamera(force = false, dt = 0.016) {
    const mobile = w < 640;
    const targetX = clamp(car.x - w * 0.5, 0, Math.max(0, WORLD.width - w));
    const targetY = clamp(car.y - h * (mobile ? 0.39 : 0.51), 0, Math.max(0, WORLD.height - h));
    const blend = force || reduceMotion ? 1 : 1 - Math.exp(-7.5 * dt);
    camera.x += (targetX - camera.x) * blend;
    camera.y += (targetY - camera.y) * blend;
  }
  function update(dt, time) {
    const up = keys.has('up'), down = keys.has('down');
    const left = keys.has('left'), right = keys.has('right');
    if (started && !overview) {
      const acceleration = (up ? 650 : 0) - (down ? 510 : 0);
      car.speed += acceleration * dt;
      if (!up && !down) {
        const drag = 410 * dt;
        car.speed = Math.abs(car.speed) <= drag ? 0 : car.speed - Math.sign(car.speed) * drag;
      }
      car.speed = clamp(car.speed, -225, 540);
      if (left !== right && (Math.abs(car.speed) > 8 || up || down)) {
        const steer = left ? -1 : 1;
        const reverser = car.speed < -5 ? -1 : 1;
        car.angle += steer * 2.45 * dt * clamp(Math.abs(car.speed) / 155, .36, 1.3) * reverser;
      }
      // Foam rails form a solid, collision-tested boundary on all four sides.
      const nx = car.x + Math.cos(car.angle) * car.speed * dt;
      const ny = car.y + Math.sin(car.angle) * car.speed * dt;
      const xmin = ARENA.x + ARENA.rail + 38, xmax = ARENA.x + ARENA.w - ARENA.rail - 38;
      const ymin = ARENA.y + ARENA.rail + 38, ymax = ARENA.y + ARENA.h - ARENA.rail - 38;
      car.x = clamp(nx, xmin, xmax);
      car.y = clamp(ny, ymin, ymax);
      if (nx !== car.x || ny !== car.y) car.speed *= -.13;
    }
    centerCamera(false, dt);
    for (const block of blocks) {
      // A broken resume card respawns *only after* it leaves the screen.
      if (block.broken) {
        if (!rectVisible(block.x, block.y, block.w, block.h, 24)) block.broken = false;
        continue;
      }
      if (!started || Math.abs(car.speed) < 38 || !rectVisible(block.x, block.y, block.w, block.h, 50)) continue;
      const nearestX = clamp(car.x, block.x, block.x + block.w);
      const nearestY = clamp(car.y, block.y, block.y + block.h);
      if (Math.hypot(car.x - nearestX, car.y - nearestY) <= 22) hitBlock(block, time);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.exp(-1.5 * dt); p.vy *= Math.exp(-1.5 * dt);
      p.rotation += p.spin * dt;
    }
    document.getElementById('speedText').textContent = String(Math.round(Math.abs(car.speed) / 5)).padStart(2, '0');
    if (time > toastUntil) toast.classList.remove('is-visible');
    const z = zones.find(z => car.x > z.x && car.x < z.x + z.w && car.y > z.y && car.y < z.y + z.h);
    if ((z?.id || null) !== currentZoneId) {
      currentZoneId = z?.id || null;
      for (const btn of nav.children) btn.classList.toggle('is-current', btn.dataset.zone === currentZoneId);
    }
  }
  function hitBlock(block, time) {
    block.broken = true;
    if (!reduceMotion) for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 250;
      particles.push({ x: clamp(car.x, block.x, block.x + block.w), y: clamp(car.y, block.y, block.y + block.h), vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .55 + Math.random() * .55, max: 1.1, rotation: Math.random() * 6, spin: Math.random() * 7 - 3.5, size: 5 + Math.random() * 13, tone: block.zone.tone });
    }
    const isNew = !picked.has(block.id);
    picked.add(block.id);
    document.getElementById('progressText').textContent = `${picked.size} of ${count} discovered`;
    document.getElementById('progressFill').style.width = `${100 * picked.size / count}%`;
    showDetail(block);
    toast.textContent = isNew ? `Discovered: ${block.title}` : `Rediscovered: ${block.title}`;
    toast.classList.add('is-visible');
    toastUntil = time + 2100;
  }
  function showDetail(block) {
    const zone = block.zone;
    detailPanel.classList.remove('is-expanded');
    detailToggle.setAttribute('aria-expanded', 'false');
    detailToggle.textContent = 'Expand';
    discovery.replaceChildren();
    const badge = document.createElement('span'); badge.className = 'discovery-chip';
    badge.textContent = zone.name.toUpperCase();
    const kicker = document.createElement('div'); kicker.className = 'discovery-kicker'; kicker.textContent = 'RESUME CARD FOUND';
    const title = document.createElement('h2'); title.className = 'article-title'; title.textContent = block.title;
    const meta = document.createElement('div'); meta.className = 'article-meta'; meta.textContent = block.meta;
    const description = document.createElement('p'); description.textContent = block.description;
    discovery.append(badge, kicker, title, meta, description);
    if (block.url && /^(https:\/\/|mailto:)/.test(block.url)) {
      const link = document.createElement('a');
      link.className = 'discovery-link'; link.href = block.url;
      if (block.url.startsWith('https://')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      link.textContent = block.linkLabel || 'Learn more';
      discovery.append(link);
    }
  }
  function jumpTo(zone) {
    if (!started) begin();
    if (overview) {overview=false;deskToggle.textContent='View whole desk';deskToggle.setAttribute('aria-pressed','false');deskToggle.classList.remove('is-overview');document.getElementById('stage').classList.remove('is-desk-overview');}
    car.x = zone.x + 219;
    car.y = zone.y + 146;
    car.speed = 0;
    car.angle = Math.PI / 2;
    centerCamera(true);
    if (window.innerWidth < 961) { mapPanel.classList.remove('is-open'); mapToggle.setAttribute('aria-expanded', 'false'); }
    toast.textContent = `Welcome to ${zone.name}. Drive forward to explore.`;
    toast.classList.add('is-visible'); toastUntil = performance.now() + 2000;
    canvas.focus({preventScroll:true});
  }
  function drawGround() {
    // The desk and its props are stationary world scenery, not player sprites.
    ctx.fillStyle = '#9f7557'; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(-camera.x, -camera.y);
    drawDesktop();
    drawDeskObjects();
    drawArenaBase();
    ctx.save();
    // Keep decorations strictly inside the raised play mat.
    ctx.beginPath();
    ctx.rect(ARENA.x + ARENA.rail, ARENA.y + ARENA.rail,
      ARENA.w - 2 * ARENA.rail, ARENA.h - 2 * ARENA.rail);
    ctx.clip();
    // Contour/grid printing on the miniature track.
    const spacing = 75;
    ctx.strokeStyle = '#438e7030'; ctx.lineWidth = 1;
    ctx.beginPath();
    const ax = ARENA.x + ARENA.rail, ay = ARENA.y + ARENA.rail;
    const ex = ARENA.x + ARENA.w - ARENA.rail;
    const ey = ARENA.y + ARENA.h - ARENA.rail;
    for (let x = Math.max(ax, Math.floor(camera.x / spacing) * spacing); x <= Math.min(ex, camera.x + w + spacing); x += spacing) {
      ctx.moveTo(x, ay); ctx.lineTo(x, ey);
    }
    for (let y = Math.max(ay, Math.floor(camera.y / spacing) * spacing); y <= Math.min(ey, camera.y + h + spacing); y += spacing) {
      ctx.moveTo(ax, y); ctx.lineTo(ex, y);
    }
    ctx.stroke();
    drawRoads();
    drawTrees();
    for (const zone of zones) if (rectVisible(zone.x, zone.y, zone.w, zone.h, 40)) drawZone(zone);
    drawStartPlaza();
    for (const block of blocks) if (rectVisible(block.x, block.y, block.w, block.h, 30) && !block.broken) drawBlock(block);
    for (const particle of particles) drawParticle(particle);
    drawCar();
    ctx.restore();
    drawArenaRails();
    ctx.restore();
  }
  // Walnut tabletop drawn at world scale. All props are decorative and kept
  // outside the playable arena, which is surrounded by raised foam rails.
  function drawDesktop() {
    ctx.fillStyle = '#ae8162'; ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    ctx.fillStyle = '#96674e'; ctx.fillRect(0, 0, WORLD.width, 21);
    ctx.fillStyle = '#d5a886'; ctx.fillRect(0, 23, WORLD.width, 9);
    for (let i = 0; i < 116; i++) {
      const y = 45 + i * 39;
      ctx.lineWidth = i % 5 === 0 ? 3 : 1;
      ctx.strokeStyle = i % 4 === 0 ? '#6f49354a' : '#f6d3a523';
      ctx.beginPath();ctx.moveTo(0, y);ctx.bezierCurveTo(1050, y - 7, 3200, y + 8, WORLD.width, y - 3);ctx.stroke();
    }
    // Warm, broad light falloff from a desk lamp rather than a gameplay effect.
    const light = ctx.createRadialGradient(4880, 360, 60, 4880, 360, 1350);
    light.addColorStop(0,'#fff3d13b');light.addColorStop(1,'#fff3d100');
    ctx.fillStyle=light;ctx.fillRect(3550,0,1950,2000);
  }
  function drawDeskObjects() {
    // Laptop: ~550 wide, many times the 40-unit RC car.
    ctx.save();ctx.translate(360, 2200);ctx.rotate(-.075);
    rounded(-276, -198, 552, 396, 22, '#493f3a4a');
    rounded(-278, -215, 556, 388, 20, '#bac3be', '#68777a', 9);
    rounded(-251, -190, 502, 312, 9, '#182e38', '#d9e8e3', 8);
    const screen=ctx.createLinearGradient(-230,-160,230,130);
    screen.addColorStop(0,'#244b50');screen.addColorStop(1,'#3d7074');
    rounded(-233,-174,466,276,5,screen);
    ctx.textAlign='center';ctx.fillStyle='#c0eed8';ctx.font='bold 31px system-ui';ctx.fillText('RESEARCH LAB',0,-62);
    ctx.font='18px system-ui';ctx.fillStyle='#a8c6c3';ctx.fillText('University of Glasgow',0,-25);
    for(let i=0;i<4;i++) rounded(-182,-2+i*27,340-i*22,7,3,i%2?'#81b8a181':'#d5c9a459');
    rounded(-295,177,590,54,13,'#abb3af','#667475',5);
    rounded(-60,194,120,19,5,'#879391');
    ctx.restore();
    // Books: ~330 by 460. Their shadows show they sit on the table.
    ctx.save();ctx.translate(5060,900);ctx.rotate(.09);
    rounded(-205,-282,412,518,15,'#5d413c59');
    rounded(-220,-298,400,500,12,'#db8e6e','#875b4f',10);
    rounded(-201,-280,363,469,8,'#f7edda','#d8c7ae',4);
    rounded(-197,-280,53,469,4,'#b57557');
    ctx.save();ctx.translate(-22,-20);ctx.rotate(-Math.PI/2);
    ctx.fillStyle='#365d56';ctx.textAlign='center';ctx.font='bold 29px system-ui';ctx.fillText('SOFTWARE ENGINEERING',0,0);
    ctx.restore();ctx.restore();
    ctx.save();ctx.translate(5040,3550);ctx.rotate(-.12);
    rounded(-205,-232,420,485,17,'#554b465a');
    rounded(-215,-245,403,470,14,'#6c8f83','#415e59',9);
    rounded(-196,-226,360,427,9,'#f0e7d7');
    for(let i=0;i<17;i++){ctx.strokeStyle='#8ba5a164';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-151,-180+i*22);ctx.lineTo(124,-180+i*22);ctx.stroke();}
    ctx.fillStyle='#2c6762';ctx.font='bold 26px system-ui';ctx.fillText('LAB NOTES',-147,-185);ctx.restore();
    // Single pocket-sized phone, about the same footprint as the RC car.
    ctx.save();ctx.translate(4966,1880);ctx.rotate(.31);
    rounded(-28,-52,56,106,13,'#3e4c4c77');
    rounded(-24,-50,48,99,10,'#1c3d44','#161c24',5);
    rounded(-20,-41,40,79,4,'#8fcbb6');
    rounded(-10,-37,20,3,2,'#285953');
    ctx.restore();
    // Ballpoint: 145 units long; similar length to a phone, not a giant prop.
    ctx.save();ctx.translate(5010,2410);ctx.rotate(-.66);
    rounded(-6,-77,12,148,4,'#256361','#153d45',3);
    rounded(-6,-42,12,16,2,'#eecb8f');
    ctx.beginPath();ctx.moveTo(-6,70);ctx.lineTo(0,89);ctx.lineTo(6,70);ctx.fillStyle='#ddd6c7';ctx.fill();
    ctx.restore();
    // Desk lamp base and the visible arm at the top of the table.
    ctx.save();ctx.translate(5040,380);ctx.rotate(-.13);
    ctx.fillStyle='#483d3669';ctx.beginPath();ctx.ellipse(14,19,137,120,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#344b4a';ctx.beginPath();ctx.ellipse(0,0,134,115,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#94a8a0';ctx.beginPath();ctx.ellipse(-10,-9,93,79,0,0,Math.PI*2);ctx.fill();
    rounded(-8,-234,16,194,6,'#627975');
    ctx.beginPath();ctx.moveTo(-117,-259);ctx.lineTo(117,-259);ctx.lineTo(89,-181);ctx.lineTo(-89,-181);ctx.closePath();ctx.fillStyle='#efdbc0';ctx.fill();
    ctx.strokeStyle='#385552';ctx.lineWidth=8;ctx.stroke();ctx.restore();
    // Colour pencils near the bottom left of the desk.
    for(let j=0;j<3;j++){
      ctx.save();ctx.translate(220+j*39,4140+j*35);ctx.rotate(-.64+j*.17);
      rounded(-6,-85,12,172,3,['#dc7f69','#3d9580','#e7b760'][j]);
      ctx.beginPath();ctx.moveTo(-6,-85);ctx.lineTo(0,-107);ctx.lineTo(6,-85);ctx.fillStyle='#eed9b4';ctx.fill();
      ctx.restore();
    }
    // Handheld RC transmitter, complete with dual sticks and its own antenna.
    ctx.save();ctx.translate(4820,4255);ctx.rotate(.12);
    rounded(-126,-76,252,158,34,'#344c46','#213c39',8);
    rounded(-110,-66,220,132,23,'#55796b','#94b5a3',5);
    for(const tx of [-66,66]){
      ctx.fillStyle='#243e3c';ctx.beginPath();ctx.arc(tx,-7,28,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#d6e2d4';ctx.beginPath();ctx.arc(tx+5,-11,11,0,Math.PI*2);ctx.fill();
    }
    ctx.fillStyle='#fbcc87';ctx.font='bold 16px system-ui';ctx.textAlign='center';ctx.fillText('RC CONTROL',0,51);ctx.textAlign='left';
    ctx.strokeStyle='#294642';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(10,-72);ctx.lineTo(32,-170);ctx.stroke();
    ctx.fillStyle='#f09b68';ctx.beginPath();ctx.arc(32,-170,7,0,Math.PI*2);ctx.fill();
    ctx.restore();
    // Ceramic coffee mug, over five times wider than the RC car.
    ctx.save();ctx.translate(4225,270);ctx.fillStyle='#443c3570';
    ctx.beginPath();ctx.arc(10,10,103,0,6.283);ctx.fill();
    ctx.lineWidth=25;ctx.strokeStyle='#e7dbc5';ctx.beginPath();ctx.arc(102,5,38,-1.4,1.4);ctx.stroke();
    ctx.fillStyle='#f2e8d9';ctx.beginPath();ctx.arc(0,0,99,0,6.283);ctx.fill();
    ctx.fillStyle='#6e4b3a';ctx.beginPath();ctx.arc(0,0,75,0,6.283);ctx.fill();
    ctx.fillStyle='#b88d70';ctx.beginPath();ctx.ellipse(-18,-13,40,17,-.36,0,6.283);ctx.fill();ctx.restore();
  }
  function drawArenaBase() {
    rounded(ARENA.x + 27,ARENA.y + 35,ARENA.w,ARENA.h,56,'#3c342e73');
    rounded(ARENA.x - 12,ARENA.y - 12,ARENA.w + 24,ARENA.h + 24,48,'#426960','#27453e',14);
    rounded(ARENA.x,ARENA.y,ARENA.w,ARENA.h,39,'#dcefe0','#8fbcaf',8);
    rounded(ARENA.x + ARENA.rail,ARENA.y + ARENA.rail,
      ARENA.w - ARENA.rail*2,ARENA.h - ARENA.rail*2,11,'#dceee1');
  }
  function drawArenaRails() {
    const a=ARENA, r=a.rail;
    // Raised, impact-resistant continuous four-sided foam barrier.
    ctx.save();ctx.strokeStyle='#284a42';ctx.lineWidth=18;
    ctx.strokeRect(a.x+9,a.y+9,a.w-18,a.h-18);
    ctx.strokeStyle='#f9e4b2';ctx.lineWidth=25;
    ctx.strokeRect(a.x+23,a.y+23,a.w-46,a.h-46);
    ctx.strokeStyle='#307967';ctx.lineWidth=10;
    ctx.strokeRect(a.x+42,a.y+42,a.w-84,a.h-84);
    // Small reflectors repeat around the complete rectangular boundary.
    for(let x=a.x+100;x<a.x+a.w-55;x+=116){
      rounded(x,a.y+11,32,13,3,'#f59b67');
      rounded(x,a.y+a.h-24,32,13,3,'#f59b67');
    }
    for(let y=a.y+110;y<a.y+a.h-50;y+=116){
      rounded(a.x+11,y,13,32,3,'#f59b67');
      rounded(a.x+a.w-24,y,13,32,3,'#f59b67');
    }
    ctx.restore();
    // Printed arena label, visible from desk overview near the top edge.
    ctx.fillStyle='#204e47';ctx.textAlign='center';ctx.font='800 24px system-ui';
    ctx.fillText('SATWIK RC RESEARCH CIRCUIT', a.x+a.w/2, a.y+29);
    ctx.textAlign='left';
  }
  function drawRoads() {
    const a=ARENA;
    const roads = [
      { vertical: true, pos: a.x+1430, width: 152 }, { vertical: true, pos: a.x+2630, width: 152 },
      { vertical: false, pos: a.y+1270, width: 154 }, { vertical: false, pos: a.y+2290, width: 154 }
    ];
    // A continuous four-sided boundary road, inside the physical foam wall.
    ctx.save();ctx.strokeStyle='#8eaeb7';ctx.lineWidth=142;
    ctx.strokeRect(a.x+184,a.y+184,a.w-368,a.h-368);
    ctx.strokeStyle='#fffbe0b8';ctx.lineWidth=4;ctx.setLineDash([32,36]);
    ctx.strokeRect(a.x+184,a.y+184,a.w-368,a.h-368);
    ctx.setLineDash([]);ctx.restore();
    for (const road of roads) {
      const x = road.vertical ? road.pos - road.width / 2 : a.x;
      const y = road.vertical ? a.y : road.pos - road.width / 2;
      const rw = road.vertical ? road.width : a.w;
      const rh = road.vertical ? a.h : road.width;
      rounded(x, y, rw, rh, 0, '#a1bcca', '#729aaa', 4);
      ctx.save(); ctx.strokeStyle = '#fffde2dc'; ctx.lineWidth = 3;
      ctx.setLineDash([28, 34]); ctx.beginPath();
      if (road.vertical) { ctx.moveTo(road.pos, a.y); ctx.lineTo(road.pos, a.y+a.h); }
      else { ctx.moveTo(a.x, road.pos); ctx.lineTo(a.x+a.w, road.pos); }
      ctx.stroke(); ctx.restore();
    }
    // Connecting streets visually guide the route between neighbourhoods.
    ctx.save();ctx.strokeStyle='#84a4ae';ctx.lineWidth=18;ctx.setLineDash([3,31]);
    ctx.beginPath();ctx.moveTo(a.x+700,a.y+1270);ctx.lineTo(a.x+700,a.y+2290);
    ctx.moveTo(a.x+3300,a.y+1270);ctx.lineTo(a.x+3300,a.y+2290);ctx.stroke();ctx.restore();
  }
  function drawTrees() {
    const size = 208;
    const left = Math.floor(camera.x / size) * size;
    const top = Math.floor(camera.y / size) * size;
    for (let x = left; x < camera.x + w + size; x += size) {
      for (let y = top; y < camera.y + h + size; y += size) {
        if (x < ARENA.x + 76 || y < ARENA.y + 76 || x > ARENA.x + ARENA.w - 76 || y > ARENA.y + ARENA.h - 76) continue;
        const sx = x + Math.sin(x * 0.021 + y * .017) * 41, sy = y + Math.cos(x * .017 - y * .011) * 38;
        if (zones.some(z => sx > z.x - 34 && sx < z.x + z.w + 34 && sy > z.y - 34 && sy < z.y + z.h + 34)) continue;
        if (Math.abs(sx - (ARENA.x+1430)) < 115 || Math.abs(sx - (ARENA.x+2630)) < 115 || Math.abs(sy - (ARENA.y+1270)) < 118 || Math.abs(sy - (ARENA.y+2290)) < 118) continue;
        ctx.fillStyle = '#91c68a'; ctx.beginPath(); ctx.arc(sx, sy, 24, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#5ca882'; ctx.beginPath(); ctx.arc(sx - 5, sy - 6, 16, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#e5ffc5a0'; ctx.beginPath(); ctx.arc(sx + 9, sy - 8, 7, 0, 6.283); ctx.fill();
      }
    }
  }
  function drawZone(zone) {
    const z = zone;
    rounded(z.x + 9, z.y + 13, z.w, z.h, 26, '#4f93743b');
    rounded(z.x, z.y, z.w, z.h, 25, color(z.tone, .70), color(z.tone, .92), 2);
    rounded(z.x + 21, z.y + 21, z.w - 42, z.h - 42, 15, '#ffffff69', color(z.tone, .25), 1);
    // Small marker repeated along top edge.
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = color(z.tone, i % 2 ? .15 : .50);
      ctx.fillRect(z.x + 35 + i * 29, z.y + 20, 15, 3);
    }
    ctx.textBaseline = 'top';
    ctx.font = '800 13px system-ui, sans-serif'; ctx.fillStyle = '#24565a';
    ctx.fillText(z.tag, z.x + 57, z.y + 60);
    ctx.font = '800 38px system-ui, sans-serif'; ctx.fillStyle = '#153d3e';
    ctx.fillText(z.name.toUpperCase(), z.x + 56, z.y + 86);
    ctx.font = '700 11px system-ui, sans-serif'; ctx.fillStyle = '#335e5b';
    ctx.fillText(z.eyebrow, z.x + 58, z.y + 145);
    ctx.font = '800 88px system-ui, sans-serif'; ctx.fillStyle = color(z.tone, .42);
    ctx.textAlign = 'right'; ctx.fillText(String(zones.indexOf(z) + 1).padStart(2, '0'), z.x + z.w - 37, z.y + 55); ctx.textAlign = 'left';
    for (let index = 0; index < 4; index++) {
      const b = z.blocks[index];
      ctx.strokeStyle = color(z.tone, .23); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(b.x - 14, b.y - 13); ctx.lineTo(b.x + b.w + 14, b.y - 13); ctx.stroke();
    }
  }
  function drawBlock(b) {
    // Important: the block is *intact and breakable*. Content is revealed in the DOM panel after impact.
    const glow = b.zone.tone;
    rounded(b.x + 7, b.y + 10, b.w, b.h, 10, '#567c7166');
    rounded(b.x, b.y, b.w, b.h, 10, '#ffffff', color(glow, .97), 4);
    rounded(b.x + 12, b.y + 12, b.w - 24, 24, 4, color(glow, .92));
    ctx.font = '900 11px system-ui, sans-serif'; ctx.fillStyle = '#153d43'; ctx.textBaseline = 'middle';
    ctx.fillText('BREAK TO DISCOVER', b.x + 24, b.y + 24);
    ctx.font = '850 16px system-ui, sans-serif'; ctx.fillStyle = '#173f47'; ctx.textBaseline = 'top';
    drawWrapped(b.title, b.x + 24, b.y + 50, b.w - 48, 21, 2);
    ctx.fillStyle = '#496c68'; ctx.font = '750 10px system-ui, sans-serif';
    const caption = b.meta.length > 38 ? `${b.meta.slice(0, 36)}...` : b.meta;
    ctx.fillText(caption, b.x + 24, b.y + b.h - 23);
    ctx.font = '900 22px system-ui, sans-serif'; ctx.fillStyle = '#1b776b';
    ctx.fillText('+', b.x + b.w - 33, b.y + b.h - 39);
  }
  function drawWrapped(text, x, y, maxWidth, lineHeight, maxLines) {
    const words = text.split(' '); let line = '', lines = [];
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) { lines.push(line); line = word; }
      else line = candidate;
    }
    if (line) lines.push(line);
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      let l = lines[i];
      if (i === maxLines - 1 && lines.length > maxLines) {
        while (l.length && ctx.measureText(l + '...').width > maxWidth) l = l.slice(0, -1);
        l += '...';
      }
      ctx.fillText(l, x, y + i * lineHeight);
    }
  }
  function drawStartPlaza() {
    const cx = ARENA.x + 2010, cy = ARENA.y + 1580;
    if (!rectVisible(cx - 290, cy - 290, 580, 580, 60)) return;
    ctx.beginPath(); ctx.arc(cx, cy, 280, 0, Math.PI * 2); ctx.fillStyle = '#fffcdeeb'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 229, 0, Math.PI * 2); ctx.strokeStyle = '#2f896da3'; ctx.lineWidth = 3; ctx.setLineDash([9, 20]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, 135, 0, Math.PI * 2); ctx.strokeStyle = '#efad7191'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#1b6758'; ctx.textAlign = 'center'; ctx.font = '800 17px system-ui, sans-serif';
    ctx.fillText('START YOUR JOURNEY', cx, cy + 130);
    ctx.fillStyle = '#356b65'; ctx.font = '800 11px system-ui, sans-serif';
    ctx.fillText('RESEARCH   /   DESIGN   /   BUILD', cx, cy + 156);
    ctx.textAlign = 'left';
    const arrowPositions = [{x:cx - 215,y:cy,txt:'INDUSTRY'}, {x:cx + 215,y:cy,txt:'AI'}, {x:cx,y:cy - 210,txt:'PAPERS'}, {x:cx,y:cy + 220,txt:'SERVICE'}];
    for (const a of arrowPositions) { ctx.textAlign = 'center';ctx.fillStyle = '#2f7666';ctx.font = '750 12px system-ui,sans-serif';ctx.fillText(a.txt,a.x,a.y); }
    ctx.textAlign = 'left';
  }
  function drawParticle(p) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation); ctx.globalAlpha = Math.min(1, p.life * 1.6);
    ctx.fillStyle = p.tone; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * .75);
    ctx.restore();
  }
  function drawCar() {
    const x = car.x, y = car.y;
    ctx.save(); ctx.translate(x, y); ctx.rotate(car.angle + Math.PI / 2);
    // Car points towards local negative Y.
    ctx.fillStyle = '#0618177b'; rounded(-21 + 9, -32 + 10, 42, 72, 10, '#06181788');
    rounded(-26, -24, 8, 21, 3, '#0a1718'); rounded(18, -24, 8, 21, 3, '#0a1718');
    rounded(-26, 10, 8, 21, 3, '#0a1718'); rounded(18, 10, 8, 21, 3, '#0a1718');
    rounded(-20, -35, 40, 70, 11, '#ffc08c', '#3b594d', 3);
    rounded(-15, -24, 30, 22, 5, '#3a6b69', '#d2e9c7', 1);
    rounded(-15, 6, 30, 18, 5, '#e99a6a');
    rounded(-13, -36, 9, 5, 2, '#eafaad'); rounded(4, -36, 9, 5, 2, '#eafaad');
    rounded(-13, 31, 10, 4, 2, '#d75b55'); rounded(3, 31, 10, 4, 2, '#d75b55');
    ctx.strokeStyle = '#fff4d03c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-11, -1); ctx.lineTo(11, -1); ctx.stroke();
    // Thin flexible RC whip at the rear: fixed to the car, no gameplay logic.
    rounded(11, 24, 8, 8, 3, '#355d59', '#d4e6d6', 1);
    ctx.beginPath(); ctx.moveTo(15, 29); ctx.quadraticCurveTo(27, 44, 23, 76);
    ctx.lineWidth=3;ctx.strokeStyle='#334b4b';ctx.stroke();
    ctx.beginPath();ctx.arc(23,76,4.5,0,Math.PI*2);ctx.fillStyle='#eb774d';ctx.fill();
    ctx.beginPath();ctx.arc(23,76,2,0,Math.PI*2);ctx.fillStyle='#ffdbc0';ctx.fill();
    ctx.restore();
    if (started && Math.abs(car.speed) > 50 && !reduceMotion) {
      ctx.save();ctx.globalAlpha = .20;ctx.fillStyle = '#e6e9c0';ctx.beginPath();
      ctx.arc(car.x - Math.cos(car.angle) * 43, car.y - Math.sin(car.angle) * 43, 6, 0, 6.28);ctx.fill();ctx.restore();
    }
  }
  function drawMiniMap() {
    if (window.innerWidth < 1550 || !miniCtx) return;
    const mw = miniCanvas.width, mh = miniCanvas.height;
    miniCtx.clearRect(0, 0, mw, mh); miniCtx.fillStyle = '#e0f0e0'; miniCtx.fillRect(0, 0, mw, mh);
    const sc = Math.min((mw - 16) / WORLD.width, (mh - 14) / WORLD.height);
    const left = (mw - WORLD.width * sc) / 2, top = (mh - WORLD.height * sc) / 2;
    for (const zone of zones) {
      miniCtx.fillStyle = color(zone.tone, .8);
      miniCtx.fillRect(left + zone.x * sc, top + zone.y * sc, zone.w * sc, zone.h * sc);
    }
    miniCtx.strokeStyle = '#2d6157';miniCtx.lineWidth = 1.6;
    miniCtx.strokeRect(left + ARENA.x * sc, top + ARENA.y * sc, ARENA.w * sc, ARENA.h * sc);
    miniCtx.fillStyle = '#ffbb78';miniCtx.beginPath();miniCtx.arc(left + car.x * sc, top + car.y * sc, 4, 0, 6.283);miniCtx.fill();
    miniCtx.strokeStyle = '#2a655f';miniCtx.strokeRect(left + camera.x * sc, top + camera.y * sc, w * sc, h * sc);
  }
  function frame(time) {
    const dt = Math.min(.038, (time - (lastTime || time)) / 1000); lastTime = time;
    update(dt, time);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (overview) {
      ctx.save();
      const ow=w, oh=h, ox=camera.x, oy=camera.y;
      const sc=Math.min((ow-26)/WORLD.width,(oh-26)/WORLD.height);
      ctx.translate((ow-WORLD.width*sc)/2,(oh-WORLD.height*sc)/2);
      ctx.scale(sc,sc);
      camera.x=0;camera.y=0;w=WORLD.width;h=WORLD.height;
      drawGround();
      w=ow;h=oh;camera.x=ox;camera.y=oy;
      ctx.restore();
    } else drawGround();
    drawMiniMap();
    window.requestAnimationFrame(frame);
  }
  deskToggle.addEventListener('click', () => {
    overview = !overview;
    car.speed = 0; keys.clear();
    deskToggle.textContent = overview ? 'Return to driving' : 'View whole desk';
    deskToggle.setAttribute('aria-pressed', String(overview));
    deskToggle.classList.toggle('is-overview', overview);
    document.getElementById('stage').classList.toggle('is-desk-overview', overview);
    toast.textContent = overview ? 'Your research circuit, on a real desk. Return to driving to explore.' : 'Back in the RC driving arena.';
    toast.classList.add('is-visible'); toastUntil = performance.now() + 2400;
  });
  function begin() {
    started = true;
    app.inert = false;
    intro.classList.add('is-hidden');
    intro.setAttribute('aria-hidden', 'true');
    keys.clear();
    canvas.focus({preventScroll:true});
  }
  function showHelp() {
    started = false; keys.clear();car.speed = 0;
    app.inert = true;
    intro.classList.remove('is-hidden');intro.removeAttribute('aria-hidden');
    startButton.textContent = 'Resume driving';
    startButton.focus({preventScroll:true});
  }
  startButton.addEventListener('click', begin);
  document.getElementById('introClose').addEventListener('click', begin);
  document.getElementById('helpButton').addEventListener('click', showHelp);
  detailToggle.addEventListener('click', () => {
    const expanded = detailPanel.classList.toggle('is-expanded');
    detailToggle.setAttribute('aria-expanded', String(expanded));
    detailToggle.textContent = expanded ? 'Collapse' : 'Expand';
  });
  mapToggle.addEventListener('click', () => {
    const open = mapPanel.classList.toggle('is-open');
    mapToggle.setAttribute('aria-expanded', String(open));
  });
  function keyMapping(key) {
    const k = key.toLowerCase();
    if (k === 'w' || k === 'arrowup') return 'up';
    if (k === 's' || k === 'arrowdown') return 'down';
    if (k === 'a' || k === 'arrowleft') return 'left';
    if (k === 'd' || k === 'arrowright') return 'right';
    return null;
  }
  window.addEventListener('keydown', event => {
    const key = keyMapping(event.key);
    if (!key || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select')) return;
    if (!intro.classList.contains('is-hidden')) return;
    event.preventDefault(); keys.add(key);
  });
  window.addEventListener('keyup', event => {const k = keyMapping(event.key); if (k) keys.delete(k);});
  window.addEventListener('blur', () => { keys.clear(); car.speed = 0; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear();car.speed = 0; }});
  document.querySelectorAll('[data-control]').forEach(button => {
    const k = button.dataset.control;
    const release = () => {keys.delete(k); button.classList.remove('is-pressed');};
    button.addEventListener('pointerdown', event => {
      if (!started) begin();
      event.preventDefault();keys.add(k);button.classList.add('is-pressed');
      try { button.setPointerCapture(event.pointerId); } catch (_) {}
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', event => event.preventDefault());
  });
  window.addEventListener('resize', resize);
  resize();
  // A link from the text homepage starts the game immediately.
  // Direct visitors to game.html still see the instruction overlay.
  if (new URLSearchParams(window.location.search).get('start') === '1') begin();
  window.requestAnimationFrame(frame);
  // Expose read-only debugging snapshots for automated smoke testing; no gameplay dependency.
  window.__resumeGameDebug = () => ({x: car.x, y: car.y, speed: car.speed, discoveries: picked.size, broken: blocks.filter(b => b.broken).map(b => b.id), camera: {...camera}, arena: {...ARENA}, overview, started});
})();
