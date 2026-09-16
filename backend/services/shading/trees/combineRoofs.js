import {createHash} from 'node:crypto';

function panelArea(p){
 const [a,b,,d]=p.polygon,u=b.map((v,i)=>v-a[i]),v=d.map((x,i)=>x-a[i]);
 return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);
}
/** Aggregate energy, never average roof percentages. Every ray still uses the
 * original engine, with the irradiation series of its own measured roof. */
export function combineRoofs(scene,irradiation,reference,calculate,options){
 const groups=[...new Set(scene.panels.map(p=>p.roofId))].map(id=>{
  if(!irradiation.byRoof[id]||!reference?.byRoof?.[id])throw Error('Irradiation manquante pour le pan '+id);
  const panels=scene.panels.filter(p=>p.roofId===id),area=panels.reduce((n,p)=>n+panelArea(p),0);
  return {id,area,r:calculate({...scene,panels},irradiation.byRoof[id],reference.byRoof[id],options)};
 });
 if(groups.length===1)return {...groups[0].r,irradiationByRoof:{[groups[0].id]:groups[0].r.irradiation}};
 const area=groups.reduce((s,g)=>s+g.area,0),first=groups[0].r;
 const weighted=fn=>groups.reduce((n,g)=>n+g.area*fn(g.r),0)/area;
 const baseline=weighted(r=>r.baselineKwhM2),percent=fn=>weighted(r=>r.baselineKwhM2*fn(r))/baseline;
 const rows=(key,id,fields)=>first[key].map((row,i)=>{
  if(groups.some(g=>g.r[key][i]?.[id]!==row[id]))throw Error('Chronologies différentes entre pans');
  const out={[id]:row[id]};for(const field of fields)out[field]=weighted(r=>r[key][i][field]);
  if(out.baseline!==undefined)out.lossPercent=out.baseline?100*out.lost/out.baseline:0;
  return out;
 });
 const months=rows('months','month',['baseline','lost','horizonLost','nearLost']);
 return {...first,
  hash:createHash('sha256').update(JSON.stringify(groups.map(g=>[g.id,g.area,g.r.hash]))).digest('hex'),
  lossPercent:percent(r=>r.lossPercent),baselineKwhM2:baseline,
  lostKwhM2:weighted(r=>r.lostKwhM2),directLostKwhM2:weighted(r=>r.directLostKwhM2),diffuseLostKwhM2:weighted(r=>r.diffuseLostKwhM2),
  opaqueLossPercent:percent(r=>r.opaqueLossPercent),
  months,hours:rows('hours','hourUTC',['baseline','lost']),
  hourly:rows('hourly','time',['irradiance','lost','directLost','diffuseLost']),
  panels:groups.flatMap(g=>g.r.panels.map(p=>({...p,roofId:g.id}))),
  components:Object.fromEntries(['trees','obstacles','horizon'].map(k=>[k,{lossPercent:percent(r=>r.components[k].lossPercent)}])),
  uncertainty:{...first.uncertainty,...Object.fromEntries(['low','central','high','opaque'].map(k=>[k,percent(r=>r.uncertainty[k])]))},
  irradiationByRoof:Object.fromEntries(groups.map(g=>[g.id,g.r.irradiation])),
  energyReference:{horizonAlreadyApplied:true,additionalMonthlyFactors:months.map(m=>m.baseline>m.horizonLost?Math.max(0,1-m.nearLost/(m.baseline-m.horizonLost)):1)}
 };
}
