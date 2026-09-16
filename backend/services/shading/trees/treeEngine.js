import {rayHitsPrism} from './prism.js';
import { createHash } from 'node:crypto';
import solar from '../../../../shared/shading/solarPosition.cjs';
import { crownBoxes,rayHitsBox } from '../../../../shared/shading/treeGeometry.mjs';
export { crownBoxes,rayHitsBox } from '../../../../shared/shading/treeGeometry.mjs';

export const MODEL = 'trees-lidar-columns-hourly-v1';
const rad = Math.PI / 180;
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a => Math.hypot(...a);

export function validateScene(scene) {
  if(scene.roofSurveyRequired)throw Error('Altitude du toit non renseignée : relevé manuel nécessaire, aucun résultat autorisé');
  if (!scene?.origin || !Number.isFinite(scene.origin.lat) || !Number.isFinite(scene.origin.lon) || !Array.isArray(scene.panels) || !scene.panels.length) throw Error('Géométrie géolocalisée des panneaux manquante');
  if(scene.sampleGrid!==undefined && (!Number.isInteger(scene.sampleGrid)||scene.sampleGrid<2||scene.sampleGrid>16))throw Error('Échantillonnage panneau invalide');
  if (!Array.isArray(scene.trees) || scene.trees.length>2000) throw Error('Scène de végétation invalide');
  for (const t of scene.trees) {
    if(t.prism&&(!Array.isArray(t.prism.polygon)||t.prism.polygon.length<3||!t.prism.polygon.every(p=>p.length===2&&p.every(Number.isFinite))||t.prism.plane?.length!==3||!t.prism.plane.every(Number.isFinite)||!(t.prism.height>0)))throw Error('Prisme obstacle invalide');
    if (![t.x,t.y,t.groundZ,t.height,t.diameter,t.crownBottom].every(Number.isFinite) || t.height<=0 || t.height>80 || t.diameter<=0 || t.diameter>60 || t.crownBottom<0 || t.crownBottom>=t.height) throw Error('Hauteur ou couronne invalide : '+t.id);
    if(t.columns && (!Array.isArray(t.columns) || t.columns.length>2500 || ![t.measuredHeight,t.measuredDiameter,t.measuredCrownBottom,t.cellSize].every(Number.isFinite) || t.measuredHeight<=t.measuredCrownBottom || t.measuredDiameter<=0 || t.cellSize<=0 || !t.columns.every(c=>c.length===4&&c.every(Number.isFinite)&&c[3]>c[2])))throw Error('Colonnes LiDAR invalides');
  }
  for (const p of scene.panels) if (p.polygon?.length!==4 || !p.polygon.every(q=>q.length===3 && q.every(Number.isFinite))) throw Error('Polygone panneau incomplet');
  if (!scene.trees.some(t=>t.enabled!==false) && scene.emptySceneAttested!==true) throw Error('Scène vide non attestée : résultat non évalué');
}

export function sunVector(scene,date) {
  const sun=solar.computeSunPosition(new Date(date),scene.origin.lat,scene.origin.lon);
  if (!sun) throw Error('Date solaire invalide');
  const [nx,ny]=scene.origin.north || [0,1];
  const e=Math.sin(sun.azimuthDeg*rad)*Math.cos(sun.elevationDeg*rad),n=Math.cos(sun.azimuthDeg*rad)*Math.cos(sun.elevationDeg*rad);
  return {...sun, vector:[e*ny+n*nx,-e*nx+n*ny,Math.sin(sun.elevationDeg*rad)]};
}

export function rayHitsCrown(p,d,t) {
  // Analytic intersection with an ellipsoid, including origins within a crown.
  const rz=(t.height-t.crownBottom)/2,r=t.diameter/2;
  const o=[(p[0]-t.x)/r,(p[1]-t.y)/r,(p[2]-t.groundZ-t.crownBottom-rz)/rz];
  const v=[d[0]/r,d[1]/r,d[2]/rz];
  const a=dot(v,v),b=dot(o,v),c=dot(o,o)-1,disc=b*b-a*c;
  return disc>=0 && (-b+Math.sqrt(disc))/a>1e-5;
}

function panelSamples(p,n=4) {
  const [a,b,c,d]=p.polygon;const points=[];
  for(let i=0;i<n;i++)for(let j=0;j<n;j++) {
    const u=(i+.5)/n,v=(j+.5)/n;
    points.push(a.map((x,k)=>x*(1-u)*(1-v)+b[k]*u*(1-v)+c[k]*u*v+d[k]*(1-u)*v));
  }
  let normal=cross(sub(b,a),sub(d,a));if(normal[2]<0)normal=normal.map(v=>-v);
  const area=norm(normal);if(area<.1)throw Error('Surface de panneau dégénérée');
  return {id:p.id,points,normal:normal.map(v=>v/area),area};
}

