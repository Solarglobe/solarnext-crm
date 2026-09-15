import type {FinanceProjection} from './FinanceProjectionSettings';
export default function ProjectionAssumptions({value,compact=false}:{value?:FinanceProjection|null;compact?:boolean}) {
  if(!value)return null;
  const fmt=(n:unknown)=>n==null?'paramètres enregistrés':Number(n).toLocaleString('fr-FR');
  const saleType=value.surplus_sale_type??'unconfirmed';
  const body=<>
    <p>Abonnements fournisseur avant et après : +{fmt(value.supplier_subscription_growth_pct??0)} %/an. Abonnement virtuel : +{fmt(value.virtual_subscription_growth_pct??0)} %/an. Prix de restitution : +{fmt(value.virtual_restitution_growth_pct??0)} %/an ; frais proportionnels aux crédits utilisés chaque année.</p>
    <p>Vente : {{unconfirmed:'contrat non confirmé',oa:'obligation d’achat',market:'contrat de marché',none:'aucune vente'}[saleType]}.
      {saleType==='oa'&&<> Durée contractuelle {fmt(value.oa_contract_years??20)} ans ; prix post-contrat {fmt(value.post_contract_sale_price_eur_kwh??0)} €/kWh.</>}
      {saleType==='market'&&<> Le tarif de marché renseigné est projeté sur {value.horizon_years?`${value.horizon_years} ans`:'l’horizon de l’étude'} ; aucune fin de contrat OA n’est appliquée.</>}
      {(saleType==='none'||saleType==='unconfirmed')&&<> Aucun revenu de vente confirmé n’est compté.</>}
      {' '}Prime : {{unconfirmed:'éligibilité à confirmer',eligible:'éligibilité déclarée',ineligible:'non éligible'}[value.aid_eligibility??'unconfirmed']}. {(value.aid_payment_schedule??[]).map(r=>`${fmt(r.share_pct)} % en année ${r.year}`).join(' ; ')||'Aucun versement confirmé.'}</p>
    {value.maintenance_pct!=null&&<p>Entretien : {fmt(value.maintenance_pct)} % de l’investissement/an.</p>}
    <p>Batterie : {(value.battery_replacements??[]).map(r=>`${r.kind==='replacement'?'remplacement réel avec performances réinitialisées':'provision sans remise à neuf'}, année ${r.year}, ${fmt(r.cost_eur)} €`).join(' ; ')||'aucune dépense de remplacement configurée'}. Onduleur : {(value.inverter_replacements??[]).map(r=>`année ${r.year}, ${fmt(r.cost_eur)} €`).join(' ; ')||'selon les paramètres enregistrés'}.</p>
  </>;
  return compact?<div style={{fontSize:'2.6mm'}}>{body}</div>:<details><summary>Hypothèses financières utilisées</summary>{body}</details>;
}
