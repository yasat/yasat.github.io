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

  const WORLD = { width: 4000, height: 3350 };
  const car = { x: 2010, y: 1580, angle: -Math.PI / 2, speed: 0 };
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
  let started = false, lastTime = 0, w = 1, h = 1, dpr = 1, currentZoneId = null, toastUntil = 0;

  for (const zone of zones) {
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
    button.innerHTML = `<span class="district-number">${number}</span><span class="district-color" style="background:${zone.tone}"></span><span class="district-name"></span><span class="district-arrow" aria-hidden="true">↗</span>`;
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
    if (started) {
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
      car.x = clamp(car.x + Math.cos(car.angle) * car.speed * dt, 48, WORLD.width - 48);
      car.y = clamp(car.y + Math.sin(car.angle) * car.speed * dt, 48, WORLD.height - 48);
      if ((car.x <= 48 || car.x >= WORLD.width - 48 || car.y <= 48 || car.y >= WORLD.height - 48) && Math.abs(car.speed) > 100) car.speed *= .8;
    }
    centerCamera(false, dt);
    for (const block of blocks) {
      // A broken résumé card respawns *only after* it leaves the screen.
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
    toast.textContent = isNew ? `✦ Discovered: ${block.title}` : `↻ Rediscovered: ${block.title}`;
    toast.classList.add('is-visible');
    toastUntil = time + 2100;
  }
  function showDetail(block) {
    const zone = block.zone;
    detailPanel.classList.remove('is-expanded');
    detailToggle.setAttribute('aria-expanded', 'false');
    detailToggle.textContent = 'Expand ↕';
    discovery.replaceChildren();
    const badge = document.createElement('span'); badge.className = 'discovery-chip';
    badge.textContent = zone.name.toUpperCase();
    const kicker = document.createElement('div'); kicker.className = 'discovery-kicker'; kicker.textContent = '✦ RESUME CARD FOUND';
    const title = document.createElement('h2'); title.className = 'article-title'; title.textContent = block.title;
    const meta = document.createElement('div'); meta.className = 'article-meta'; meta.textContent = block.meta;
    const description = document.createElement('p'); description.textContent = block.description;
    discovery.append(badge, kicker, title, meta, description);
    if (block.url && /^(https:\/\/|mailto:)/.test(block.url)) {
      const link = document.createElement('a');
      link.className = 'discovery-link'; link.href = block.url;
      if (block.url.startsWith('https://')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      link.textContent = `${block.linkLabel || 'Learn more'} ↗`;
      discovery.append(link);
    }
  }
  function jumpTo(zone) {
    if (!started) begin();
    car.x = zone.x + 219;
    car.y = zone.y + 146;
    car.speed = 0;
    car.angle = Math.PI / 2;
    centerCamera(true);
    if (window.innerWidth < 961) { mapPanel.classList.remove('is-open'); mapToggle.setAttribute('aria-expanded', 'false'); }
    toast.textContent = `↗ Welcome to ${zone.name}. Drive forward to explore.`;
    toast.classList.add('is-visible'); toastUntil = performance.now() + 2000;
    canvas.focus({preventScroll:true});
  }
  function drawGround() {
    ctx.fillStyle = '#1c3333'; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(-camera.x, -camera.y);
    rounded(0, 0, WORLD.width, WORLD.height, 0, '#263d39', '#7c9470', 9);
    // Very subtle contour lines, deliberately static/deterministic.
    const spacing = 75;
    ctx.strokeStyle = '#9bc4ae10'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(camera.x / spacing) * spacing; x <= camera.x + w + spacing; x += spacing) {
      ctx.moveTo(x, Math.max(0, camera.y)); ctx.lineTo(x, Math.min(WORLD.height, camera.y + h));
    }
    for (let y = Math.floor(camera.y / spacing) * spacing; y <= camera.y + h + spacing; y += spacing) {
      ctx.moveTo(Math.max(0, camera.x), y); ctx.lineTo(Math.min(WORLD.width, camera.x + w), y);
    }
    ctx.stroke();
    drawRoads();
    drawTrees();
    for (const zone of zones) if (rectVisible(zone.x, zone.y, zone.w, zone.h, 40)) drawZone(zone);
    drawStartPlaza();
    for (const block of blocks) if (rectVisible(block.x, block.y, block.w, block.h, 30) && !block.broken) drawBlock(block);
    for (const p of particles) drawParticle(p);
    drawCar();
    ctx.restore();
  }
  function drawRoads() {
    const roads = [
      { vertical: true, pos: 1430, width: 152 }, { vertical: true, pos: 2630, width: 152 },
      { vertical: false, pos: 1270, width: 154 }, { vertical: false, pos: 2290, width: 154 }
    ];
    for (const road of roads) {
      const x = road.vertical ? road.pos - road.width / 2 : 0;
      const y = road.vertical ? 0 : road.pos - road.width / 2;
      const rw = road.vertical ? road.width : WORLD.width;
      const rh = road.vertical ? WORLD.height : road.width;
      rounded(x, y, rw, rh, 0, '#3b5754', '#59746a', 4);
      ctx.save(); ctx.strokeStyle = '#e9d8ab76'; ctx.lineWidth = 3;
      ctx.setLineDash([28, 34]); ctx.beginPath();
      if (road.vertical) { ctx.moveTo(road.pos, 0); ctx.lineTo(road.pos, WORLD.height); }
      else { ctx.moveTo(0, road.pos); ctx.lineTo(WORLD.width, road.pos); }
      ctx.stroke(); ctx.restore();
    }
    // Connecting streets visually guide the route between neighbourhoods.
    ctx.save(); ctx.strokeStyle = '#5b7369'; ctx.lineWidth = 18; ctx.setLineDash([3, 31]);
    ctx.beginPath(); ctx.moveTo(700, 1270); ctx.lineTo(700, 2290);
    ctx.moveTo(3300, 1270); ctx.lineTo(3300, 2290); ctx.stroke(); ctx.restore();
  }
  function drawTrees() {
    const size = 208;
    const left = Math.floor(camera.x / size) * size;
    const top = Math.floor(camera.y / size) * size;
    for (let x = left; x < camera.x + w + size; x += size) {
      for (let y = top; y < camera.y + h + size; y += size) {
        if (x < 70 || y < 70 || x > WORLD.width - 70 || y > WORLD.height - 70) continue;
        const sx = x + Math.sin(x * 0.021 + y * .017) * 41, sy = y + Math.cos(x * .017 - y * .011) * 38;
        if (zones.some(z => sx > z.x - 34 && sx < z.x + z.w + 34 && sy > z.y - 34 && sy < z.y + z.h + 34)) continue;
        if (Math.abs(sx - 1430) < 115 || Math.abs(sx - 2630) < 115 || Math.abs(sy - 1270) < 118 || Math.abs(sy - 2290) < 118) continue;
        ctx.fillStyle = '#314e45'; ctx.beginPath(); ctx.arc(sx, sy, 24, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#3c6151'; ctx.beginPath(); ctx.arc(sx - 5, sy - 6, 16, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#a1c08a35'; ctx.beginPath(); ctx.arc(sx + 9, sy - 8, 7, 0, 6.283); ctx.fill();
      }
    }
  }
  function drawZone(zone) {
    const z = zone;
    rounded(z.x + 9, z.y + 13, z.w, z.h, 26, '#0a141b60');
    rounded(z.x, z.y, z.w, z.h, 25, color(z.tone, .14), color(z.tone, .49), 2);
    rounded(z.x + 21, z.y + 21, z.w - 42, z.h - 42, 15, '#132f2d52', color(z.tone, .25), 1);
    // Small marker repeated along top edge.
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = color(z.tone, i % 2 ? .15 : .50);
      ctx.fillRect(z.x + 35 + i * 29, z.y + 20, 15, 3);
    }
    ctx.textBaseline = 'top';
    ctx.font = '800 13px system-ui, sans-serif'; ctx.fillStyle = color(z.tone, .95);
    ctx.fillText(z.tag, z.x + 57, z.y + 60);
    ctx.font = '800 38px system-ui, sans-serif'; ctx.fillStyle = '#edf5ea';
    ctx.fillText(z.name.toUpperCase(), z.x + 56, z.y + 86);
    ctx.font = '700 11px system-ui, sans-serif'; ctx.fillStyle = '#b7ccc2';
    ctx.fillText(z.eyebrow, z.x + 58, z.y + 145);
    ctx.font = '800 88px system-ui, sans-serif'; ctx.fillStyle = color(z.tone, .08);
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
    rounded(b.x + 8, b.y + 11, b.w, b.h, 10, '#061e1c8c');
    rounded(b.x, b.y, b.w, b.h, 10, '#e8f0e5', glow, 4);
    rounded(b.x + 12, b.y + 12, b.w - 24, 24, 4, color(glow, .72));
    ctx.font = '900 11px system-ui, sans-serif'; ctx.fillStyle = '#25433e'; ctx.textBaseline = 'middle';
    ctx.fillText('BREAK TO DISCOVER', b.x + 24, b.y + 24);
    ctx.font = '900 17px system-ui, sans-serif'; ctx.fillStyle = '#1a3734'; ctx.textBaseline = 'top';
    drawWrapped(b.title, b.x + 24, b.y + 50, b.w - 48, 21, 2);
    ctx.fillStyle = '#68887b'; ctx.font = '750 10px system-ui, sans-serif';
    const caption = b.meta.length > 38 ? `${b.meta.slice(0, 36)}…` : b.meta;
    ctx.fillText(caption, b.x + 24, b.y + b.h - 23);
    ctx.font = '900 22px system-ui, sans-serif'; ctx.fillStyle = '#628779';
    ctx.fillText('↗', b.x + b.w - 33, b.y + b.h - 39);
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
        while (l.length && ctx.measureText(l + '…').width > maxWidth) l = l.slice(0, -1);
        l += '…';
      }
      ctx.fillText(l, x, y + i * lineHeight);
    }
  }
  function drawStartPlaza() {
    const cx = 2010, cy = 1580;
    if (!rectVisible(cx - 290, cy - 290, 580, 580, 60)) return;
    ctx.beginPath(); ctx.arc(cx, cy, 280, 0, Math.PI * 2); ctx.fillStyle = '#192d2bd0'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 229, 0, Math.PI * 2); ctx.strokeStyle = '#82bc9e6c'; ctx.lineWidth = 3; ctx.setLineDash([9, 20]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, 135, 0, Math.PI * 2); ctx.strokeStyle = '#d9daa352'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#a1d8c997'; ctx.textAlign = 'center'; ctx.font = '800 17px system-ui, sans-serif';
    ctx.fillText('START YOUR JOURNEY', cx, cy + 130);
    ctx.fillStyle = '#fff5de7d'; ctx.font = '800 11px system-ui, sans-serif';
    ctx.fillText('RESEARCH  •  DESIGN  •  BUILD', cx, cy + 156);
    ctx.textAlign = 'left';
    const arrowPositions = [{x:cx - 215,y:cy,txt:'← INDUSTRY'}, {x:cx + 215,y:cy,txt:'AI →'}, {x:cx,y:cy - 210,txt:'↑ PAPERS'}, {x:cx,y:cy + 220,txt:'↓ SERVICE'}];
    for (const a of arrowPositions) { ctx.textAlign = 'center';ctx.fillStyle = '#9fc9ab';ctx.font = '750 12px system-ui,sans-serif';ctx.fillText(a.txt,a.x,a.y); }
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
    ctx.restore();
    if (started && Math.abs(car.speed) > 50 && !reduceMotion) {
      ctx.save();ctx.globalAlpha = .20;ctx.fillStyle = '#e6e9c0';ctx.beginPath();
      ctx.arc(car.x - Math.cos(car.angle) * 43, car.y - Math.sin(car.angle) * 43, 6, 0, 6.28);ctx.fill();ctx.restore();
    }
  }
  function drawMiniMap() {
    if (window.innerWidth < 1550 || !miniCtx) return;
    const mw = miniCanvas.width, mh = miniCanvas.height;
    miniCtx.clearRect(0, 0, mw, mh); miniCtx.fillStyle = '#193630'; miniCtx.fillRect(0, 0, mw, mh);
    const sc = Math.min((mw - 16) / WORLD.width, (mh - 14) / WORLD.height);
    const left = (mw - WORLD.width * sc) / 2, top = (mh - WORLD.height * sc) / 2;
    for (const zone of zones) {
      miniCtx.fillStyle = color(zone.tone, .8);
      miniCtx.fillRect(left + zone.x * sc, top + zone.y * sc, zone.w * sc, zone.h * sc);
    }
    miniCtx.fillStyle = '#ffbb78';miniCtx.beginPath();miniCtx.arc(left + car.x * sc, top + car.y * sc, 4, 0, 6.283);miniCtx.fill();
    miniCtx.strokeStyle = '#e8f0d6';miniCtx.strokeRect(left + camera.x * sc, top + camera.y * sc, w * sc, h * sc);
  }
  function frame(time) {
    const dt = Math.min(.038, (time - (lastTime || time)) / 1000); lastTime = time;
    update(dt, time);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawGround();drawMiniMap();
    window.requestAnimationFrame(frame);
  }
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
    startButton.textContent = 'Resume driving ↗';
    startButton.focus({preventScroll:true});
  }
  startButton.addEventListener('click', begin);
  document.getElementById('introClose').addEventListener('click', begin);
  document.getElementById('helpButton').addEventListener('click', showHelp);
  detailToggle.addEventListener('click', () => {
    const expanded = detailPanel.classList.toggle('is-expanded');
    detailToggle.setAttribute('aria-expanded', String(expanded));
    detailToggle.textContent = expanded ? 'Collapse ↕' : 'Expand ↕';
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
  window.requestAnimationFrame(frame);
  // Expose read-only debugging snapshots for automated smoke testing; no gameplay dependency.
  window.__resumeGameDebug = () => ({x: car.x, y: car.y, speed: car.speed, discoveries: picked.size, broken: blocks.filter(b => b.broken).map(b => b.id), camera: {...camera}, started});
})();
