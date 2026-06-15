# Audit des calculs — Batterie virtuelle (3 fournisseurs)

Date : 12/06/2026
Périmètre : moteur de calcul des 3 offres de batterie virtuelle (URBAN_SOLAR, MYLIGHT_MYBATTERY, MYLIGHT_MYSMARTBATTERY), du devis technique jusqu'au résultat de scénario.
Nature : audit (lecture seule). Aucune modification de code. Toutes les valeurs ci-dessous ont été vérifiées en exécutant le moteur réel ou par lecture directe des constantes.

---

## 1. Comment fonctionne chaque offre (modèle attendu)

| | Urban Solar | MyLight MyBattery | MyLight MySmartBattery |
|---|---|---|---|
| Capacité | Illimitée (crédit) | Illimitée (crédit) | Paliers contractuels (20 → 10 000 kWh) |
| Abonnement | 1 €/kWc/mois + abonnement fixe selon kVA | 1 €/kWc/mois (+ abo fixe MyLight selon kVA) | Forfait €/mois selon palier de capacité |
| Coût restitution énergie | €/kWh (énergie + réseau) | €/kWh (restitution + réseau) | 0 €/kWh (inclus dans le palier) |
| Contribution autoproducteur | €/an | €/an | €/an (selon kVA) |
| Frais d'activation | 0 € | 232,50 € HT | 0 € |

Le moteur calcule l'énergie (simulation 8760 h) puis applique le tarif du fournisseur. Pour les deux offres illimitées (Urban, MyBattery) la capacité de simulation est la même (capacité « théorique » nécessaire), donc **leur partie énergie est identique par construction** ; seuls les coûts (abonnement, contribution, restitution) les distinguent. MySmartBattery utilise une capacité de palier, donc sa partie énergie peut différer (risque de saturation).

Le moteur a **deux sources de tarifs** :

- **Mode grille** : `organizations.settings_json.pv.virtual_battery` est renseigné → tarifs lus dans la grille org (barème 2026 par défaut côté front).
- **Mode legacy** : pas de grille org exploitable → constantes en dur dans `services/core/engineConstants.js`.

**La quasi-totalité des incohérences trouvées viennent du fait que le mode legacy ne reproduit PAS le mode grille.** Si ton organisation n'a pas saisi les grilles, tu es en mode legacy.

---

## 2. Verdict par fournisseur

### 2.1 Urban Solar — globalement COHÉRENT ✔

Le mode legacy reproduit fidèlement la grille 2026 :

- Abonnement BASE = `1 €/kWc/mois × kWc + abo fixe (selon kVA) × 12`. Vérifié : 6 kWc / 9 kVA → 72 + 185,76 = **257,76 €/an HT**. ✔
- Restitution BASE = énergie (0,1308 ou 0,1297) + réseau (0,0484). Legacy et grille donnent le même résultat. ✔
- HP/HC : sommes legacy (HP 0,1906 / HC 0,1357) = sommes grille. ✔
- Contribution = 9,60 €/an. ✔

**Conclusion : Urban Solar est l'offre de référence saine.** Les écarts décrits ci-dessous concernent surtout MyBattery et MySmart, et le traitement HP/HC commun.

### 2.2 MyLight MyBattery — plusieurs FAUX en mode legacy �’✘

Trois écarts qui rendent MyBattery artificiellement bon marché quand il n'y a pas de grille org :

| Élément | Mode legacy (réel) | Mode grille 2026 (attendu) | Écart (6 kWc / 9 kVA / 1500 kWh) |
|---|---|---|---|
| Coût restitution BASE | 0,07925 €/kWh (restitution seule) | 0,12765 €/kWh (restitution + réseau 0,0484) | **−72,60 €/an omis** |
| Contribution autoproducteur | 9,60 €/an (défaut générique) | 3,96 €/an | +5,64 €/an (sens inverse) |
| Abonnement fixe MyLight | **absent** (72 €/an seulement) | inclus (≈ +173,52 €/an à 9 kVA) | **−173,52 €/an omis** |

Conséquence : en legacy, MyBattery est compté ~186 €/an moins cher qu'il ne devrait, **et** beaucoup moins cher qu'Urban Solar, alors que cette différence n'est pas réelle — elle vient d'une asymétrie de modélisation (Urban inclut son abonnement fixe, MyBattery non).

### 2.3 MyLight MySmartBattery — un FAUX sur la contribution ✘

