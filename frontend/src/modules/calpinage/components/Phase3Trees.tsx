import {useCallback,useEffect,useState} from 'react';
import styles from './Phase3Sidebar.module.css';import {createPortal} from 'react-dom';
import {apiFetch} from '../../../services/api';import {buildApiUrl} from '../../../config/crmApiBase';
import {TreeShadingFrame} from '../../../pages/studies/TreeShadingPage';
import {ensureSavedShading,shadingRequest,shadingKey,type ShadingJob} from '../../../services/shadingWorkflow';
const pct=(n:number)=>n.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' %';
const steps:Record<string,string>={queued:'En attente',ign:'Récupération IGN',detection:'Détection des arbres et obstacles',irradiation:'Irradiation et horizon PVGIS',annual:'Calcul annuel',save:'Sauvegarde',completed:'Calcul terminé',failed:'Analyse non disponible'};
type Result={scope:string;lossPercent:number;uncertainty?:{low:number;central:number;high:number}};
export function Phase3Trees({studyId,versionId,prepare,panelCount,onContinueWithoutShading}:{studyId:string;versionId:string;prepare?:()=>Promise<boolean>;panelCount:number;onContinueWithoutShading?:()=>Promise<void>}){
 const [result,setResult]=useState<Result|null>(null),[job,setJob]=useState<ShadingJob|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[details,setDetails]=useState(false),[changed,setChanged]=useState(false),[excluded,setExcluded]=useState(false),[elapsed,setElapsed]=useState(0),[locked,setLocked]=useState(false);
 const refresh=useCallback(async()=>{try{const s=await shadingRequest(studyId,versionId,'/jobs');setResult(s.result?.scope==='combined-shading-v1'?s.result:null);setJob(s.job);setChanged(s.stale||(!s.result&&s.sceneAvailable));setExcluded(s.excluded);setLocked(s.locked);setElapsed(s.job?Math.max(0,Math.floor((Date.now()-Date.parse(s.job.startedAt||s.job.createdAt))/1000)):0);setMessage('');}catch{setMessage('Connexion interrompue — le suivi reprend automatiquement.');}},[studyId,versionId]);
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),2500);const update=()=>void refresh();window.addEventListener('shading:progress',update);return()=>{clearInterval(timer);window.removeEventListener('shading:progress',update);};},[refresh]);
 const running=job?.status==='queued'||job?.status==='running';
 async function recalculate(){setBusy(true);try{if(!prepare||!await prepare())throw Error('Enregistrement du calepinage impossible');await ensureSavedShading(studyId,versionId,{retry:true});await refresh();window.dispatchEvent(new CustomEvent('shading:complete',{detail:{key:shadingKey(studyId,versionId)}}));}catch(e){setMessage(e instanceof Error?e.message:'Analyse non disponible');}finally{setBusy(false);}}
 async function skip(){setBusy(true);try{if(!onContinueWithoutShading)throw Error('Validation indisponible');await onContinueWithoutShading();await refresh();}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 async function report(){setBusy(true);try{const r=await apiFetch(buildApiUrl(`/api/studies/${studyId}/versions/${versionId}/tree-shading/pdf`),{timeoutMs:60000});if(!r.ok)throw Error('Rapport non disponible');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='analyse-ombrage.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 return <section aria-label="Analyse d’ombrage" style={{padding:14,border:'1px solid #cbd5e1',borderRadius:10,margin:'12px 0'}}>
  <h3 style={{margin:'0 0 8px'}}>Analyse d’ombrage</h3>
  {!panelCount?<p>Placez les panneaux avant de valider le calepinage.</p>:result?<p><strong style={{fontSize:26}}>{pct(result.lossPercent)}</strong><br/>Perte annuelle globale</p>:running?<p role="status">{steps[job.step]||'Analyse en cours'} · {elapsed} s<br/><small>Traitement {job.id.slice(0,8)}</small></p>:excluded?<p>Ombrage non évalué. Aucune perte n’a été calculée.</p>:job?.status==='failed'?<p role="status">{job.error || 'Analyse non disponible.'}<br/><small>Vous pouvez enregistrer le calepinage et continuer sans cette analyse.</small></p>:<p>Le calcul se lance automatiquement à la validation.</p>}
  {!running&&!result&&panelCount>0&&(changed||job?.status==='failed')&&<button className={styles.btnValidatePrimary} disabled={busy||locked} onClick={recalculate}>{job?.status==='failed'?'Réessayer':'Recalculer'}</button>}
  {job?.status==='failed'&&!running&&!excluded&&onContinueWithoutShading&&<button className={styles.toolGhostBtn} disabled={busy||locked} onClick={skip}>{busy?'Enregistrement…':'Continuer sans analyse d’ombrage'}</button>}
  {result&&<button className={styles.toolLinkBtn} disabled={busy} onClick={report}>Voir le rapport détaillé</button>}
  {panelCount>0&&<button className={styles.toolGhostBtn} disabled={busy||running} onClick={()=>setDetails(true)}>Détails</button>}
  {message&&<p role="status">{message}</p>}
  {details&&createPortal(<div role="dialog" aria-modal="true" aria-label="Détails de l’analyse d’ombrage" style={{position:'fixed',inset:16,zIndex:2147483646,background:'#101923',color:'white',overflow:'auto',padding:16,borderRadius:12}}>
   <button type="button" autoFocus onClick={()=>{setDetails(false);void refresh();}} style={{position:'sticky',top:0,zIndex:2,float:'right'}}>Fermer les détails</button>
   {result?.uncertainty&&<p>Fourchette : {pct(result.uncertainty.low)} / <strong>{pct(result.uncertainty.central)}</strong> / {pct(result.uncertainty.high)}</p>}
   <TreeShadingFrame studyId={studyId} versionId={versionId} onChange={refresh}/>
  </div>,document.body)}
 </section>;
}
