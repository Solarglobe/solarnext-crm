export interface FinanceProjection {
  horizon_years?: number;
  supplier_subscription_growth_pct?: number;
  virtual_subscription_growth_pct?: number;
  virtual_restitution_growth_pct?: number;
  maintenance_pct?: number;
  surplus_sale_type?: 'unconfirmed'|'oa'|'market'|'none';
  oa_contract_years?: number;
  post_contract_sale_price_eur_kwh?: number;
  aid_eligibility?: 'unconfirmed'|'eligible'|'ineligible';
  aid_payment_schedule?: {year:number;share_pct:number}[];
  battery_replacements?: {year:number;cost_eur:number;kind?:'replacement'|'provision'}[];
  inverter_replacements?: {year:number;cost_eur:number}[];
}
export default function FinanceProjectionSettings({value={},onChange,disabled=false}:{value?:FinanceProjection;onChange:(v:FinanceProjection)=>void;disabled?:boolean}) {
  const set=(patch:Partial<FinanceProjection>)=>onChange({...value,...patch});
  return <section className="sqb-section"><h2 className="sqb-h2">Hypothèses de projection</h2>
    <p>Hypothèses modifiables, conservées avec le calcul et affichées dans l’étude. Les valeurs issues des paramètres du logiciel sont détaillées dans l’étude ; aucune aide ni vente n’est présumée éligible.</p>
    <div className="sqb-financing-inline">
      <label>Horizon<select className="sn-input" disabled={disabled} value={value.horizon_years??''} onChange={e=>set({horizon_years:e.target.value?Number(e.target.value):undefined})}><option value="">Paramètres du logiciel</option>{[20,25,30].map(y=><option key={y} value={y}>{y} ans</option>)}</select></label>
      {([
        ['supplier_subscription_growth_pct','Hausse abonnements fournisseur avant et après (%/an)',0],
        ['virtual_subscription_growth_pct','Hausse abonnement batterie virtuelle (%/an)',0],
        ['virtual_restitution_growth_pct','Hausse prix de restitution virtuelle (%/an)',0],
        ['maintenance_pct','Entretien (% investissement/an)',undefined],
      ] as const).map(([key,label,fallback])=><label key={key}>{label}<input className="sn-input" type="number" step="0.1" min="0" disabled={disabled} value={value[key]??fallback??''} placeholder="Paramètres du logiciel" onChange={e=>set({[key]:e.target.value===''?undefined:Number(e.target.value)})}/></label>)}
      <label>Vente du surplus<select className="sn-input" disabled={disabled} value={value.surplus_sale_type??'unconfirmed'} onChange={e=>set({surplus_sale_type:e.target.value as FinanceProjection['surplus_sale_type']})}><option value="unconfirmed">Contrat à confirmer</option><option value="oa">Obligation d’achat confirmée</option><option value="market">Vente hors obligation d’achat</option><option value="none">Aucune vente</option></select></label>
      <label>Durée contractuelle de vente (ans)<input className="sn-input" type="number" min="1" max="50" disabled={disabled} value={value.oa_contract_years??20} onChange={e=>set({oa_contract_years:Number(e.target.value)})}/></label>
      <label>Prix après contrat (€/kWh)<input className="sn-input" type="number" min="0" step="0.001" disabled={disabled} value={value.post_contract_sale_price_eur_kwh??0} onChange={e=>set({post_contract_sale_price_eur_kwh:Number(e.target.value)})}/></label>
      <label>Éligibilité à la prime<select className="sn-input" disabled={disabled} value={value.aid_eligibility??'unconfirmed'} onChange={e=>set({aid_eligibility:e.target.value as FinanceProjection['aid_eligibility']})}><option value="unconfirmed">À confirmer — aucune prime comptée</option><option value="eligible">Éligibilité confirmée</option><option value="ineligible">Non éligible</option></select></label>
    </div>
    <h3>Versements de la prime</h3><p>Le calendrier confirmé doit totaliser 100 % de la prime. Année 1 = première année d’exploitation.</p>
    {(value.aid_payment_schedule??[]).map((row,i)=><div className="sqb-financing-inline" key={i}><label>Année<input className="sn-input" type="number" min="1" disabled={disabled} value={row.year} onChange={e=>set({aid_payment_schedule:value.aid_payment_schedule?.map((r,j)=>j===i?{...r,year:Number(e.target.value)}:r)})}/></label><label>Part versée (%)<input className="sn-input" type="number" min="0" max="100" disabled={disabled} value={row.share_pct} onChange={e=>set({aid_payment_schedule:value.aid_payment_schedule?.map((r,j)=>j===i?{...r,share_pct:Number(e.target.value)}:r)})}/></label><button type="button" disabled={disabled} onClick={()=>set({aid_payment_schedule:value.aid_payment_schedule?.filter((_,j)=>j!==i)})}>Retirer le versement</button></div>)}
    <button type="button" disabled={disabled} onClick={()=>set({aid_payment_schedule:[...(value.aid_payment_schedule??[]),{year:1,share_pct:100}]})}>Ajouter un versement</button>
    {(['battery_replacements','inverter_replacements'] as const).map(key=><div key={key}><h3>{key==='battery_replacements'?'Batterie : remplacement ou provision':'Onduleur : dépenses de remplacement'}</h3>{(value[key]??[]).map((row,i)=><div className="sqb-financing-inline" key={i}>
      <label>Année<input className="sn-input" type="number" min="1" disabled={disabled} value={row.year} onChange={e=>set({[key]:value[key]?.map((r,j)=>j===i?{...r,year:Number(e.target.value)}:r)})}/></label>
      <label>Coût TTC (€)<input className="sn-input" type="number" min="0" step="0.01" disabled={disabled} value={row.cost_eur} onChange={e=>set({[key]:value[key]?.map((r,j)=>j===i?{...r,cost_eur:Number(e.target.value)}:r)})}/></label>
      {key==='battery_replacements'&&<label>Nature<select className="sn-input" disabled={disabled} value={String(('kind' in row?row.kind:null)??'provision')} onChange={e=>set({battery_replacements:value.battery_replacements?.map((r,j)=>j===i?{...r,kind:e.target.value as 'replacement'|'provision'}:r)})}><option value="provision">Provision — performances inchangées</option><option value="replacement">Remplacement réel — batterie neuve</option></select></label>}
      <button type="button" disabled={disabled} onClick={()=>set({[key]:value[key]?.filter((_,j)=>j!==i)})}>Retirer la dépense</button>
    </div>)}<button type="button" disabled={disabled} onClick={()=>set({[key]:[...(value[key]??[]),{year:15,cost_eur:0,...(key==='battery_replacements'?{kind:'provision'}:{})}]})}>Ajouter une dépense {key==='battery_replacements'?'batterie':'onduleur'}</button></div>)}
  </section>;
}
