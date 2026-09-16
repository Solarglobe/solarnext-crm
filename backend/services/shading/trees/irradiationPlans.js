/** PVGIS needs the measured orientation of each populated roof, in geographic north. */
export function irradiationPlans(scene){
 const ids=[...new Set(scene.panels.map(p=>p.roofId))];
 if(!ids.length)throw Error('Aucun panneau à analyser');
 const [nx,ny]=scene.origin.north||[0,1];
 return ids.map(id=>{
  const roof=scene.roofs.find(r=>r.id===id);
  if(!roof||!roof.plane?.every(Number.isFinite))throw Error('Plan de toiture introuvable : '+id);
  const [a,b]=roof.plane,tilt=Math.atan(Math.hypot(a,b))*180/Math.PI;
  const east=-a*ny+b*nx,north=-a*nx-b*ny;
  const azimuth=Math.atan2(east,north)*180/Math.PI;
  return {roofId:id,tilt,aspect:((azimuth-180+540)%360)-180};
 });
}
