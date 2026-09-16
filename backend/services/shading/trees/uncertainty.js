import {createHash} from 'node:crypto';

// Sensitivity scenarios, NOT a site-calibrated confidence interval. Opacity is
// applied once per blocked sightline, never once per arbitrary tree segment.
// Whole-crown literature constrains plausibility but does not measure these trees.
export const OPACITY_PROFILES={
  low:{label:'Basse · couvert plus transparent',monthly:[.45,.45,.45,.65,.80,.80,.80,.80,.80,.65,.45,.45]},
  central:{label:'Centrale · feuillus denses en été',monthly:[.55,.55,.55,.75,.95,.95,.95,.95,.95,.75,.55,.55]},
  high:{label:'Haute · couvert dense persistant',monthly:Array(12).fill(.98)},
};
export function applyOpacity(result,key){
  const profile=OPACITY_PROFILES[key];if(!profile)throw Error('Profil optique inconnu');
  const months=result.months.map(m=>({...m,lost:m.lost*profile.monthly[m.month-1],lossPercent:m.lossPercent*profile.monthly[m.month-1]}));
  const hourly=result.hourly.map(h=>{const op=profile.monthly[new Date(h.time).getUTCMonth()];return {...h,directLost:h.directLost*op,diffuseLost:h.diffuseLost*op,lost:h.lost*op};});
  const hours=result.hours.map(h=>{const rows=hourly.filter(r=>new Date(r.time).getUTCHours()===h.hourUTC),lost=rows.reduce((s,r)=>s+r.lost,0);return {...h,lost,lossPercent:h.baseline?100*lost/h.baseline:null};});
  const panels=result.panels.map(p=>{
    if(!p.monthly)throw Error('Recalcul nécessaire pour les opacités saisonnières');
    const directLost=p.monthly.reduce((s,m,i)=>s+m.directLost*profile.monthly[i],0),diffuseLost=p.monthly.reduce((s,m,i)=>s+m.diffuseLost*profile.monthly[i],0);
    return {...p,geometricSkyBlocked:p.diffuseBlocked,diffuseBlocked:p.diffuseLost>0?p.diffuseBlocked*diffuseLost/p.diffuseLost:0,monthly:p.monthly.map((m,i)=>({...m,directLost:m.directLost*profile.monthly[i],diffuseLost:m.diffuseLost*profile.monthly[i]})),directLost,diffuseLost,lost:directLost+diffuseLost,lossPercent:100*(directLost+diffuseLost)/p.baseline};
  });
  const lost=hourly.reduce((s,h)=>s+h.lost,0),direct=hourly.reduce((s,h)=>s+h.directLost,0),diffuse=hourly.reduce((s,h)=>s+h.diffuseLost,0);
  return {...result,months,hours,hourly,panels,lossPercent:100*lost/(result.baselineKwhM2*1000),lostKwhM2:lost/1000,directLostKwhM2:direct/1000,diffuseLostKwhM2:diffuse/1000,opaqueLossPercent:result.lossPercent,opacityProfile:{key,...profile},hash:createHash('sha256').update(result.hash+JSON.stringify(profile)).digest('hex')};
}
export function withUncertainty(opaque){
  const variants=Object.fromEntries(Object.keys(OPACITY_PROFILES).map(k=>[k,applyOpacity(opaque,k)]));
  return {...variants.central,uncertainty:{low:variants.low.lossPercent,central:variants.central.lossPercent,high:variants.high.lossPercent,opaque:opaque.lossPercent,kind:'scenario_range_not_confidence_interval',note:'Espèces et transmission non mesurées sur place ; géométrie hivernale inchangée. La végétation estivale peut dépasser cette enveloppe.',sources:['https://doi.org/10.1007/s00704-013-1000-3','https://real.mtak.hu/37182/7/trees_2016_HGB_65_Takacs_et_al_u.pdf']}};
}
