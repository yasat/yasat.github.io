/* Arcade RC handling: deterministic, frame-rate-independent bounded substeps.
 * Units are game-world units, not a calibrated real vehicle simulation. */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const damp=(a,b,k,dt)=>b+(a-b)*Math.exp(-k*dt);
const approach=(a,b,delta)=>a<b?Math.min(b,a+delta):Math.max(b,a-delta);
export function resetDrive(car){car.slip=0;car.yawRate=0;car.drifting=false;car.driftAmount=0;}
export function advanceDrive(car,keys,dt,{pitLane=false,offRoad=false,boosting=false,stats=[3.5,3.5,3.5,3.5],turbo=false,drafting=false,superGrip=false,slippery=false,slowed=false}={}){
    const [top,accel,handling,brake]=stats;
    const speedLimit=(offRoad?29:pitLane?35:69+(top-3.5)*4)*(offRoad||pitLane?1:slowed?.58:boosting||turbo?1.37:drafting?1.08:1);
    const throttle=car.fuel>0?Number(keys.up)-Number(keys.down):0;
    const grip=(offRoad?.48:pitLane?.87:1)*(1+(handling-3.5)*.13)*(superGrip?1.23:1)*(slippery?.55:1);
    const skill=clamp((handling-2)/3,0,1);
    const input=Number(!!keys.right)-Number(!!keys.left);
    // The handbrake breaks rear traction only at forward racing speed.
    // Holding it without steering still stops the car (including in the pits).
    const drift=!!keys.drift&&!keys.brake&&!pitLane&&!offRoad&&!slowed&&car.speed>18&&
        (input!==0||Math.abs(car.slip||0)>.12);
    const blend=car.driftAmount=damp(car.driftAmount||0,drift?1:0,drift?8:3.5+skill*5,dt);
    car.drifting=drift||blend>.18;
    if(keys.brake||(keys.drift&&!drift)){car.speed=approach(car.speed,0,85*(1+(brake-3.5)*.13)*(.60+.40*grip)*dt);}
    else if(drift){
        // Drifting trades speed for rotation; high handling carries momentum better.
        const loss=(13-7*skill)+(throttle>0?0:7);
        car.speed=approach(car.speed,0,loss*dt);
    }
    else if(throttle>0){
        const engine=(38+(accel-3.5)*4)*(.65+.35*grip)*(boosting||turbo?1.30:1)*(1-.58*clamp(Math.max(0,car.speed)/speedLimit,0,1));
        car.speed=car.speed<0?approach(car.speed,0,62*dt):car.speed+engine*dt;
    }else if(throttle<0){car.speed=car.speed>0?approach(car.speed,0,64*dt):Math.max(-19,car.speed-28*dt);}
    else car.speed=damp(car.speed,0,offRoad?2.1:pitLane?.72:.44,dt);
    if(car.speed>speedLimit)car.speed=approach(car.speed,speedLimit,56*dt);
    car.speed=clamp(car.speed,-19,105);
    if(Math.abs(car.speed)<.035)car.speed=0;
    const magnitude=Math.abs(car.speed);
    car.steer=damp(car.steer||0,input,input?7:9,dt);
    const maxAngle=(.52-.27*clamp(magnitude/85,0,1))*(1+(handling-3.5)*.09);
    car.steerAngle=car.steer*maxAngle;
    const wheelbase=25+magnitude*.24;
    const yawBoost=1+blend*(.32+.25*skill);
    const yawCap=.84*grip+blend*(.18+.10*skill);
    const desiredYaw=clamp(car.speed/wheelbase*Math.tan(car.steerAngle)*yawBoost,-yawCap,yawCap);
    car.yawRate=magnitude<.1?0:damp(car.yawRate||0,desiredYaw,9*grip*(1-blend*(.38-.19*skill)),dt);
    const normalSlip=clamp(-car.yawRate*magnitude*.0035/grip,-.19,.19);
    const driftSlip=clamp(-car.yawRate*magnitude*.012*(1.65-1.0*skill),-.64,.64);
    const slipTarget=normalSlip*(1-blend)+driftSlip*blend;
    const recovery=drift?4+3*skill:7*grip+blend*skill*5;
    car.slip=magnitude<.1?0:damp(car.slip||0,slipTarget,recovery,dt);
    const headingStep=car.yawRate*dt,mid=car.heading+headingStep*.5+car.slip;
    const step=car.speed*dt;
    car.x+=Math.sin(mid)*step;car.z-=Math.cos(mid)*step;car.heading+=headingStep;
    return {step,speedMagnitude:magnitude};
}
