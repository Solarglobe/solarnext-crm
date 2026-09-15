import { getStudyShadingState, SHADING_EXCLUSION_METHODOLOGY } from '../../../../../shared/shading/clientStudyExport.js';
import ProjectionAssumptions from "@/components/study/ProjectionAssumptions";
import PdfPageLayout from '../PdfEngine/PdfPageLayout';
import { usePdfOrgBranding } from './pdfOrgBrandingContext';
import { electricityBillingNote, electricityContractLabel } from '@/components/study/electricityBillingDisplay';

type Props = { viewModel?: Record<string, any> };
const fmt=(n:unknown,d=0)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('fr-FR',{maximumFractionDigits:d}):'Non renseigné';
export default function PdfPageVerifiedAssumptions({viewModel:vm}:Props){
 const {brandHex}=usePdfOrgBranding();
 const ref=vm?.results_reference;if(!ref)return null;
 const snapshot=vm?.selected_scenario_snapshot??{};
 const e=snapshot.economic_snapshot??snapshot.finance?.finance_meta?.economic_snapshot??{};
 const projection=e.projection_assumptions??snapshot.finance?.finance_meta?.projection_assumptions;
 const projectionMethod=projection?.energy_projection_method??snapshot.finance?.finance_meta?.projection_method;
 const b=ref.battery,a=ref.annual,c=snapshot.grid_contract??{},v=ref.virtual_credit;
 const tariff=e.oa_rate_eur_kwh;
 const billing=vm?.electricity_billing_display??vm?.electricity_billing??snapshot.electricity_billing??snapshot.finance?.electricity_billing;
 return <PdfPageLayout legacyPort={{id:'p-verified-assumptions',sectionGap:'2mm'}}>
  <style>{`#p-verified-assumptions .card { padding: 2.6mm !important; } #p-verified-assumptions .card p { margin: 1.5mm 0; } #p-verified-assumptions .card h2 { font-size: 3.4mm !important; margin: 0 0 1.5mm; }`}</style>
  <h1 style={{fontSize:'7mm',color:brandHex,margin:'0 0 2mm'}}>Hypothèses et traçabilité des résultats</h1>
  <p style={{fontSize:'3.2mm',margin:0}}>{vm?.control_export_label??'Simulation prévisionnelle : les paramètres ci-dessous définissent le périmètre des résultats.'}</p>
  {!getStudyShadingState(vm).shadingIncluded && <p data-testid="shading-exclusion" style={{fontSize:'2.8mm',margin:'2mm 0'}}>{SHADING_EXCLUSION_METHODOLOGY}</p>}
  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2.5mm',fontSize:'2.8mm',lineHeight:1.32}}>
   <section className="card soft" style={{padding:'4mm'}}><h2 style={{fontSize:'4mm',color:brandHex}}>Énergie et définitions</h2>
    <p>Production disponible côté AC du site. Solaire utile = consommation directe + restitution solaire de la batterie. Couverture = solaire utile / consommation du site. Utilisation utile = solaire utile / production.</p>
    <p>Capture avant pertes = (direct + entrée batterie) / production : {fmt(ref.ratios.captured_pv_before_storage_losses==null?null:ref.ratios.captured_pv_before_storage_losses*100,1)} %. Ce ratio inclut l'énergie perdue ou encore stockée ; il ne mesure pas l'économie de facture.</p>
    <p>Production {fmt(a.production_kwh)} kWh ; direct {fmt(a.direct_kwh)} ; entrée batterie {fmt(a.battery_charge_solar_kwh)} ; injection {fmt(a.physical_export_kwh)} ; écrêtement {fmt(a.curtailment_kwh)} kWh.</p>
    <p>Restitution solaire {fmt(a.battery_discharge_solar_kwh)} ; pertes {fmt(a.storage_losses_kwh)} ; variation du stock {fmt(a.stock_change_kwh,2)} kWh. Les arrondis séparés peuvent créer un écart de 1 kWh dans une somme affichée ; les bilans utilisent les valeurs non arrondies.</p>
   </section>
   <section className="card soft" style={{padding:'4mm'}}><h2 style={{fontSize:'4mm',color:brandHex}}>Données et stockage</h2>
    <p>{ref.provenance?.label??'Provenance des données à confirmer.'} Instants conservés en UTC ; règles commerciales et calendrier Europe/Paris. Les journées moyennes sont illustratives.</p>
    <p>Période source : {ref.provenance?.period_start??'non renseignée'} à {ref.provenance?.period_end??'non renseignée'}. Fuseau des relevés : {ref.provenance?.timezone??'non renseigné'}.</p>
    {b?<p>Batterie : {snapshot.equipment?.batterie?.label??snapshot.equipment?.batterie?.modele??'référence du dossier'}. Capacité saisie {fmt(b.capacity_kwh,2)} kWh ; plage utilisable simulée {fmt(b.usable_capacity_kwh,2)} kWh ; charge {fmt(b.max_charge_kw,2)} kW / décharge {fmt(b.max_discharge_kw,2)} kW. SOC {fmt(b.min_soc_kwh,2)}–{fmt(b.max_soc_kwh,2)} kWh, initial {fmt(b.initial_soc_kwh,2)} kWh. Rendements charge/décharge {fmt(b.charge_efficiency*100,2)} % / {fmt(b.discharge_efficiency*100,2)} %, aller-retour {fmt(b.roundtrip_efficiency*100,1)} %. Recharge réseau et veille non modélisées.</p>:<p>Aucune batterie physique dans ce scénario.</p>}
    {v&&<p>Crédit virtuel comptable : ouverture {fmt(v.opening_kwh)}, crédité {fmt(v.credited_kwh)}, utilisé {fmt(v.used_kwh)}, clôture {fmt(v.closing_kwh)} kWh. Les prélèvements physiques restent des achats au réseau avant application du crédit.</p>}
   </section>
   <section className="card soft" style={{padding:'4mm'}}><h2 style={{fontSize:'4mm',color:brandHex}}>Tarifs et contrats</h2>
    {billing ? <>
     <p>Avant : {electricityContractLabel(billing.current_contract,true)}. Après : {electricityContractLabel(billing.scenario_contract)}.</p>
     <p>{electricityBillingNote(billing)}</p>
     <p>Facture annuelle de référence : {fmt(billing.bill_before_eur,2)} € TTC ; après projet : {fmt(billing.bill_after_eur,2)} € TTC.</p>
    </> : <p>Prix variable retenu : {fmt(e.price_eur_kwh,5)} €/kWh ; statut HT/TTC : {c.retail_price_tax_basis==='unconfirmed'||!c.retail_price_tax_basis?'à confirmer':c.retail_price_tax_basis}. L'abonnement fixe reste hors économies d'énergie.</p>}
    <p>{tariff===0?'Aucune recette de vente du surplus n’est intégrée à cette étude.':`Surplus rémunéré selon l'hypothèse de ${fmt(tariff,5)} €/kWh.`} {c.injection_mode==='none'?"Fonctionnement sans injection : l'excédent est écrêté.":`Injection simulée${tariff===0?' non rémunérée':''} ; autorisation contractuelle ${c.injection_authorization_status==='confirmed'?'confirmée dans les paramètres':'à confirmer'}.`}</p>
    <p>Gestionnaire : {c.grid_operator??'à confirmer'} ; fournisseur : {c.supplier??'à confirmer'}. L'éligibilité au crédit virtuel est distincte de l'autorisation d'injection et de son tarif. {v?'Éligibilité : '+(c.virtual_credit_eligibility===true?'hypothèse renseignée pour ce scénario':'à confirmer')+'.':''}</p>
   </section>
   <section className="card soft" style={{padding:'4mm'}}><h2 style={{fontSize:'4mm',color:brandHex}}>Projection financière</h2>
    <p>Horizon {fmt(e.horizon_years)} ans ; hausse électrique {fmt(e.elec_growth_pct,2)} %/an, hypothèse non garantie. Vieillissement PV {fmt(e.pv_degradation_pct,2)} %/an{b?`, batterie ${fmt(e.battery_degradation_pct,2)} %/an`:''}. {projectionMethod==='annual_hourly_resimulation'?'Chaque année future est resimulée heure par heure avec les hypothèses de vieillissement et de remplacement enregistrées.':'Méthode de projection annuelle non précisée dans ce résultat.'}</p>
    <ProjectionAssumptions value={projection} compact/>
    <p>TRI et amortissement du projet avant coût du crédit, calculés sur les flux annuels complets. Amortissement : premier cumul net positif après investissement. LCOE simplifié : investissement net des aides, maintenance et remplacements chiffrés / production PV, actualisés à 3 % ; frais de crédit virtuel exclus du LCOE.</p>
   </section>
  </div>
  <p style={{fontSize:'2.4mm',wordBreak:'break-all'}}>Scénario {ref.scenario_id} · Moteur {snapshot.consumption_trace?.scenarios_engine_version??ref.version} · Calcul {ref.simulated_at} · Empreinte énergie {ref.input_hash} · Empreinte économique {e.hash??'non renseignée'}</p>
 </PdfPageLayout>;
}
