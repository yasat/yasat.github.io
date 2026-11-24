/* Sample-accurate looping via Web Audio; independent procedural/media fallbacks. */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = n => Number.isFinite(Number(n)) ? Number(n) : 0;
const ASSETS = ['motor-loop', 'tyre-loop', 'background-loop'];


export class RaceAudio {
  constructor() {
    this.mode = 'all';
    this.ctx = null;
    this.graphReady = false;
    this.nextNote = 0;
    this.note = 0;
    this.lastSpeed = 0;
    this.files = null;
    this.media = [];
    this.buffers = [];
    this.bufferLoads = [];
    this.lastInput = {};
    try {
      const m = localStorage.getItem('rc-audio');
      if (['all', 'engine', 'off'].includes(m)) this.mode = m;
    } catch {}
  }

  get pending() { return this.media.some(m => m.pending); }
  get filePlaying() { return this.isPlaying(0); }
  isPlaying(i) {
    const a = this.files?.[i];
    return !!a && !a.paused && !a.ended && !a.error &&
      (a.readyState === undefined || a.readyState >= 2);
  }
  get status() {
    if (this.mode === 'off') return 'off';
    if (this.filePlaying || (this.graphReady && this.ctx?.state === 'running')) return 'playing';
    return this.pending ? 'loading' : 'blocked';
  }
  get detail() {
    const names = ASSETS.map((name,i) => `${name}: ${this.buffers[i] ? 'gapless buffer' : this.isPlaying(i) ? 'media fallback' : this.bufferLoads[i] === 'loading' ? 'loading' : 'procedural fallback'}`);
    return `${names.join(' | ')} | Web Audio: ${this.ctx?.state || 'not started'}`;
  }

  setMode(mode) {
    this.mode = mode;
    try { localStorage.setItem('rc-audio', mode); } catch {}
    if (mode === 'off') {
      if (this.files) for (const a of this.files) a.volume = 0;
      this.update(this.lastInput);
    }
    return mode;
  }
  cycle() {
    this.setMode({all:'engine', engine:'off', off:'all'}[this.mode]);
    if (this.mode !== 'off') this.unlock();
    return this.mode;
  }

  // Decode each local loop independently. An AudioBufferSourceNode loops on the
  // audio rendering clock, not through HTML media seek/restart events.
  loadBuffers() {
    const c=this.ctx;
    if (!this.graphReady || !c?.decodeAudioData || typeof fetch !== 'function') return;
    ASSETS.forEach((name,i)=>{
      if(this.bufferLoads[i])return;
      this.bufferLoads[i]='loading';
      fetch(new URL(`assets/audio/${name}.wav?v=3`,import.meta.url))
        .then(r=>{if(!r.ok)throw Error(`audio HTTP ${r.status}`);return r.arrayBuffer();})
        .then(bytes=>c.decodeAudioData(bytes))
        .then(buffer=>{
          if(c.state==='closed')return;
          const source=c.createBufferSource(),gain=c.createGain();
          source.buffer=buffer;source.loop=true;source.loopStart=0;source.loopEnd=buffer.duration;
          gain.gain.value=0;source.connect(gain).connect(this.master);
          source.start();this.buffers[i]={source,gain};this.bufferLoads[i]='ready';
          this.update(this.lastInput);
        }).catch(()=>{this.bufferLoads[i]='failed';});
    });
  }

  unlockFiles() {
    if (this.mode === 'off' || typeof window.Audio !== 'function') return;
    try {
      if (!this.files) {
        this.files = ASSETS.map((name,i) => {
          const a = new window.Audio(new URL(`assets/audio/${name}.wav?v=3`, import.meta.url).href);
          a.loop = true;
          a.preload = 'auto';
          a.muted = false;
          a.volume = i === 0 ? .55 : i === 2 && this.mode === 'all' ? .12 : .01;
          a.preservesPitch = false;
          this.media[i] = {pending:false,error:''};
          a.addEventListener?.('error', () => { this.media[i].error = `media error ${a.error?.code || ''}`; this.media[i].pending = false; });
          return a;
        });
      }
      this.files.forEach((a,i) => {
        const state = this.media[i];
        if (i === 2 && this.mode !== 'all') return;
        if (state.pending || this.isPlaying(i)) return;
        state.pending = true;
        state.error = '';
        let result;
        try { result = a.play(); } catch (e) { result = Promise.reject(e); }
        Promise.resolve(result).then(() => {
          state.pending = false;
          if (this.mode === 'off') a.volume=0;
        }, e => {
          state.pending = false;
          state.error = e?.name || 'playback rejected';
        });
      });
    } catch (e) { console.warn('Local audio unavailable',e); }
  }

