import {SourceBadge,StudySwitch} from './QuoteStudyUi';
export interface FinancingConfig {
 enabled:boolean; amount:number|null; duration_months:number|null; interest_rate_annual:number|null;
 taeg_pct?:number|null; insurance_eur?:number|null; application_fee_eur?:number|null; other_costs_eur?:number|null;
}
export const DEFAULT_FINANCING:FinancingConfig={enabled:false,amount:0,duration_months:0,interest_rate_annual:0};
/** Existing payload keys only. Missing legacy flags retain duration/rate activation. */
export function mergeFinancing(raw:Partial<FinancingConfig>|null|undefined,totalsTtc:number):FinancingConfig {
 const f={...DEFAULT_FINANCING,...raw};
 const duration=f.duration_months==null?null:Math.max(0,Number(f.duration_months)||0);
 const rate=(raw&&raw.interest_rate_annual==null)||f.interest_rate_annual==null?null:Number(f.interest_rate_annual);
 const validRate=rate!=null&&Number.isFinite(rate);
 const enabled=raw?.enabled??(duration!=null&&duration>0&&validRate&&rate>=0);
 let amount=f.amount==null?null:Number(f.amount);
 if(amount!=null&&(!Number.isFinite(amount)||amount<0))amount=0;
 if(enabled&&amount===0&&totalsTtc>0)amount=totalsTtc;
 return {...f,enabled,amount,duration_months:duration,interest_rate_annual:validRate?rate:null};
}
export function financingInputError(value:FinancingConfig|null|undefined):string|null {
 if(!value?.enabled)return null;
 if(value.amount==null||value.amount<=0||value.duration_months==null||value.duration_months<=0||value.interest_rate_annual==null||value.interest_rate_annual<0)return 'Renseignez le montant, la durée et le taux du financement. Un taux nul doit être saisi explicitement.';
 return null;
}
export default function QuoteFinancingSettings({value,onChange,disabled,total}:{value:FinancingConfig;onChange:(next:FinancingConfig)=>void;disabled:boolean;total:number}) {
 const fields=[['amount','Montant financé (€)'],['duration_months','Durée (mois)'],['interest_rate_annual','Taux nominal annuel (%)'],['taeg_pct','TAEG communiqué (%)'],['insurance_eur','Assurance totale sur la durée (€)'],['application_fee_eur','Frais de dossier (€)'],['other_costs_eur','Autres coûts du crédit (€)']] as const;
 return <section className="sqb-section sqb-financing" aria-labelledby="sqb-financing-title"><h2 className="sqb-h2" id="sqb-financing-title">Financement</h2>
  <StudySwitch label="Inclure un financement dans la simulation" checked={value.enabled} disabled={disabled} description="Le ROI et le TRI principaux restent présentés avant crédit." onChange={enabled=>onChange({...value,enabled,...(enabled&&value.duration_months===0&&value.amount===0&&value.interest_rate_annual===0?{amount:null,duration_months:null,interest_rate_annual:null}:{})})}/>
  {value.enabled?<><div className="sqb-form-grid">{fields.map(([key,label])=><label key={key}>{label}<input aria-label={label} className="sn-input" type="number" min="0" step={key==='duration_months'?'1':'0.01'} disabled={disabled} value={value[key]??''} placeholder={key==='amount'?`Devis : ${total.toLocaleString('fr-FR')} €`:'Non renseigné'} onChange={e=>onChange({...value,[key]:e.target.value===''?null:Number(e.target.value)})}/><SourceBadge source="Personnalisé pour cette étude"/></label>)}</div><p className="sqb-help">Vide = non renseigné. Saisissez 0 uniquement si le taux ou les frais sont confirmés nuls. Mensualités et coût total seront calculés dans le résultat.</p></>:<p className="sqb-help">Simulation sans crédit. Les éventuelles valeurs saisies restent conservées.</p>}
 </section>;
}
