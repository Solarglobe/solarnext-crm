import {calculateAnnual} from './treeEngine.js';
import {applyOpacity,withUncertainty} from './uncertainty.js';
import {createHash} from 'node:crypto';
const zero=(r)=>({...r,lossPercent:0,lostKwhM2:0,months:r.months.map(m=>({...m,lost:0,lossPercent:0})),hours:r.hours.map(h=>({...h,lost:0,lossPercent:0})),hourly:r.hourly.map(h=>({...h,lost:0,directLost:0,diffuseLost:0})),panels:r.panels.map(p=>({...p,lost:0,directLost:0,diffuseLost:0,diffuseBlocked:0,monthly:p.monthly.map(m=>({...m,directLost:0,diffuseLost:0}))}))});
const diff=(a,b)=>Math.max(0,a-b);
function canopyOnly(union,opaque){return {...union,hash:union.hash+opaque.hash,
 months:union.months.map((m,i)=>({...m,lost:diff(m.lost,opaque.months[i].lost),lossPercent:100*diff(m.lost,opaque.months[i].lost)/(m.baseline||1)})),
 hourly:union.hourly.map((h,i)=>({...h,lost:diff(h.lost,opaque.hourly[i].lost),directLost:diff(h.directLost,opaque.hourly[i].directLost),diffuseLost:diff(h.diffuseLost,opaque.hourly[i].diffuseLost)})),
 panels:union.panels.map((p,i)=>({...p,directLost:diff(p.directLost,opaque.panels[i].directLost),diffuseLost:diff(p.diffuseLost,opaque.panels[i].diffuseLost),diffuseBlocked:diff(p.diffuseBlocked,opaque.panels[i].diffuseBlocked),monthly:p.monthly.map((m,j)=>({...m,directLost:diff(m.directLost,opaque.panels[i].monthly[j].directLost),diffuseLost:diff(m.diffuseLost,opaque.panels[i].monthly[j].diffuseLost)}))}))};}
