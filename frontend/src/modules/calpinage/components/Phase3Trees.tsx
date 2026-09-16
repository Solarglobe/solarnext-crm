import {useCallback,useEffect,useState} from 'react';
import styles from './Phase3Sidebar.module.css';
import {createPortal} from 'react-dom';
import {apiFetch} from '../../../services/api';
import {buildApiUrl} from '../../../config/crmApiBase';
import {TreeShadingFrame} from '../../../pages/studies/TreeShadingPage';
const pct=(n:number)=>n.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' %';
type Result={status:string;lossPercent:number;uncertainty?:{low:number;central:number;high:number}};
export function Phase3Trees({studyId,versionId,prepare,panelCount}:{studyId:string;versionId:string;prepare?:()=>Promise<boolean>;panelCount:number}){
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[details,setDetails]=useState(false),[locked,setLocked]=useState(false);
 const base=`/api/studies/${studyId}/versions/${versionId}/tree-shading`;
 const request=useCallback(async(suffix:string,body?:object)=>{const r=await apiFetch(buildApiUrl(base+suffix),{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),timeoutMs:240000,skipErrorToast:true});const data=await r.json();if(!r.ok)throw Error(data.error||'Analyse indisponible');return data;},[base]);
 const refresh=useCallback(async()=>{try{const s=await request('/scene');setResult(s.result);setLocked(s.locked);if(s.stale)setMessage('Panneaux modifiés : relancez le calcul.');}catch{setResult(null);}},[request]);
 useEffect(()=>{void refresh();},[refresh,panelCount]);
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>;const changed=()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(),4200);};window.addEventListener('phase3:update',changed);return()=>{clearTimeout(timer);window.removeEventListener('phase3:update',changed);};},[refresh]);
 async function calculate(){setBusy(true);setMessage('Enregistrement des panneaux…');setResult(null);try{
   if(!prepare||!await prepare())throw Error('Enregistrez les panneaux avant de lancer l’analyse.');
   let s=await request('/scene');
   if(!s.scene||s.stale){setMessage('Chargement des arbres IGN autour du toit…');s=await request('/acquire',{});}
   if(s.scene.roofSurveyRequired || (s.scene.status!=='available'&&!s.scene.emptySceneAttested) || (s.scene.acquisition?.complete===false&&!s.scene.emptySceneAttested))throw Error('Données IGN indisponibles ou incomplètes. Complétez le relevé dans les détails.');
   setMessage('Calcul de la perte annuelle…');const r=await request('/calculate',{});setResult(r);setMessage('');
 }catch(e){setMessage(e instanceof Error?e.message:'Analyse indisponible');}finally{setBusy(false);}}
 async function openDetails(){setBusy(true);try{if(prepare&&!await prepare())throw Error('Enregistrement du calepinage impossible');await refresh();setDetails(true);}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 return <section aria-label="Ombrage des arbres" style={{padding:'14px',border:'1px solid #475569',borderRadius:10,margin:'12px 0'}}>
  <h3 style={{margin:'0 0 8px'}}>Ombrage des arbres</h3>
  {result?<p><strong style={{fontSize:26}}>{pct(result.uncertainty?.central??result.lossPercent)}</strong><br/>Perte annuelle liée aux arbres</p>:<p>Analyse facultative après le placement des panneaux.</p>}
  <button className={styles.btnValidatePrimary} type="button" disabled={busy||locked||panelCount===0} onClick={calculate}>{busy?'Analyse en cours…':result?'Recalculer':'Calculer l’ombrage des arbres'}</button>
  <button className={styles.toolGhostBtn} type="button" disabled={busy||panelCount===0} onClick={openDetails} style={{marginTop:8}}>Détails et correction des arbres</button>
  {message&&<p role="status">{message}</p>}
  {details&&createPortal(<div role="dialog" aria-modal="true" aria-label="Détails de l’ombrage des arbres" onKeyDown={e=>{if(e.key==='Escape'){setDetails(false);void refresh();}}} style={{position:'fixed',inset:16,zIndex:2147483646,background:'#101923',color:'white',overflow:'auto',padding:16,borderRadius:12}}>
   <button type="button" autoFocus onClick={()=>{setDetails(false);void refresh();}} style={{position:'sticky',top:0,zIndex:2,float:'right'}}>Fermer les détails</button>
   {result?.uncertainty&&<p>Fourchette : {pct(result.uncertainty.low)} / <strong>{pct(result.uncertainty.central)}</strong> / {pct(result.uncertainty.high)}</p>}
   <TreeShadingFrame studyId={studyId} versionId={versionId} onChange={refresh}/>
  </div>,document.body)}
 </section>;
}