  unlock() {
    if (this.mode === 'off') return;
    try {
      if (!this.ctx) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) {this.unlockFiles();return;}
        const c = this.ctx = new Audio();
        this.master = c.createGain();
        this.master.gain.value = .8;
        this.master.connect(c.destination);
        this.engineGain = c.createGain();
        this.engineGain.gain.value = 0;
        const filter = this.filter = c.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 720;
        this.engineGain.connect(filter).connect(this.master);
        this.motor = c.createOscillator(); this.motor.type='sawtooth'; this.motor.frequency.value=65;
        this.motor.connect(this.engineGain); this.motor.start();
        this.whine = c.createOscillator(); this.whine.type='triangle'; this.whine.frequency.value=145;
        const wg=c.createGain(); wg.gain.value=.24; this.whine.connect(wg).connect(this.engineGain); this.whine.start();
        const b=c.createBuffer(1,c.sampleRate*2,c.sampleRate),data=b.getChannelData(0);
        for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
        const noise=c.createBufferSource(); noise.buffer=b; noise.loop=true;
        const nf=c.createBiquadFilter(); nf.type='bandpass'; nf.frequency.value=1100; nf.Q.value=.8;
        this.brakeGain=c.createGain(); this.brakeGain.gain.value=0; noise.connect(nf).connect(this.brakeGain).connect(this.master); noise.start();
        this.musicGain=c.createGain(); this.musicGain.gain.value=0; this.musicGain.connect(this.master);
        this.graphReady=true;
      }
      this.loadBuffers();
      if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') Promise.resolve(this.ctx.resume()).then(()=>this.update(this.lastInput)).catch(()=>this.unlockFiles());
      else this.update(this.lastInput);
    } catch (e) { console.warn('Procedural audio unavailable',e); this.unlockFiles(); }
  }

  update(input={}) {
    this.lastInput=input;
    let {speed=0,throttle=false,brake=false,boost=false,slip=0,drifting=false,running=false,dt=.016}=input;
    speed=finite(speed); slip=finite(slip); dt=Math.max(.01,finite(dt));
    const on=this.mode!=='off' && running;
    const v=clamp(Math.abs(speed)/75,0,1.3);
    const blend=1-Math.exp(-dt*6);
    this.smoothRate=(this.smoothRate??.75)+(.75+v*1.25+(throttle?.22:0)+(boost?.28:0)-(this.smoothRate??.75))*blend;
    const motorVolume=on?Math.min(.9,.34+v*.32+(throttle?.16:0)):0;
    const tyreVolume=on?Math.min(.7,(brake?v*.54:0)+Math.abs(slip)*.55+(drifting?.12:0)):0;
    const musicVolume=on&&this.mode==='all'?.12:0;
    if (this.files) {
      const [motor,tyre,music]=this.files;
      motor.playbackRate=this.smoothRate;
      for (const [a,target] of [[motor,motorVolume],[tyre,tyreVolume],[music,musicVolume]]) {
        a.volume=!on||this.ctx?.state==='running'?0:clamp(a.volume+(target-a.volume)*.25,0,1);
      }
    }
    const c=this.ctx;
    if (!this.graphReady || c?.state!=='running') return;
    const now=c.currentTime,accel=Math.max(0,(Math.abs(speed)-this.lastSpeed)/dt);
    this.lastSpeed=Math.abs(speed);
    const set=(p,x,t=.09)=>p.setTargetAtTime(x,now,t);
    for(const [i,target] of [motorVolume,tyreVolume,musicVolume].entries()){
      const b=this.buffers[i];if(!b)continue;
      set(b.gain.gain,target,.055);
      if(i===0)set(b.source.playbackRate,this.smoothRate,.08);
    }
    set(this.motor.frequency,60+v*145+(throttle?22:0)+(boost?35:0));
    set(this.whine.frequency,150+v*340+(throttle?55:0));
    set(this.filter.frequency,420+v*1050+(throttle?300:0));
    set(this.engineGain.gain,on&&!this.buffers[0]?(.14+v*.18+(throttle?.12:0)+Math.min(.04,accel*.001)):0);
    set(this.brakeGain.gain,on&&!this.buffers[1]?Math.min(.18,(brake?v*.14:0)+Math.abs(slip)*.20+(drifting?.05:0)):0,.04);
    const music=on&&this.mode==='all'&&!this.buffers[2];
    set(this.musicGain.gain,music?.075:0,.25);
    if(!music){this.nextNote=now+.1;return;}
    if(this.nextNote<now-.3)this.nextNote=now;
    while(this.nextNote<now+.13){this.playNote(this.nextNote,this.note++);this.nextNote+=.36;}
  }
  playNote(when,n){const c=this.ctx;const chords=[[48,55,60,64],[45,52,57,60],[41,48,53,57],[43,50,55,62]],chord=chords[Math.floor(n/8)%4];const midi=chord[[0,2,1,3,0,1,2,3][n%8]]+(n%8===3||n%8===7?12:0);const osc=c.createOscillator(),gain=c.createGain();osc.type='sine';osc.frequency.value=440*2**((midi-69)/12);gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(.28,when+.035);gain.gain.exponentialRampToValueAtTime(.001,when+.58);osc.connect(gain).connect(this.musicGain);osc.start(when);osc.stop(when+.65);osc.onended=()=>{osc.disconnect();gain.disconnect();};}
  cue(kind='pickup'){const c=this.ctx;if(!this.graphReady||!c||c.state!=='running'||this.mode==='off')return;const t=c.currentTime,osc=c.createOscillator(),g=c.createGain();osc.type='sine';osc.frequency.setValueAtTime(kind==='go'?440:kind==='hit'?140:620,t);osc.frequency.exponentialRampToValueAtTime(kind==='hit'?55:kind==='go'?880:960,t+.18);g.gain.setValueAtTime(.08,t);g.gain.exponentialRampToValueAtTime(.001,t+.24);osc.connect(g).connect(this.master);osc.start(t);osc.stop(t+.25);osc.onended=()=>{osc.disconnect();g.disconnect();};}
}