- Paliers d'abonnement : identiques entre legacy et grille (20→179,16 €/mois). ✔
- Coût restitution = 0 €/kWh (forfait). Cohérent avec le modèle de l'offre. ✔
- **Contribution autoproducteur incohérente** :
  - Legacy : `9,60 + 2,38 × kVA` → à 9 kVA = **31,02 €/an**.
  - Grille (contributionRule a=3,96, b=0) : `3,96 × kVA` → à 9 kVA = **35,64 €/an**.
  - Les deux formules se croisent vers 6 kVA : en dessous le legacy est plus cher, au-dessus moins cher. Il faut trancher laquelle est correcte.
- Donnée morte : les `segments[...].rowsByKva` de MySmart contiennent restitution/réseau/contribution **jamais utilisés** par le moteur (MySmart passe par `capacityTiers` + `contributionRule`). À nettoyer pour éviter la confusion.

---

## 3. Le problème le plus grave : HP/HC perd le coût de restitution ✘✘ (CRITIQUE)

En contrat **HP/HC**, le coût de restitution de l'énergie (la principale charge variable) nécessite un masque horaire HP/HC (`hphc_hourly_slot_is_hp`) pour ventiler les kWh déstockés entre heures pleines et heures creuses.

**Ce masque n'est alimenté nulle part dans le pipeline réel** (vérifié : seuls les tests le fournissent ; ni le constructeur de payload ni le contrôleur ne le remplissent). Résultat : la ventilation échoue (`PARTIAL_HPHC_ALLOCATION`), et le coût de restitution est mis à `null` puis **purement et simplement retiré du total**.

Impact chiffré (6 kWc / 9 kVA / 1500 kWh déstockés) :

| Fournisseur (HP/HC) | Total réel pipeline (sans masque) | Total correct (avec masque) | Sous-estimation |
|---|---|---|---|
| Urban Solar | 320,83 € TTC/an | 630,97 € TTC/an | **−49 %** |
| MyLight MyBattery | 97,92 € TTC/an | 233,74 € TTC/an | **−58 %** |

Autrement dit, **tout devis en HP/HC sous-estime massivement le coût de la batterie virtuelle Urban et MyBattery**, ce qui gonfle artificiellement les économies et le ROI présentés au client. MySmartBattery n'est pas concerné (déstockage à 0 €).

---

## 4. Synthèse des anomalies et sévérité

| # | Anomalie | Fournisseur(s) | Sévérité | Effet |
|---|---|---|---|---|
| 1 | Coût de restitution HP/HC retiré du total (masque HP/HC jamais alimenté) | Urban, MyBattery | **CRITIQUE** | Devis HP/HC sous-estimés de ~50 % |
| 2 | Abonnement fixe omis en legacy + réseau omis sur restitution BASE | MyBattery | **ÉLEVÉE** | MyBattery faussement ~186 €/an trop bas, comparaison inter-offres biaisée |
| 3 | Contribution legacy vs grille divergente | MyBattery (9,6 vs 3,96), MySmart (31,02 vs 35,64) | MOYENNE | Écart de coût annuel selon le mode |
| 4 | Restitution HP/HC grille = prix de détail MyLight (0,1606/0,0856) ≠ restitution BASE (0,07925) | MyBattery | MOYENNE | Tarif de restitution incohérent entre BASE et HP/HC, à confirmer |
| 5 | Constantes legacy HP/HC MyBattery (0,08025/0,06585) d'origine non vérifiable, ≠ grille | MyBattery | FAIBLE | Valeurs probablement obsolètes |
| 6 | Lignes `segments` de MySmart inutilisées (données mortes) | MySmart | FAIBLE | Confusion / risque de divergence future |
| 7 | Question de fond : l'abonnement électricité de détail doit-il compter dans le coût BV ? | Urban, MyBattery | À ARBITRER | Équité de la comparaison vs scénario BASE |

> Note : le bug « le résultat ne changeait pas selon le fournisseur » (provider_code non propagé) et la sauvegarde différée ont déjà été corrigés le 12/06/2026 — hors périmètre de cet audit.

---

## 5. Plan de correction proposé (priorisé)

> À valider avant toute implémentation. Aucune correction n'a été appliquée.

### Lot 1 — CRITIQUE : coût de restitution HP/HC

Objectif : que les déstockages HP/HC soient toujours tarifés.

