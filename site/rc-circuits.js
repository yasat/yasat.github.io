/* Circuit configuration and a north-up (negative world Z) minimap. */
export const CIRCUITS={stadium:{name:'Ghanta RC Superstadium',pitCount:1},coastal:{name:'Coastal City Grand Prix',pitCount:2}};
export const coastalNodes=[[-680,180],[-680,-60],[-690,-300],[-530,-490],[-260,-510],[-40,-520],[160,-440],[320,-520],[560,-470],[675,-280],[675,-30],[590,140],[670,330],[510,520],[270,590],[70,520],[-160,590],[-380,480],[-520,360],[-650,310]];
export const coastalPits=[.075,.73];
export const coastalTunnels=[[.805,.900]];
export function circuitId(value){return Object.hasOwn(CIRCUITS,value)?value:'stadium';}
export function minimapProjection(points,width,height,padding=12){
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
  const minZ=Math.min(...points.map(p=>p.z)),maxZ=Math.max(...points.map(p=>p.z));
  const spanX=Math.max(1,maxX-minX),spanZ=Math.max(1,maxZ-minZ);
  const fit=Math.min((width-2*padding)/spanX,(height-2*padding)/spanZ);
  const cx=(width-spanX*fit)/2,cy=(height-spanZ*fit)/2;
  return p=>[cx+(p.x-minX)*fit,cy+(p.z-minZ)*fit];
}

// Open arch cross-section; the exterior is a mountain ridge with an empty driving bore.
export const tunnelInterior=[[-34,0],[-34,24],[-30,36],[-17,44],[0,47],[17,44],[30,36],[34,24],[34,0]];
export function mountainProfile(t){const h=0.70+0.30*Math.sin(Math.PI*t)+.08*Math.sin(t*Math.PI*5);return [[-78,0],[-67,24],[-52,65*h+16],[-27,107*h+12],[0,140*h+12],[28,112*h+12],[55,70*h+14],[68,27],[78,0]];}
