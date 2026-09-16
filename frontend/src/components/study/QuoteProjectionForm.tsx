import {Button} from '../ui/Button';
import {SourceBadge} from './QuoteStudyUi';
export interface FinanceProjection {
 horizon_years?:number; supplier_subscription_growth_pct?:number; virtual_subscription_growth_pct?:number;
 virtual_restitution_growth_pct?:number; maintenance_pct?:number;
 surplus_sale_type?:'unconfirmed'|'oa'|'market'|'none'; oa_contract_years?:number; post_contract_sale_price_eur_kwh?:number;
 aid_eligibility?:'unconfirmed'|'eligible'|'ineligible'; aid_payment_schedule?:{year:number;share_pct:number}[];
 battery_replacements?:{year:number;cost_eur:number;kind?:'replacement'|'provision'}[];
 inverter_replacements?:{year:number;cost_eur:number}[];
}
export default function FinanceProjectionSettings({value={},onChange,disabled=false,defaultHorizon=null}:{value?:FinanceProjection;onChange:(v:FinanceProjection)=>void;disabled?:boolean;defaultHorizon?:number|null}) {
 const set=(patch:Partial<FinanceProjection>)=>onChange({...value,...patch});
 const legacy=value.horizon_years!=null&&![25,30].includes(value.horizon_years)?value.horizon_years:null;
 return <section className="sqb-section sqb-assumptions" aria-labelledby="sqb-assumptions-title">
  <div className="sqb-section-heading"><div><h2 id="sqb-assumptions-title" className="sqb-h2">Hypothèses propres à l’étude</h2><p className="sqb-help">Vos choix sont conservés avec cette version de l’étude.</p></div><SourceBadge source="Personnalisé pour cette étude"/></div>
  <div className="sqb-form-grid">
   <label>Horizon de simulation<select className="sn-input" disabled={disabled} value={value.horizon_years??''} onChange={e=>set({horizon_years:e.target.value?Number(e.target.value):undefined})}><option value="">Valeur générale{defaultHorizon==null?'':` · ${defaultHorizon} ans`}</option>{[25,30].map(y=><option key={y} value={y}>{y} ans</option>)}{legacy!=null&&<option value={legacy}>{legacy} ans · valeur conservée</option>}</select><SourceBadge source={value.horizon_years==null?'Paramètre général':'Personnalisé pour cette étude'}/>{value.horizon_years!=null&&<Button variant="ghost" size="sm" disabled={disabled} onClick={()=>set({horizon_years:undefined})}>Revenir à la valeur par défaut</Button>}</label>
   <label>Vente du surplus<select className="sn-input" disabled={disabled} value={value.surplus_sale_type??'unconfirmed'} onChange={e=>set({surplus_sale_type:e.target.value as FinanceProjection['surplus_sale_type']})}><option value="unconfirmed">Contrat à confirmer</option><option value="oa">Obligation d’achat confirmée</option><option value="market">Vente hors obligation d’achat</option><option value="none">Aucune vente</option></select></label>
   <label>Éligibilité à la prime<select className="sn-input" disabled={disabled} value={value.aid_eligibility??'unconfirmed'} onChange={e=>set({aid_eligibility:e.target.value as FinanceProjection['aid_eligibility']})}><option value="unconfirmed">À confirmer</option><option value="eligible">Éligibilité confirmée</option><option value="ineligible">Non éligible</option></select><span className="sqb-help">Aucune prime présumée sans confirmation.</span></label>
   <label>Durée contractuelle de vente (ans)<input className="sn-input" type="number" min="1" max="50" disabled={disabled} value={value.oa_contract_years??20} onChange={e=>set({oa_contract_years:e.target.value===''?undefined:Number(e.target.value)})}/></label>
   <label>Prix après contrat (€/kWh)<input className="sn-input" type="number" min="0" step="0.001" disabled={disabled} value={value.post_contract_sale_price_eur_kwh??0} onChange={e=>set({post_contract_sale_price_eur_kwh:e.target.value===''?undefined:Number(e.target.value)})}/></label>
  </div>
  <div className="sqb-schedule"><h3>Versements de la prime</h3><p className="sqb-help">Année 1 = première année d’exploitation. Total attendu : 100 %. Le montant en euros est calculé dans l’étude.</p>
   {(value.aid_payment_schedule??[]).length===0?<p className="sqb-empty">Aucun versement renseigné.</p>:<div className="sqb-table-scroll"><table className="sqb-schedule-table"><thead><tr><th>Année</th><th>Part du montant de la prime (%)</th><th>Action</th></tr></thead><tbody>
    {(value.aid_payment_schedule??[]).map((row,i)=><tr key={i}><td><input aria-label={`Année du versement ${i+1}`} className="sn-input" type="number" min="1" disabled={disabled} value={row.year} onChange={e=>set({aid_payment_schedule:value.aid_payment_schedule?.map((r,j)=>j===i?{...r,year:Number(e.target.value)}:r)})}/></td><td><input aria-label={`Part du versement ${i+1}`} className="sn-input" type="number" min="0" max="100" disabled={disabled} value={row.share_pct} onChange={e=>set({aid_payment_schedule:value.aid_payment_schedule?.map((r,j)=>j===i?{...r,share_pct:Number(e.target.value)}:r)})}/></td><td><Button variant="ghost" disabled={disabled} aria-label={`Supprimer le versement ${i+1}`} onClick={()=>set({aid_payment_schedule:value.aid_payment_schedule?.filter((_,j)=>j!==i)})}>Supprimer</Button></td></tr>)}
   </tbody></table></div>}
   <Button variant="secondary" disabled={disabled} onClick={()=>set({aid_payment_schedule:[...(value.aid_payment_schedule??[]),{year:1,share_pct:100}]})}>Ajouter un versement</Button>
  </div>
  <div className="sqb-replacement-grid">{(['battery_replacements','inverter_replacements'] as const).map(key=><div className="sqb-schedule" key={key}><h3>{key==='battery_replacements'?'Batterie : remplacements et provisions':'Onduleur : remplacements'}</h3>
   {(value[key]??[]).length===0&&<p className="sqb-empty">{key==='battery_replacements'?'Aucune dépense prévue.':value[key]==null?'Politique générale de remplacement conservée.':'Aucun remplacement prévu pour cette étude.'}</p>}
   {(value[key]??[]).map((row,i)=><div className="sqb-schedule-row" key={i}>
    <label>Année<input aria-label={`Année ${key} ${i+1}`} className="sn-input" type="number" min="1" disabled={disabled} value={row.year} onChange={e=>set({[key]:value[key]?.map((r,j)=>j===i?{...r,year:Number(e.target.value)}:r)})}/></label>
    <label>Montant TTC (€)<input aria-label={`Montant ${key} ${i+1}`} className="sn-input" type="number" min="0" step="0.01" disabled={disabled} value={row.cost_eur} onChange={e=>set({[key]:value[key]?.map((r,j)=>j===i?{...r,cost_eur:Number(e.target.value)}:r)})}/></label>
    {key==='battery_replacements'&&<label className="sqb-span-all">Nature<select className="sn-input" disabled={disabled} value={String(('kind' in row?row.kind:null)??'provision')} onChange={e=>set({battery_replacements:value.battery_replacements?.map((r,j)=>j===i?{...r,kind:e.target.value as 'replacement'|'provision'}:r)})}><option value="provision">Provision — performances inchangées</option><option value="replacement">Remplacement réel — batterie neuve</option></select></label>}
    <Button variant="ghost" className="sqb-span-all" disabled={disabled} aria-label={`Supprimer ${key} ${i+1}`} onClick={()=>set({[key]:value[key]?.filter((_,j)=>j!==i)})}>Supprimer</Button>
   </div>)}<div className="sqb-inline-actions"><Button variant="secondary" disabled={disabled} onClick={()=>set({[key]:[...(value[key]??[]),{year:15,cost_eur:0,...(key==='battery_replacements'?{kind:'provision'}:{})}]})}>Ajouter un remplacement</Button>{key==='inverter_replacements'&&value[key]!=null&&<Button variant="ghost" disabled={disabled} onClick={()=>set({inverter_replacements:undefined})}>Revenir à la valeur par défaut</Button>}</div>
  </div>)}</div>
 </section>;
}
