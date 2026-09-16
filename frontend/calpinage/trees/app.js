import { crownBoxes,convexHull } from '/treeGeometry.js';
const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
const view=new URLSearchParams(location.search);if(/^\d{4}-\d{2}-\d{2}$/.test(view.get('date')||''))$('date').value=view.get('date');if(view.has('hour'))$('time').value=view.get('hour');if(['30','50','100','150'].includes(view.get('zoom')))$('zoom').value=view.get('zoom');
let scene,result,selected=null,sun=null,drag=null,instantRequest=0,revision=0,locked=false;
const crm=window.__TREE_CRM__===true,pending=new Map();const bridgeOrigin=crm?window.parent.location.origin:window.location.origin;let requestId=0;
if(crm){document.querySelector('header b span').textContent='ANALYSE';document.querySelector('header small').textContent='Étude CRM · scène versionnée';document.querySelector('.heading .eyebrow').textContent='VÉGÉTATION · IGN LIDAR HD';document.querySelector('.timeline').title='Heures UTC';new ResizeObserver(()=>window.parent.postMessage({kind:'tree-height',height:document.documentElement.scrollHeight},bridgeOrigin)).observe(document.body);}
window.addEventListener('message',e=>{if(!crm||e.source!==window.parent||e.origin!==bridgeOrigin||e.data?.kind!=='tree-response')return;const p=pending.get(e.data.id);if(!p)return;clearTimeout(p.timer);pending.delete(e.data.id);p.resolve(new Response(e.data.body,{status:e.data.status,headers:{'Content-Type':e.data.type||'application/json'}}));});
function fetchResource(url,body){if(!crm)return fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return new Promise((resolve,reject)=>{const id=String(++requestId),timer=setTimeout(()=>{pending.delete(id);reject(Error('Le traitement prend trop de temps ; rechargez la scène pour vérifier son état.'));},245000);pending.set(id,{resolve,reject,timer});window.parent.postMessage({kind:'tree-request',id,path:url,method:body===undefined?'GET':'POST',body},bridgeOrigin);});}
async function prepareScene(data){
  const oldOrtho=scene?.orthoUrl;scene=data.scene;result=data.result;revision=data.revision??revision;locked=data.locked??locked;
  if(scene&&(crm||scene.context==='crm')){
    document.querySelector('header b span').textContent='ANALYSE';document.querySelector('header small').textContent=scene.title;
    document.querySelector('.heading .eyebrow').textContent='VÉGÉTATION · IGN LIDAR HD';
  }
  if(crm&&scene&&!scene.orthoUnavailable){const r=await fetchResource('/ortho.png');if(r.ok){scene.orthoUrl=URL.createObjectURL(await r.blob());if(oldOrtho)URL.revokeObjectURL(oldOrtho);}}
  for(const id of ['add','clear','update','remove','applyRoof','calculate'])$(id).disabled=!scene||locked;
  $('acquire').disabled=locked;$('attest').disabled=locked;
  if(!scene){notify('Ouvrez la scène depuis le calepinage en cliquant sur « Charger les arbres IGN ».');return false;}
  if(data.stale){notify('Le calepinage a changé : rechargez les arbres IGN avant tout nouveau calcul.');result=null;return false;}return true;
}
const pct=v=>new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)+' %';
const el=(tag,attrs,parent=$('map'))=>{const n=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));parent.append(n);return n;};
async function api(url,body){const r=await fetchResource(url,body);const j=await r.json();if(!r.ok)throw Error(j.error||r.status);return j;}
function notify(text){$('message').textContent=text;}
function displayResult(){
  const out=$('result');out.replaceChildren();$('pdf').disabled=!result;out.dataset.result=result?'computed':'pending';
  if(!result){out.textContent='Non évalué : calcul nécessaire après chaque modification de la scène.';return;}
  const metrics=document.createElement('div');metrics.className='metrics';
  for(const [value,label] of [[pct(result.lossPercent),'Perte d’irradiation annuelle'],[Math.round(result.lostKwhM2)+' kWh/m²','Irradiation annuelle interceptée'],[result.panels.filter(p=>p.lossPercent>0).length+' / '+result.panels.length,'Panneaux touchés']]){const div=document.createElement('div');div.className='metric';const b=document.createElement('strong');b.textContent=value;const span=document.createElement('span');span.textContent=label;div.append(b,span);metrics.append(div);}out.append(metrics);
  if(result.uncertainty){const u=result.uncertainty,p=document.createElement('p');p.className='sensitivity';p.textContent=`Scénarios : basse ${pct(u.low)} · centrale ${pct(u.central)} · haute ${pct(u.high)}. Couronnes totalement opaques : ${pct(u.opaque)}. Il s’agit d’une sensibilité aux hypothèses, pas d’un intervalle de confiance mesuré.`;out.append(p);const components=document.createElement('p');components.textContent=`Perte directe : ${result.directLostKwhM2.toFixed(1)} kWh/m² ; diffuse : ${result.diffuseLostKwhM2.toFixed(1)} kWh/m². Opacité centrale : 95 % de mai à septembre, 55 % de novembre à mars, 75 % en avril/octobre. ${u.note}`;out.append(components);}
  const title=document.createElement('h3');title.textContent='Perte mensuelle pondérée par l’irradiation';out.append(title);
  const bars=document.createElement('div');bars.className='bars';const names=['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
  result.months.forEach((m,i)=>{const bar=document.createElement('div');bar.className='bar';bar.style.height=(m.lossPercent||0)+'%';const label=document.createElement('small');label.textContent=names[i];const value=document.createElement('b');value.textContent=(m.lossPercent||0).toFixed(1)+' %';bar.append(label,value);bars.append(bar);});out.append(bars);
  const list=document.createElement('div');list.className='panels';for(const p of result.panels){const div=document.createElement('div');div.className='panel';const b=document.createElement('b');b.textContent=p.id;div.append(b,document.createTextNode(pct(p.lossPercent)));div.title=`${p.shadedHours} heures de soleil avec ombre directe`;list.append(div);}out.append(list);
  const hours=result.hours.filter(h=>h.baseline>0&&h.lost>0).map(h=>h.hourUTC);const detail=document.createElement('p');detail.textContent=`Impact observé entre ${Math.min(...hours)} h et ${Math.max(...hours)+1} h UTC selon les saisons. Référence sans arbres : ${result.baselineKwhM2.toFixed(1)} kWh/m²/an. ${result.treeCount} volumes actifs.`;out.append(detail);
  const trace=document.createElement('p');trace.className='trace';trace.textContent=`${result.model} · ${result.sampleGrid} × ${result.sampleGrid} points/panneau · ${result.calculatedAt} · empreinte ${result.hash}`;out.append(trace);
}
function displaySources(){
  $('source').textContent=`${scene.trees.length} volumes de végétation · ${scene.panels.length} panneaux · acquisition LiDAR ${scene.sources?.[0]?.date_debut_acquisition?.slice(0,10)||'non disponible'}`;
  const p=$('provenance');p.replaceChildren();
  const facts=[scene.roofSurveyRequired?'Altitude du toit manquante : calcul bloqué jusqu’au relevé manuel.':scene.roofs[0].datum==='IGN69_MANUAL'?'Altitude du toit renseignée manuellement en IGN69.':`Toit calé sur ${scene.roofs[0].lidarPoints} points de bâtiment (classe 6). Datum IGN69 ; écart au plan ${(scene.roofs[0].rms*100).toFixed(1)} cm.`,`Téléchargement de cette session : ${(scene.download.bytes/1e6).toFixed(1)} Mo, ${scene.download.rangeRequests} requêtes partielles COPC. Cache local ${scene.download.cacheHit?'réutilisé':'constitué'}.`,...scene.assumptions];
  $('roofSurvey').open=scene.roofSurveyRequired;$('roofAltitude').value=scene.roofSurveyRequired?'':scene.roofs[0].polygon[0][2].toFixed(2);
  facts.forEach(text=>{const line=document.createElement('p');line.textContent=text;p.append(line);});
  scene.sources.forEach(s=>{const line=document.createElement('p'),a=document.createElement('a');a.href=s.url_npl;a.target='_blank';a.rel='noreferrer';a.textContent=`IGN LiDAR HD · ${s.coordonnees_nw} · acquis ${s.date_debut_acquisition?.slice(0,10)} · publié ${s.date_edition?.slice(0,10)}`;line.append(a);p.append(line);});
}
function showFields(){const t=scene.trees.find(t=>t.id===selected);$('fields').style.opacity=t?1:.4;$('treeTitle').textContent=t?(t.source==='manual'?'Arbre manuel':`Volume ${t.id.split('-').at(-1)}`):'Sélectionnez un arbre';for(const key of ['height','diameter','crownBottom','groundZ','x','y']){$(key).value=t?t[key]:'';$(key).disabled=!t||locked;}$('update').disabled=$('remove').disabled=!t||locked;}
function draw(){
  const map=$('map');map.replaceChildren();map.dataset.date=sun?.date||'';$('printDate').textContent=$('date').value.split('-').reverse().join('/');const r=Number($('zoom').value),rx=r*map.clientWidth/map.clientHeight;map.setAttribute('viewBox',`${-20-rx} ${-r} ${2*rx} ${2*r}`);
  if(!scene.orthoUnavailable)el('image',{href:scene.orthoUrl||'/ortho.png',x:-100,y:-100,width:200,height:200});
  const buildings=el('g',{opacity:.5});for(const [x,y] of scene.buildings)el('rect',{x:x-.22,y:-y-.22,width:.44,height:.44,fill:'#cde0f1'},buildings);
  for(const roof of scene.roofs)el('polygon',{points:roof.polygon.map(([x,y])=>`${x},${-y}`).join(' '),fill:'#d6e7e6','fill-opacity':.3,stroke:'#fff','stroke-width':.3});
  const visible=b=>b[3]>-20-rx&&b[0]<-20+rx&&b[4]>-r&&b[1]<r;
  const pathPolygon=ps=>'M'+ps.map(([x,y])=>`${x.toFixed(2)},${(-y).toFixed(2)}`).join('L')+'Z';
  if(sun?.elevationDeg>3){
    const [dx,dy,dz]=sun.vector;const z=scene.roofs[0].polygon.reduce((s,p)=>s+p[2],0)/scene.roofs[0].polygon.length;
    const group=el('g',{'pointer-events':'none'});
    for(const t of scene.trees){if(t.enabled===false)continue;
      const boxes=crownBoxes(t);
      if(boxes){let path='';for(const b of boxes){if(b[5]<=z)continue;const ps=[];for(const X of [b[0],b[3]])for(const Y of [b[1],b[4]])for(const Z of [Math.max(z,b[2]),b[5]])ps.push([X-dx*(Z-z)/dz,Y-dy*(Z-z)/dz]);const xs=ps.map(p=>p[0]),ys=ps.map(p=>p[1]);if(!visible([Math.min(...xs),Math.min(...ys),0,Math.max(...xs),Math.max(...ys)]))continue;path+=pathPolygon(convexHull(ps));}if(path)el('path',{d:path,fill:'#39116c','fill-opacity':.3},group);continue;}
      const points=[];const rz=(t.height-t.crownBottom)/2,cz=t.groundZ+t.crownBottom+rz,rr=t.diameter/2;
      // Exact ellipse projection of the crown onto the displayed reference roof
      // level. Panel colour uses full 3D ray intersections, not this illustration.
      const cx=t.x-dx*(cz-z)/dz,cy=t.y-dy*(cz-z)/dz;
      const a=rr*rr+(dx/dz*rz)**2,b=(dx*dy/dz**2)*rz**2,c=rr*rr+(dy/dz*rz)**2;
      const l11=Math.sqrt(a),l21=b/l11,l22=Math.sqrt(Math.max(0,c-l21*l21));
      for(let i=0;i<32;i++){const th=i*Math.PI/16;points.push(`${cx+l11*Math.cos(th)},${-(cy+l21*Math.cos(th)+l22*Math.sin(th))}`);}
      el('polygon',{points:points.join(' '),fill:'#39116c','fill-opacity':.20},group);
    }
  }
  for(const t of scene.trees){if(t.enabled===false)continue;const chosen=t.id===selected,boxes=crownBoxes(t);const attrs={fill:chosen?'#e2fa65':'#4ee085','fill-opacity':chosen?.55:.28,stroke:chosen?'#e9ff74':'#9aeaab','stroke-opacity':.7,'stroke-width':chosen?.18:.03,'data-tree-id':t.id};let c;
    if(boxes){const inside=boxes.filter(visible);if(!inside.length)continue;c=el('path',{...attrs,d:inside.map(b=>pathPolygon([[b[0],b[1]],[b[3],b[1]],[b[3],b[4]],[b[0],b[4]]])).join('')});}
    else c=el('circle',{...attrs,cx:t.x,cy:-t.y,r:t.diameter/2});
    c.addEventListener('pointerdown',e=>{e.preventDefault();selected=t.id;drag={id:t.id,start:svgPoint(e),x:t.x,y:t.y,moved:false};map.setPointerCapture(e.pointerId);showFields();});const title=el('title',{},c);title.textContent=`${t.id} · hauteur ${t.height} m · couronne ${t.diameter} m`;}
  for(const p of scene.panels){const shade=sun?.panels.find(x=>x.id===p.id)?.shade;const q=el('polygon',{points:p.polygon.map(([x,y])=>`${x},${-y}`).join(' '),fill:shade===null?'#678296':`rgb(${Math.round(248-158*(shade||0))},${Math.round(228-180*(shade||0))},${Math.round(120+30*(shade||0))})`,stroke:'#fff','stroke-width':.12});const title=el('title',{},q);title.textContent=`${p.id} · ombre directe ${shade===null?'nuit':pct((shade||0)*100)}`;const x=p.polygon.reduce((s,v)=>s+v[0],0)/4,y=p.polygon.reduce((s,v)=>s+v[1],0)/4;el('text',{x,y:-y,'text-anchor':'middle','font-size':.65}).textContent=p.id;}
  el('text',{x:-20-rx+3,y:-r+6,'font-size':2.5}).textContent='N ↑';
}
function svgPoint(e){const p=new DOMPoint(e.clientX,e.clientY);return p.matrixTransform($('map').getScreenCTM().inverse());}
$('map').addEventListener('pointermove',e=>{if(!drag)return;const pt=svgPoint(e),t=scene.trees.find(t=>t.id===drag.id);if(Math.hypot(pt.x-drag.start.x,pt.y-drag.start.y)>.2)drag.moved=true;t.x=+(drag.x+pt.x-drag.start.x).toFixed(2);t.y=+(drag.y-pt.y+drag.start.y).toFixed(2);draw();showFields();});
$('map').addEventListener('pointerup',async()=>{if(!drag)return;const moved=drag.moved;drag=null;draw();if(moved)await save();});
async function instant(){const request=++instantRequest;if(scene.roofSurveyRequired){sun=null;draw();notify('LiDAR absent ou insuffisant : saisissez le relevé du toit et les arbres. Aucun zéro automatique.');return;}const h=Number($('time').value),hh=String(Math.floor(h)).padStart(2,'0'),mm=String(Math.round((h%1)*60)).padStart(2,'0');const date=`${$('date').value}T${hh}:${mm}:00Z`;$('hourLabel').textContent=`${hh}:${mm}`;const next=await api(`/api/instant?date=${date}`);if(request!==instantRequest)return;sun={...next,date};$('sun').textContent=`Soleil ${sun.elevationDeg.toFixed(1)}° · azimut ${sun.azimuthDeg.toFixed(1)}°`;draw();}
async function save(options={}){
  result=null;displayResult();
  try{const data=await api('/api/scene',{trees:scene.trees,revision,emptySceneAttested:$('attest').checked,...(options.roofAltitudeM!==undefined?{roofAltitudeM:options.roofAltitudeM}:{})});await prepareScene(data);displayResult();displaySources();showFields();await instant();notify('Scène modifiée. Le résultat et le PDF précédents sont périmés ; recalculez.');}
  catch(e){const message=e.message;try{if(await prepareScene(await api('/api/scene'))){displayResult();displaySources();showFields();await instant();}}catch{}notify(message+' La dernière scène enregistrée a été conservée.');}
}
function action(id,fn){$(id).addEventListener('click',async()=>{const b=$(id);b.disabled=true;try{await fn();}catch(e){notify(e.message);}finally{b.disabled=locked&&id!=='pdf';}});}
action('update',async()=>{const t=scene.trees.find(t=>t.id===selected);if(!t)return;for(const k of ['height','diameter','crownBottom','groundZ','x','y'])t[k]=Number($(k).value);t.correctedByUser=true;await save();});
action('applyRoof',async()=>{if($('roofAltitude').value==='')throw Error('Altitude mesurée requise');await save({roofAltitudeM:Number($('roofAltitude').value)});});
action('remove',async()=>{scene.trees=scene.trees.filter(t=>t.id!==selected);selected=null;await save();});
action('add',async()=>{selected='manual-'+Date.now();const base=scene.trees.length?scene.trees[0].groundZ:scene.roofs[0].polygon[0][2]-3;scene.trees.push({id:selected,x:-20,y:-25,groundZ:base,height:12,diameter:6,crownBottom:3,source:'manual',enabled:true});$('attest').checked=false;await save();notify('Arbre ajouté. Déplacez-le et renseignez ses dimensions mesurées.');});
action('clear',async()=>{scene.trees=[];selected=null;$('attest').checked=false;await save();});
$('attest').addEventListener('change',save);
action('calculate',async()=>{notify('Calcul solaire et irradiation horaire en cours…');result=await api('/api/calculate',{});displayResult();notify('Calcul terminé. Le PDF reprend cette scène et cette empreinte de calcul.');});
action('acquire',async()=>{notify('Récupération IGN autour du toit ; réutilisation du cache local…');const data=await api('/api/acquire',{});await prepareScene(data);result=null;selected=null;$('attest').checked=false;displaySources();displayResult();showFields();await instant();notify('Scène IGN chargée. Les corrections manuelles ont été remplacées par les détections.');});
action('pdf',async()=>{const query=new URLSearchParams({date:$('date').value,hour:$('time').value,zoom:$('zoom').value});const res=await fetchResource('/api/pdf?'+query);if(!res.ok)throw Error((await res.json()).error);const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='arbres-reels.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
for(const id of ['date','time'])$(id).addEventListener('change',()=>instant().catch(e=>notify(e.message)));$('zoom').addEventListener('change',draw);
try{const data=await api('/api/scene');if(await prepareScene(data)){$('attest').checked=scene.emptySceneAttested;displaySources();displayResult();showFields();await instant();}}catch(e){notify(e.message);}
