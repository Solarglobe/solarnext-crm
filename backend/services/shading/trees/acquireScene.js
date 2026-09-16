import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here=path.dirname(fileURLToPath(import.meta.url));
async function python(script,args,input) {
  return new Promise((resolve,reject)=>{
    const p=spawn(process.env.TREE_PYTHON||'python',[path.join(here,script),...args],{windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    const deadline=setTimeout(()=>{p.kill();reject(Error('Acquisition IGN interrompue après 180 secondes'));},180000);
    let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>{err+=d;process.stderr.write(d);});
    p.on('error',e=>{clearTimeout(deadline);reject(e);});p.on('close',code=>{clearTimeout(deadline);code?reject(Error(err||out)):resolve(out);});p.stdin.end(input?JSON.stringify(input):undefined);
  });
}
async function cachedFetch(url,file,kind='json') {
  try{return kind==='json'?JSON.parse(await fs.readFile(file,'utf8')):await fs.readFile(file);}catch{}
  const res=await fetch(url,{signal:AbortSignal.timeout(90000)});if(!res.ok)throw Error(`Public source HTTP ${res.status}`);
  if(kind==='json'){const data=await res.json();await fs.writeFile(file,JSON.stringify(data));return data;}
  if(!res.headers.get('content-type')?.startsWith('image/'))throw Error('IGN orthophoto unavailable');
  const data=Buffer.from(await res.arrayBuffer());await fs.writeFile(file,data);return data;
}

/** Explicit local clone only. No CRM database, production environment or secret loaded. */
export async function acquireScene(geometryFile,directory) {
  await fs.mkdir(directory,{recursive:true});const saved=JSON.parse(await fs.readFile(geometryFile,'utf8'));
  await fs.mkdir(path.join(directory,'cache'),{recursive:true});
  const g=saved.geometry||saved,center=g.roofState.map.centerLatLng;
  let raw;
  try{raw=JSON.parse(await python('ign_scene.py',[],{lat:center.lat,lon:center.lng,radius:150,cache:path.join(directory,'cache')}));}
  catch(e){raw={status:'unavailable',reason:e.message,trees:[],buildingPoints:[]};}
  await fs.writeFile(path.join(directory,'scene-raw.json'),JSON.stringify(raw));
  const scene=JSON.parse(await python('prepare_scene.py',[path.join(directory,'scene-raw.json'),geometryFile]));
  const [a,b]=scene.roofs[0].plane;
  // PVGIS azimuth is relative to South, positive towards West.
  const tilt=Math.atan(Math.hypot(a,b))*180/Math.PI,az=Math.atan2(-a,-b)*180/Math.PI;
  const params=new URLSearchParams({lat:String(center.lat),lon:String(center.lng),startyear:'2023',endyear:'2023',pvcalculation:'0',components:'1',angle:String(tilt),aspect:String(az-180),usehorizon:'1',outputformat:'json'});
  const url='https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?'+params;
  const irradiation=await cachedFetch(url,path.join(directory,'cache','pvgis-'+createHash('sha256').update(url).digest('hex').slice(0,20)+'.json'));
  if(Math.abs(irradiation.inputs.location.latitude-center.lat)>.001 || Math.abs(irradiation.inputs.location.longitude-center.lng)>.001 || Math.abs(irradiation.inputs.mounting_system.fixed.slope.value-tilt)>1)throw Error('Irradiation cache incompatible with geometry');
  scene.irradiationSource=url;
  await fs.writeFile(path.join(directory,'irradiation.json'),JSON.stringify(irradiation));
  const {x,y}=scene.origin;
  const ortho=new URLSearchParams({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',LAYERS:'HR.ORTHOIMAGERY.ORTHOPHOTOS',STYLES:'',CRS:'EPSG:2154',BBOX:[x-100,y-100,x+100,y+100].join(','),WIDTH:'1600',HEIGHT:'1600',FORMAT:'image/png'});
  scene.orthoSource='https://data.geopf.fr/wms-r?'+ortho;
  try{const orthoImage=await cachedFetch(scene.orthoSource,path.join(directory,'cache','ortho-'+createHash('sha256').update(scene.orthoSource).digest('hex').slice(0,20)+'.png'),'image');await fs.writeFile(path.join(directory,'ortho.png'),orthoImage);}catch(e){scene.orthoUnavailable=true;}
  await fs.writeFile(path.join(directory,'scene.json'),JSON.stringify(scene));
  return scene;
}