function prepareTrees(scene){return scene.trees.filter(t=>t.enabled!==false).map(t=>{
  const boxes=crownBoxes(t);let center=[t.x,t.y,t.groundZ+(t.height+t.crownBottom)/2],radius=Math.max(t.diameter/2,(t.height-t.crownBottom)/2);
  if(boxes?.length){const min=[0,1,2].map(i=>Math.min(...boxes.map(b=>b[i]))),max=[3,4,5].map(i=>Math.max(...boxes.map(b=>b[i])));center=min.map((x,i)=>(x+max[i])/2);radius=norm(sub(max,min))/2;}
  if(t.prism){const pts=t.prism.polygon.flatMap(([x,y])=>{const z=t.prism.plane[0]*x+t.prism.plane[1]*y+t.prism.plane[2];return [[x,y,z],[x,y,z+t.prism.height]];});const min=[0,1,2].map(i=>Math.min(...pts.map(p=>p[i]))),max=[0,1,2].map(i=>Math.max(...pts.map(p=>p[i])));center=min.map((x,i)=>(x+max[i])/2);radius=norm(sub(max,min))/2;}
  return {...t,boxes,boundCenter:center,boundRadius:radius};
});}

function blockedFraction(panel,d,trees,audit) {
  const center=panel.points[0];
  // Reject crowns whose enclosing sphere cannot meet any ray from the module.
  const candidates=trees.filter(t=>{
    const v=sub(t.boundCenter,center);
    const along=dot(v,d),r=t.boundRadius+3;
    return along>-r && dot(v,v)-Math.max(0,along)**2<r*r;
  });
  if(!candidates.length)return 0;
  const hits=(p,t)=>t.prism?rayHitsPrism(p,d,t.prism):t.boxes?t.boxes.some(b=>rayHitsBox(p,d,b)):rayHitsCrown(p,d,t);
  if(!audit)return panel.points.filter(p=>candidates.some(t=>hits(p,t))).length/panel.points.length;
  let blocked=0;
  for(const p of panel.points){let sole=null,multiple=false;for(const t of candidates){if(!hits(p,t))continue;if(sole){multiple=true;break;}sole=t.id;}if(sole){blocked++;if(!multiple)audit.totals[sole]=(audit.totals[sole]||0)+audit.weight/panel.points.length;}}
  return blocked/panel.points.length;
}

export function instantaneous(scene,date) {
  validateScene(scene);const sun=sunVector(scene,date),trees=prepareTrees(scene);
  return {...sun,panels:scene.panels.map(p=>({id:p.id,shade:sun.elevationDeg>0?blockedFraction(panelSamples(p),sun.vector,trees):null}))};
}

function diffuseLoss(panel,trees,audit,bins=[10,48]) {
  // Isotropic sky integral: equally spaced azimuth and sin(elevation), weighted
  // by panel incidence. Direct irradiance remains hourly and directional.
  let lost=0,total=0;const directions=[];
  for(let i=0;i<bins[0];i++)for(let j=0;j<bins[1];j++){
    const z=(i+.5)/bins[0],a=(j+.5)*Math.PI*2/bins[1];
    const d=[Math.cos(a)*Math.sqrt(1-z*z),Math.sin(a)*Math.sqrt(1-z*z),z];
    const weight=Math.max(0,dot(panel.normal,d));total+=weight;directions.push({d,weight});
  }
  for(const {d,weight} of directions)lost+=weight*blockedFraction(panel,d,trees,audit?{totals:audit.totals,weight:audit.weight*weight/total}:null);
  return lost/total;
}