function stamp(row){const [d,t]=row.time.split(':');return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2)}:00Z`;}
/** Union is evaluated on the original engine's rays, hours and panel samples.
 * Solid masks win; seasonal opacity applies only to rays not already blocked by
 * a solid obstacle. Terrain is applied in PVGIS before these near-field rays. */
export function calculateCombined(scene,irradiation,reference,{grid=8,skyBins=[20,96]}={}){
 if(!reference?.outputs?.hourly||reference.outputs.hourly.length!==irradiation.outputs.hourly.length)throw Error('Référence horaire sans horizon indisponible');
 const loc=reference.inputs?.location;if(!loc||Math.abs(loc.latitude-scene.origin.lat)>.001||Math.abs(loc.longitude-scene.origin.lon)>.001)throw Error('Référence horaire hors site');
 const solids=(scene.opaqueObstacles||[]).map(p=>({id:p.id,x:p.polygon[0][0],y:p.polygon[0][1],groundZ:0,height:1,diameter:1,crownBottom:0,prism:p}));
 const args={...scene,sampleGrid:grid,emptySceneAttested:true};
 const union=calculateAnnual({...args,trees:[...scene.trees,...solids]},irradiation,{skyBins});
 const opaque=solids.length?calculateAnnual({...args,trees:solids},irradiation,{skyBins}):zero(union);
 const canopy=canopyOnly(union,opaque),horizonMonths=Array.from({length:12},()=>({baseline:0,direct:0,diffuse:0,lost:0}));
 const horizon=reference.outputs.hourly.map((n,i)=>{const h=irradiation.outputs.hourly[i];if(n.time!==h.time)throw Error('Chronologies PVGIS différentes');const vals=[n['Gb(i)'],n['Gd(i)'],n['Gr(i)'],h['Gb(i)'],h['Gd(i)'],h['Gr(i)']];if(!vals.every(v=>Number.isFinite(v)&&v>=0))throw Error('Irradiation incomplète');const baseline=vals[0]+vals[1]+vals[2],kept=vals[3]+vals[4]+vals[5];if(kept>baseline+1)throw Error('Références PVGIS incohérentes');const lost=Math.max(0,baseline-kept),direct=Math.min(lost,diff(vals[0],vals[3])),diffuse=lost-direct,time=stamp(n),month=new Date(time).getUTCMonth();const m=horizonMonths[month];m.baseline+=baseline;m.direct+=direct;m.diffuse+=diffuse;m.lost+=lost;return {time,baseline,lost,direct,diffuse};});
 const totalBaseline=horizonMonths.reduce((s,m)=>s+m.baseline,0);if(!(totalBaseline>0))throw Error('Irradiation de référence nulle');
 function combine(tree){const treeMap=new Map(tree.hourly.map(h=>[h.time,h])),solidMap=new Map(opaque.hourly.map(h=>[h.time,h]));
  const hourly=horizon.map(h=>{const t=treeMap.get(h.time),o=solidMap.get(h.time),directLost=h.direct+(t?.directLost||0)+(o?.directLost||0),diffuseLost=h.diffuse+(t?.diffuseLost||0)+(o?.diffuseLost||0);const lost=directLost+diffuseLost;if(lost>h.baseline+1e-6)throw Error('Masques combinés supérieurs à l’irradiation');return {time:h.time,irradiance:h.baseline,lost,directLost,diffuseLost};});
  const months=horizonMonths.map((h,i)=>{const lost=h.lost+tree.months[i].lost+opaque.months[i].lost;return {month:i+1,baseline:h.baseline,lost,horizonLost:h.lost,nearLost:tree.months[i].lost+opaque.months[i].lost,lossPercent:h.baseline?100*lost/h.baseline:0};});
  const panels=tree.panels.map((p,i)=>{const monthly=p.monthly.map((m,j)=>({baseline:horizonMonths[j].baseline,directLost:m.directLost+opaque.panels[i].monthly[j].directLost+horizonMonths[j].direct,diffuseLost:m.diffuseLost+opaque.panels[i].monthly[j].diffuseLost+horizonMonths[j].diffuse})),directLost=monthly.reduce((s,m)=>s+m.directLost,0),diffuseLost=monthly.reduce((s,m)=>s+m.diffuseLost,0);return {...p,baseline:totalBaseline,directLost,diffuseLost,lost:directLost+diffuseLost,lossPercent:100*(directLost+diffuseLost)/totalBaseline,monthly};});
  const hours=Array.from({length:24},(_,hourUTC)=>{const rows=hourly.filter(h=>new Date(h.time).getUTCHours()===hourUTC),baseline=rows.reduce((s,h)=>s+h.irradiance,0),lost=rows.reduce((s,h)=>s+h.lost,0);return {hourUTC,baseline,lost,lossPercent:baseline?100*lost/baseline:0};});
  const lost=hourly.reduce((s,h)=>s+h.lost,0);return {...tree,scope:'combined-shading-v1',hourly,months,panels,hours,lossPercent:100*lost/totalBaseline,baselineKwhM2:totalBaseline/1000,lostKwhM2:lost/1000,directLostKwhM2:hourly.reduce((s,h)=>s+h.directLost,0)/1000,diffuseLostKwhM2:hourly.reduce((s,h)=>s+h.diffuseLost,0)/1000,treeCount:scene.trees.filter(t=>t.enabled!==false).length,
   components:{trees:{lossPercent:100*tree.lostKwhM2*1000/totalBaseline},obstacles:{lossPercent:100*opaque.lostKwhM2*1000/totalBaseline},horizon:{lossPercent:100*horizonMonths.reduce((s,m)=>s+m.lost,0)/totalBaseline}},
   energyReference:{horizonAlreadyApplied:true,additionalMonthlyFactors:tree.months.map((m,i)=>{const baseline=union.months[i].baseline;return baseline?Math.max(0,1-(m.lost+opaque.months[i].lost)/baseline):1;})}};
 }
 const variants=Object.fromEntries(['low','central','high'].map(k=>[k,combine(applyOpacity(canopy,k))]));const result=variants.central;
 result.uncertainty={...withUncertainty(canopy).uncertainty,low:variants.low.lossPercent,central:result.lossPercent,high:variants.high.lossPercent,opaque:100*(union.lostKwhM2*1000+horizonMonths.reduce((s,m)=>s+m.lost,0))/totalBaseline,kind:'scenario_range_not_confidence_interval'};
 result.opaqueLossPercent=result.uncertainty.opaque;
 result.hash=createHash('sha256').update(JSON.stringify({scene,irradiation,reference,grid,skyBins,profile:result.opacityProfile,scope:result.scope})).digest('hex');return result;
}