1. **Alimenter le masque HP/HC** `hphc_hourly_slot_is_hp` à partir des heures creuses du compteur (ou d'un profil HP/HC standard si le détail n'est pas saisi), dans `solarnextPayloadBuilder.service.js` (construction de `virtual_battery_input`), pour qu'il arrive jusqu'à `computeVirtualBatteryP2Finance` via `calc.controller.js` (lignes 1265 / 1547).
2. **À défaut de masque, prévoir un repli déterministe** plutôt que `null` : appliquer un ratio HP/HC par défaut (ex. 60/40) ou tarifer au prix BASE, comme c'est déjà fait pour `computeVirtualBatteryQuoteFromGrid`. Aujourd'hui le code met le coût à `null` puis l'exclut du total — c'est ce comportement « silencieux » qu'il faut supprimer.
3. **Garde-fou** : si le coût de restitution HP/HC ne peut pas être calculé, le scénario doit être marqué non fiable (avertissement visible), pas affiché comme un total bas.

Fichiers : `virtualBatteryP2Finance.service.js` (lignes 251‑259, 422‑441), `solarnextPayloadBuilder.service.js`, `calc.controller.js`.

### Lot 2 — ÉLEVÉE : aligner le mode legacy sur la grille (MyBattery)

Objectif : que l'absence de grille org ne fausse pas le coût ni la comparaison entre offres.

1. **Inclure l'abonnement fixe MyBattery** en legacy (comme Urban l'inclut déjà), ou — décision symétrique — **exclure l'abonnement fixe des deux** offres illimitées. Choisir une règle unique (voir Lot 5).
2. **Ajouter le réseau (0,0484 €/kWh) au coût de restitution BASE legacy** de MyBattery : passer de 0,07925 à 0,12765 €/kWh (constante `VB_LEGACY_MYBATTERY_BASE_DISCHARGE_EUR_PER_KWH_HT`).
3. **Harmoniser la contribution MyBattery** legacy (9,60) avec la grille (3,96) — ou l'inverse, selon la valeur réelle du contrat.

Fichier : `services/core/engineConstants.js` (lignes 153‑157), `virtualBatteryP2Finance.service.js` (branches legacy MyBattery, lignes 359‑372).

### Lot 3 — MOYENNE : contribution MySmartBattery

1. Déterminer la formule correcte de contribution autoproducteur MySmart (PDF fournisseur) et n'en garder qu'une, partagée entre legacy (`vbLegacyMySmartAnnualContributionHt`) et grille (`contributionRule`). Aujourd'hui : `9,6 + 2,38×kVA` (legacy) vs `3,96×kVA` (grille).

Fichiers : `services/core/engineConstants.js` (lignes 151‑152), `virtualBatteryTariffs2026.ts` (`contributionRule`).

### Lot 4 — MOYENNE : restitution HP/HC MyBattery dans la grille

1. Vérifier auprès du barème MyLight si la restitution MyBattery HP/HC doit réellement utiliser les prix de détail (0,1606/0,0856) ou un tarif de restitution dédié cohérent avec le BASE (0,07925). Corriger `buildMyBatterySegmentHphc()` si nécessaire.

Fichier : `frontend/src/data/virtualBatteryTariffs2026.ts` (lignes 79‑94).

### Lot 5 — Décision de fond (à arbitrer avant Lot 2)

L'abonnement électricité de détail (MyLight / Urban) doit-il être compté dans le coût de la batterie virtuelle ? Dans une comparaison équitable contre le scénario BASE, le client paie déjà un abonnement électricité dans les deux cas. Deux options cohérentes :

- **Option A** : inclure l'abonnement fournisseur dans les deux scénarios (BV et BASE) → comparaison nette.
- **Option B** : l'exclure des deux → ne comparer que le surcoût propre au service de stockage virtuel.

Le choix conditionne les Lots 2 et 4. La situation actuelle (inclus pour Urban, exclu pour MyBattery, pas de symétrie côté BASE) est la principale source de distorsion entre offres.

### Lot 6 — FAIBLE : nettoyage

1. Supprimer ou ignorer explicitement les `segments` de MySmartBattery (données mortes).
2. Documenter / supprimer les constantes legacy HP/HC MyBattery non vérifiables (0,08025 / 0,06585).

---

## 6. Recommandation de validation

Pour fiabiliser durablement, ajouter un **test de non-régression « 3 fournisseurs »** qui, sur un cas type (BASE et HP/HC), vérifie que :
- les 3 totaux sont distincts et > 0 ;
- le coût de restitution HP/HC n'est jamais `null` ni exclu silencieusement ;
- legacy et grille donnent des montants cohérents (écart sous un seuil) pour un même fournisseur.

Cela évite que ces écarts réapparaissent après une future modification.