export function calculateAnnual(scene,irradiation,options={}) {
  validateScene(scene);const hourly=irradiation.outputs?.hourly;
  if(!Array.isArray(hourly) || hourly.length<8760)throw Error('Irradiation horaire annuelle incomplète');
  const location=irradiation.inputs?.location;
  if(!location || Math.abs(location.latitude-scene.origin.lat)>.001 || Math.abs(location.longitude-scene.origin.lon)>.001 || ![location.latitude,location.longitude].every(Number.isFinite))throw Error('Irradiation non rattachée à ce bâtiment');
  const trees=prepareTrees(scene),panels=scene.panels.map(p=>panelSamples(p,scene.sampleGrid||4));
  if(panels.some(p=>dot(p.normal,panels[0].normal)<Math.cos(.5*rad)))throw Error('Plusieurs orientations : séries horaires distinctes nécessaires pour chaque pan');
  const skyBins=options.skyBins||[10,48];if(skyBins.length!==2||!skyBins.every(n=>Number.isInteger(n)&&n>=2&&n<=192))throw Error('Échantillonnage ciel invalide');
  const directMarginal={},diffuseMarginal={};const totalArea=panels.reduce((s,p)=>s+p.area,0),skyAnnual=hourly.reduce((s,r)=>s+r['Gd(i)'],0);
  const diffuse=panels.map(p=>diffuseLoss(p,trees,options.attribution?{totals:diffuseMarginal,weight:skyAnnual*p.area/totalArea}:null,skyBins));
  const totals=panels.map(p=>({id:p.id,baseline:0,lost:0,directLost:0,diffuseLost:0,shadedHours:0,monthly:Array.from({length:12},()=>({baseline:0,directLost:0,diffuseLost:0}))}));
  const months=Array.from({length:12},(_,i)=>({month:i+1,baseline:0,lost:0}));
  const hours=Array.from({length:24},(_,i)=>({hourUTC:i,baseline:0,lost:0}));
  const records=[];const seen=new Set();let previous=null,year=null;
  for(const row of hourly){
    if(!/^\d{8}:\d{4}$/.test(row.time))throw Error('Horodatage d’irradiation invalide');
    const [date,time]=row.time.split(':');const stamp=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${time.slice(0,2)}:${time.slice(2,4)}:00Z`;
    const ms=Date.parse(stamp);if(!Number.isFinite(ms)||(previous!==null&&ms-previous!==3600000)||(year!==null&&year!==date.slice(0,4)))throw Error('Chronologie horaire incomplète');previous=ms;year=date.slice(0,4);
    if(seen.has(stamp))throw Error('Heure d’irradiation dupliquée');seen.add(stamp);
    const beam=row['Gb(i)'],sky=row['Gd(i)'],ground=row['Gr(i)'];
    if(![beam,sky,ground].every(v=>Number.isFinite(v)&&v>=0))throw Error('Composante d’irradiation invalide');
    const baseline=beam+sky+ground;if(!baseline)continue;
    const sun=sunVector(scene,stamp),month=Number(date.slice(4,6))-1,hour=Number(time.slice(0,2));
    let weightedLoss=0,weightedDirect=0,weightedDiffuse=0,area=0;
    for(let i=0;i<panels.length;i++){
      const shade=sun.elevationDeg>0?blockedFraction(panels[i],sun.vector,trees,options.attribution?{totals:directMarginal,weight:beam*panels[i].area/totalArea}:null):0;
      const directLost=beam*shade,diffuseLost=sky*diffuse[i],loss=directLost+diffuseLost;
      Object.assign(totals[i],{baseline:totals[i].baseline+baseline,lost:totals[i].lost+loss,directLost:totals[i].directLost+directLost,diffuseLost:totals[i].diffuseLost+diffuseLost,shadedHours:totals[i].shadedHours+(shade>0&&beam>0?1:0)});
      totals[i].monthly[month].baseline+=baseline;totals[i].monthly[month].directLost+=directLost;totals[i].monthly[month].diffuseLost+=diffuseLost;
      weightedLoss+=loss*panels[i].area;area+=panels[i].area;
      weightedDirect+=directLost*panels[i].area;weightedDiffuse+=diffuseLost*panels[i].area;
    }
    const loss=weightedLoss/area;
    months[month].baseline+=baseline;months[month].lost+=loss;hours[hour].baseline+=baseline;hours[hour].lost+=loss;
    records.push({time:stamp,irradiance:baseline,lost:loss,directLost:weightedDirect/area,diffuseLost:weightedDiffuse/area});
  }
  const expectedHours=(Date.UTC(Number(year)+1,0,1)-Date.UTC(Number(year),0,1))/3600000;
  if(hourly.length!==expectedHours || !hourly[0].time.startsWith(year+'0101:00') || !hourly.at(-1).time.startsWith(year+'1231:23'))throw Error('Année d’irradiation incomplète');
  const baseline=months.reduce((s,m)=>s+m.baseline,0),lost=months.reduce((s,m)=>s+m.lost,0);
  if(baseline<=0)throw Error('Irradiation annuelle nulle');
  if(lost===0 && scene.emptySceneAttested!==true)throw Error('Aucun impact mesuré : vérifier et attester la scène avant de conclure à 0 %');
  const hash=createHash('sha256').update(JSON.stringify({scene,irradiation,model:MODEL,skyBins})).digest('hex');
  const attribution=options.attribution?trees.map(t=>({id:t.id,directKwhM2:(directMarginal[t.id]||0)/1000,diffuseKwhM2:(diffuseMarginal[t.id]||0)/1000,removalPercentagePoints:100*((directMarginal[t.id]||0)+(diffuseMarginal[t.id]||0))/baseline})).sort((a,b)=>b.removalPercentagePoints-a.removalPercentagePoints):undefined;
  return {status:'computed',model:MODEL,hash,calculatedAt:new Date().toISOString(),lossPercent:100*lost/baseline,baselineKwhM2:baseline/1000,lostKwhM2:lost/1000,panels:totals.map((p,i)=>({...p,lossPercent:100*p.lost/p.baseline,diffuseBlocked:diffuse[i]})),months:months.map(m=>({...m,lossPercent:m.baseline?100*m.lost/m.baseline:null})),hours:hours.map(m=>({...m,lossPercent:m.baseline?100*m.lost/m.baseline:null})),hourly:records,irradiation:irradiation.inputs,treeCount:trees.length,sampleGrid:scene.sampleGrid||4,skyBins,attribution};
}
