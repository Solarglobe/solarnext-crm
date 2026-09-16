import type {ReactNode} from 'react';
import {Link} from 'react-router-dom';
import type {FinanceProjection} from './FinanceProjectionSettings';
import {InheritedNumber,SourceBadge} from './QuoteStudyUi';
export default function QuoteCalculationInputs({children,value={},onChange,disabled,defaults,total}:{children:ReactNode;value?:FinanceProjection;onChange:(v:FinanceProjection)=>void;disabled:boolean;defaults:Record<string,number>|null;total:number}) {
 const set=(key:keyof FinanceProjection,v:number|undefined)=>onChange({...value,[key]:v});
 return <section className="sqb-section sqb-calculation-inputs" aria-labelledby="sqb-inputs-title">
  <div className="sqb-section-heading"><div><span className="sqb-eyebrow">Références de calcul</span><h2 className="sqb-h2" id="sqb-inputs-title">Données utilisées pour cette étude</h2><p className="sqb-help">Identifiez les sources, puis ajustez seulement ce qui est propre à ce projet.</p></div></div>
  {children}
  <div className="sqb-section-heading sqb-reference-heading"><h3>Paramètres et devis</h3><Link to="/admin/settings/pv" className="sqb-text-link">Ouvrir les paramètres</Link></div>
  <div className="sqb-reference-grid">
   <div className="sqb-source-value"><div className="sqb-value-heading"><span>Hausse du prix de l’électricité</span><SourceBadge source="Paramètre général"/></div><strong className="sqb-read-value">{defaults?.elec_growth_pct==null?'Non disponible':`${defaults.elec_growth_pct.toLocaleString('fr-FR')} % / an`}</strong><p className="sqb-help">Valeur générale utilisée au prochain calcul.</p></div>
   <InheritedNumber label="Entretien annuel" value={value.maintenance_pct} fallback={defaults?.maintenance_pct??null} unit="% de l’investissement" disabled={disabled} onChange={v=>set('maintenance_pct',v)} />
   <div className="sqb-source-value"><div className="sqb-value-heading"><span>Montant du devis SolarGlobe</span><SourceBadge source="Calculé automatiquement"/></div><strong className="sqb-read-value">{total.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})} TTC</strong><a href="#sqb-material" className="sqb-text-link">Voir les lignes du devis</a></div>
  </div>
  {!defaults&&<p className="sqb-help">Les paramètres généraux ne sont pas accessibles ici. Aucune valeur de remplacement n’est enregistrée.</p>}
  <details className="sqb-disclosure sqb-reference-details"><summary>Abonnements et restitution <span>Hypothèses de hausse annuelle</span></summary><p className="sqb-help">Par défaut, le logiciel n’applique aucune hausse à ces trois postes. Ces valeurs sont indépendantes du prix du kWh.</p><div className="sqb-reference-grid">
   <InheritedNumber label="Abonnements fournisseur, avant et après" value={value.supplier_subscription_growth_pct} fallback={0} unit="% / an" help="Défaut du logiciel : 0 %." disabled={disabled} onChange={v=>set('supplier_subscription_growth_pct',v)}/>
   <InheritedNumber label="Abonnement batterie virtuelle" value={value.virtual_subscription_growth_pct} fallback={0} unit="% / an" help="Défaut du logiciel : 0 %." disabled={disabled} onChange={v=>set('virtual_subscription_growth_pct',v)}/>
   <InheritedNumber label="Prix de restitution virtuelle" value={value.virtual_restitution_growth_pct} fallback={0} unit="% / an" help="Défaut du logiciel : 0 %." disabled={disabled} onChange={v=>set('virtual_restitution_growth_pct',v)}/>
  </div></details>
 </section>;
}
