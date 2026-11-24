/* Garage & Rivals: pure rules shared by the lobby, host and driving model. */
export const ATTRIBUTES=['Top speed','Acceleration','Handling','Braking'];
export const CARS={
 apex:{name:'Apex',description:'Adaptable all-rounder',stats:[3.5,3.5,3.5,3.5],limits:[[2,5],[2,5],[2,5],[2,5]]},
 velocity:{name:'Velocity',description:'Straight-line specialist',stats:[5,4,2,3],limits:[[3.5,5],[2.5,5],[2,3.5],[2,4]]},
 switchback:{name:'Switchback',description:'Cornering specialist',stats:[3,4,5,2],limits:[[2,4],[2.5,5],[3.5,5],[2,3.5]]},
 volt:{name:'Volt',description:'Acceleration specialist',stats:[3,5,2,4],limits:[[2,4.5],[3.5,5],[2,3.5],[2.5,5]]},
 sentinel:{name:'Sentinel',description:'Braking specialist',stats:[4,2,3,5],limits:[[2.5,5],[2,3.5],[2,4.5],[3.5,5]]}
};
export const PAINTS=['#dbf169','#ff8871','#64cce2','#f4bf73','#c4a4fb','#f5e3c2','#586b72','#84f3ae'];
export const MODES={arcade:'Arcade Grand Prix',clean:'Clean Grand Prix',pro:'Pro Grand Prix'};
export const ITEMS={turbo:'Turbo Boost',bomb:'Homing Bomb',shield:'Energy Shield',oil:'Oil Slick',grip:'Super Grip',recharge:'Nitro Recharge'};
export const RESPAWN_MS=10000;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function validStats(chassis,stats){return Object.hasOwn(CARS,chassis)&&Array.isArray(stats)&&stats.length===4&&stats.every((v,i)=>Number.isFinite(v)&&Number.isInteger(v*2)&&v>=CARS[chassis].limits[i][0]&&v<=CARS[chassis].limits[i][1])&&stats.reduce((a,b)=>a+b,0)===14;}
export function transferCost(before,after){return after.reduce((sum,v,i)=>sum+Math.max(0,v-before[i]),0);}
export function preTune(chassis,gear=0,suspension=0){const c=CARS[chassis]||CARS.apex,s=[...c.stats];for(const [i,j,n] of [[0,1,gear],[2,3,suspension]]){const d=clamp(Math.round(clamp(Number(n)||0,-2,2))*.5,Math.max(c.limits[i][0]-s[i],s[j]-c.limits[j][1]),Math.min(c.limits[i][1]-s[i],s[j]-c.limits[j][0]));s[i]+=d;s[j]-=d;}return s;}
export function config(input={}){const chassis=Object.hasOwn(CARS,input?.chassis)?input.chassis:'apex',colour=PAINTS.includes(input?.colour)?input.colour:PAINTS[0];const gear=clamp(Math.round(Number(input?.gear)||0),-2,2),suspension=clamp(Math.round(Number(input?.suspension)||0),-2,2);return {chassis,colour,gear,suspension,stats:preTune(chassis,gear,suspension)};}
export function mode(value){return Object.hasOwn(MODES,value)?value:'arcade';}
export function pickItem(gap=0,hasOpponent=true,random=Math.random){const ids=hasOpponent?Object.keys(ITEMS):['turbo','grip','recharge'];return ids[Math.floor(clamp(random(),0,.999999)*ids.length)];}
export function newRecord(setup){return {setup:config(setup),held:null,credits:0,rep:0,earned:0,spent:0,lap:0,lapCredits:0,combatCredits:0,events:new Set(),overtakes:0,defences:0,attacks:0,incidents:0,best:Infinity,clean:0,comeback:0,effects:{},lastPitLap:-1,serviceUntil:0,startedLapAt:0};}
export function award(record,key,category='drive'){if(record.events.has(key)||record.lapCredits>=3||(category==='combat'&&record.combatCredits>=1)||record.rep>=3)return false;record.events.add(key);record.lapCredits++;if(category==='combat')record.combatCredits++;record.credits++;if(record.credits>=3){record.credits-=3;const gain=Math.min(1,3-record.rep);record.rep+=gain;record.earned+=gain;}return true;}
export function nextLap(record,lap){if(lap<=record.lap)return false;record.lap=lap;record.lapCredits=0;record.combatCredits=0;record.events.clear();return true;}
export function tune(record,stats,lap,now){if(!validStats(record.setup.chassis,stats)||record.lastPitLap===lap||now<record.serviceUntil)return false;const cost=transferCost(record.setup.stats,stats);if(cost<=0||cost>Math.min(2,record.rep))return false;record.rep-=cost;record.spent+=cost;record.setup.stats=[...stats];record.lastPitLap=lap;record.serviceUntil=now+2000;return true;}
export function claimBox(readyAt,record,index,now,gap,hasOpponent,random){if(record.held||!Number.isInteger(index)||index<0||index>=readyAt.length||readyAt[index]>now)return null;const item=pickItem(gap,hasOpponent,random);readyAt[index]=now+RESPAWN_MS;record.held=item;return item;}
export function draftEligible(car,other){const dx=other.x-car.x,dz=other.z-car.z,d=Math.hypot(dx,dz);return d>9&&d<85&&car.speed>28&&other.speed>25&&(dx*Math.sin(car.heading)-dz*Math.cos(car.heading))/d>.94&&Math.cos(car.heading-other.heading)>.94;}
