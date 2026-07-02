# Analyse — Matériel de pose toit plat (K2 Systems / Enstall-ESDEC) et adaptation du calepinage

Date : 02/07/2026 — analyse seule, aucun code modifié.
Objectif : ajouter en phase 3, quand le pan est en toiture plate, un bouton « Choix du matériel de pose »
(systèmes K2 et Enstall/ESDEC) et adapter le calepinage aux contraintes de chaque système
(espacement inter-rangées, orientation, simple/double panneau, inclinaison, marges).

---

## 1. État actuel du calepinage phase 3 sur toit plat

Le socle existe déjà et il est plus avancé que prévu :

| Capacité | État | Où |
|---|---|---|
| Détection toiture plate (`roofType = "FLAT"`) | ✅ | `pvPlacementEngine.js` (`isFlatRoofContext`, ~:533) |
| Bascule UI « Passer en toiture plate » | ✅ | `Phase3Sidebar.tsx` (`Phase3FlatRoofControls`, ~:114-180) |
| Inclinaison support | ✅ mais **5° / 10° / 15° codés en dur** | `flatRoofConfig.supportTiltDeg` |
| Pose portrait / paysage | ✅ | `flatRoofConfig.layoutOrientation` |
| Marges toit plat (recul bord / obstacle) | ✅ (`setbackRoofEdgeCm`, `setbackObstacleCm`) | `safeZoneAdapter.js` ~:494 |
| Espacement rangées | ✅ paramètres `spacingXcm` / `spacingYcm` **fixes, non liés à un matériel** | `pvPlacementEngine.js`, `ghostSlots.js` |
| Notion de matériel de pose / marque | ❌ **inexistante** (aucun catalogue, aucune référence K2/ESDEC) | — |
| Rangées doubles dos-à-dos (est-ouest) | ❌ inexistant (placement = grille simple mono-azimut) | — |
| Espacement inter-rangées anti-ombrage calculé | ❌ (valeur fixe saisie, pas de formule h×tilt/soleil) | — |

Chaîne de données : Sidebar → `__applyFlatRoofConfigAndRecompute(panId, {...})` →
`CALPINAGE_STATE.roof.roofPans[panId].flatRoofConfig` → adapter legacy → moteur de placement.
**L'infrastructure pour ajouter un paramètre par pan existe donc déjà** — c'est le bon point d'accroche.

Rappel bugs connus phase 3 (audit 17/05, non corrigés) : clignotement, panneau invisible après pose,
drag figé, obstacles bloquant le clic — à garder en tête, ce chantier va re-solliciter ce code.

## 2. Offre K2 Systems toit plat (toitures terrasses)

Source : [k2-systems.com — systèmes toitures terrasses](https://k2-systems.com/fr/categorie-de-produits-solutions/systemes-pour-toitures-terrasses/), [page Dome 6](https://k2-systems.com/fr/solutions-de-produits/systeme-dome-6/).

| Système | Config | Inclinaison | Particularités |
|---|---|---|---|
| **S-Dome 6** (Classic / Xpress / LS) | **Simple orientation (sud)** | 10° (**Dome 6.15 : 15°**) | Module en paysage (LS = fixation côté long, modules jusqu'à 2390×1170 mm) ; Classic = « espacement entre rangées flexible » ; Xpress = espacement imposé par le Dome Speed Spacer, montage 50 % plus rapide (prémonté 80 %) |
| **D-Dome 6** (Classic / Xpress / LS / Lifted LS) | **Double orientation (est-ouest, dos-à-dos)** | 10° | Densité maximale, faible lestage ; Lifted = ancres de toit (membrane) |
| **Dome V** (S / D) | Simple ou double | 10° | Génération précédente, rails discontinus |
| **Dome Zero** | Parallèle à la toiture | 0° (pose parallèle) | Toits en pente ≤ 10° |
| **TiltUp Vento** | Simple | **20° / 25° / 30°** | Portrait ou paysage, grands modules |
| **Triangle / MultiAngle** | Simple | Réglable (jusqu'à 45°) | Portrait ou paysage, chevalets |
| **GreenRoof (2.0 / Vento)** | Simple/double | ~10° | Toitures végétalisées |
| **Dome 6 sur tôle trapézoïdale** | Simple/double | 10° | Composants D-Dome sur BasicRail |

Points transverses K2 : supports béton/bitume/membrane/gravier/végétalisé/tôle ; **Dome FixPro**
(ancrage obligatoire si pente > 3° et possible ≤ 10°, ou faible réserve de charge) ; **Mat S** (protection +
frottement) ; lestage calculé par **K2 Base** (leur outil, gratuit) ; pour la France : **ETN, décennale,
B ROOF(t3)** (ICPE/ERP) — bon argument devis.

## 3. Offre Enstall (ESDEC) toit plat

Source : [esdec.com — FlatFix Fusion](https://www.esdec.com/en/flatfix-fusion/), [FlatFix Wave Plus](https://www.esdec.com/en/flatfix-wave-plus/).

| Système | Config | Inclinaison | Modules | Particularités |
|---|---|---|---|---|
| **FlatFix Fusion (paysage)** | **Simple (sud) ou double (est-ouest)** | **13° fixe** | L 1550-2190 mm × l 990-1150 mm, cadre 30-50 mm | Pente toit max 7° (collage dès 3°, PVC 2°) ; champ max 20×20 m ; rangées de longueur flexible (contournement obstacles) ; déflecteurs de vent ; clic sans outils |
| **FlatFix Fusion Portrait** | Simple | 13° | L 1690-1780 × l 1000-1140 mm | Petites toitures (extensions, carports) |
| **FlatFix Wave / Wave Plus** | Double est-ouest | 10° | Jusqu'à 1149 mm de large | **⚠ Transféré chez PanelClaw** (groupe Enstall) pour les grands projets commerciaux — calculateur calculator.panelclaw.eu |

Points transverses ESDEC : béton/bitume/EPDM/PVC/TPO ; lestage calculé par l'**Enstall Calculator** ;
découplage thermique (protection membrane). Pour le résidentiel/petit tertiaire de SolarGlobe,
**FlatFix Fusion est LE système pertinent** ; Wave = gros commercial via PanelClaw.

## 4. Ce que ça impose au calepinage — les 5 vrais impacts

**4.1 — Catalogue « systèmes de pose toit plat »** (nouveau). Champs par système :
marque, gamme, variante, `arrangement` (`SOUTH_SINGLE` | `EAST_WEST_DUAL` | `PARALLEL`),
`tiltDeg` (fixe ou options), `moduleOrientation` (imposée ou choix), limites modules (L×l×épaisseur),
`rowSpacingMode` (`FIXED_SYSTEM` ex. Xpress/Fusion | `FLEXIBLE` ex. Dome Classic | `CALCULATED` anti-ombrage),
`rowGapCm` / `pairGapCm` par défaut, `setbackRoofEdgeCm` par défaut, pente toit max, champ max (20×20 m Fusion),
types de couverture, flags France (ETN, B ROOF t3), lien calculateur fabricant.
Stockage recommandé : table `pv_mounting_systems` (comme `pv_virtual_batteries`) + seed des ~8 systèmes
ci-dessus, éditable en réglages org.

**4.2 — Le dos-à-dos est-ouest est un changement STRUCTUREL.** Aujourd'hui le placement pose une
grille mono-azimut sur le pan. En `EAST_WEST_DUAL` (D-Dome, Fusion Dual) il faut :
- placer des **paires** de rangées dos-à-dos (motif : paire + couloir de maintenance) ;
- surtout, la **production** : la moitié des panneaux est orientée ~est (azimut −90° relatif) et l'autre ~ouest.
  Le moteur PV calcule aujourd'hui UNE production par pan (un azimut, un tilt). Il faudra soit deux
  sous-groupes de panneaux avec leurs azimuts propres (le moteur ombrage par panneau existe déjà),
  soit un pan virtuel double. **C'est le gros morceau du chantier** — l'équivalent d'un « multi-pan » sur un seul pan plat.

**4.3 — Espacement inter-rangées.** Trois modes à supporter dans le moteur (aujourd'hui : valeur fixe) :
- `FIXED_SYSTEM` : l'entraxe vient du catalogue (gabarit Xpress, pas de Fusion) → verrouiller le champ ;
- `FLEXIBLE` : saisie libre bornée (Dome Classic) ;
- `CALCULATED` : anti-ombrage `d = h·sin(β) / tan(α_soleil_hiver)` (β = tilt système, h = hauteur module
  inclinée, α = hauteur solaire à midi au solstice selon latitude du lead — déjà connue). Utile pour
  TiltUp 20-30° où l'ombre portée devient dominante.
En est-ouest dual, l'espacement inter-paires est quasi nul (aérodynamique) — c'est l'argument densité.

**4.4 — Contraintes induites à faire respecter par le placement :**
- orientation portrait/paysage **imposée** par le système (Fusion paysage vs Fusion Portrait ; S-Dome paysage) →
  griser les boutons Portrait/Paysage actuels selon le système choisi ;
- inclinaison **imposée ou à options** (13° Fusion ; 10/15° Dome ; 20/25/30° TiltUp) → remplacer les boutons
  5/10/15° codés en dur par les options du catalogue (5° actuel ne correspond à aucun des deux fabricants !) ;
- vérif compatibilité module (dimensions panneau du devis vs limites système) → warning bloquant ;
- pente réelle du pan vs pente max système (7° Fusion, 10° Dome Zero, ancrage FixPro >3°) → warning ;
- champ max (20×20 m Fusion) → scinder les blocs.

**4.5 — Aval du calepinage :** le choix du système doit sortir du calepinage vers :
- le **devis technique** (BOM : le matériel de pose devient une ligne chiffrable, comme la batterie) ;
- le **PDF** (mention système + classement B ROOF t3/ETN si K2) ;
- l'**attestation de charge** (lestage ~60-90 kg/m² : le poids système+lest devrait apparaître) — le calcul de
  lestage exact reste chez le fabricant (K2 Base / Enstall Calculator), on stocke juste le lien + le rappel.

## 5. Plan de mise en œuvre proposé (4 lots)

1. **Lot A — Catalogue + UI choix système** : table + seed + bouton « Matériel de pose » dans
   `Phase3FlatRoofControls` (visible si pan FLAT) ; la sélection pilote tilt/orientation/marges/espacement
   depuis le catalogue (les mécanismes `flatRoofConfig` existants suffisent). Sans changer le moteur :
   couvre déjà S-Dome, TiltUp, Fusion simple sud. *Effort : faible.*
2. **Lot B — Espacement intelligent** : 3 modes d'espacement + formule anti-ombrage + bornes.
   *Effort : moyen, localisé dans pvPlacementEngine/ghostSlots.*
3. **Lot C — Est-ouest dual** : motif de paires dos-à-dos + azimuts est/ouest par sous-groupe de panneaux
   dans le moteur de production/ombrage. *Effort : élevé — à cadrer par un audit dédié du moteur de
   production par panneau avant de coder.*
4. **Lot D — Aval** : ligne devis technique, PDF, snapshot. *Effort : faible-moyen.*

## 6. Questions ouvertes avant de coder

1. Périmètre marques : seulement K2 + ESDEC Fusion, ou aussi PanelClaw (gros tertiaire) ?
2. L'est-ouest dual (Lot C) est-il prioritaire pour tes projets actuels, ou du sud simple suffit au départ ?
3. Le prix du matériel de pose : catalogue interne SolarGlobe (€/module par système) pour alimenter le devis ?
4. Faut-il exposer le choix 5° actuel encore quelque part (rétrocompat études existantes) ?

---

**Verdict** : l'ajout du bouton et du catalogue est peu risqué et rapide (Lot A) car `flatRoofConfig` et sa
chaîne UI→moteur existent déjà ; la vraie complexité est l'**est-ouest dos-à-dos** (production bi-azimut) qui
mérite son propre audit avant d'être codé. Recommandation : livrer A+B d'abord (couvre S-Dome 6/6.15,
TiltUp Vento, Fusion sud), puis cadrer C.

---

## 7. LOT A — LIVRÉ le 02/07/2026 (V1 validée Benoit)

**Fichiers** :
- `frontend/src/modules/calpinage/legacy/flatRoofMountingSystems.js` (+ `.d.ts`) — catalogue pur des
  6 systèmes (4 sud actifs ; **D-Dome 6 E-O et Fusion E-O présents mais `enabled:false`**, motif
  « production bi-azimut non gérée — Lot C », refusés aussi côté normalisation → jamais appliqués au moteur).
  Helpers : `resolveSlopeStatusForSystem` (règle Fusion demandée : ≤3° OK / 3-7° alerte collage / >7° bloquant ;
  K2 : >3° alerte FixPro / >10° bloquant), `checkPanelCompatibility`, `buildMountingSystemSnapshot`.
- `legacy/flatRoofConfig.js` — `normalizeFlatRoofConfig` : branche système (tilt/orientation imposés ou à
  options, inter-rangées imposée V1, marges par défaut, snapshot `mountingSystem` persisté pour devis/PDF
  Lot D) ; **branche legacy strictement inchangée** (5/10/15°, 55 cm — rétrocompat anciennes études,
  5° uniquement là). Aucune modification de `calpinage.module.js` : la normalisation est le point de
  passage unique (spacing → `pvRules.spacingYcm` via rowSpacingCm existant).
- `components/Phase3Sidebar.tsx` — sélecteur « Matériel de pose » (visible seulement pan FLAT),
  E-O grisés avec toast explicatif, boutons d'inclinaison générés depuis le système (5/10/15 seulement en
  mode générique), portrait/paysage grisés si imposés, alerte pente colorée (ok/warning/bloquant),
  **rappel lestage non calculé + lien K2 Base / Enstall Calculator**, gabarit modules affiché.
- Projection : `storeTypes` / `calpinageStore` / `legacyCalpinageStateAdapter` / `usePhase3Data`
  (+ `mountingSystemId`, `panSlopeDeg`, tilt élargi à number) ; `PlacementRules.ts` type élargi.

**Tests** : `__tests__/flatRoofMountingSystems.test.js` (15) + `__tests__/flatRoofConfig.test.js` étendu —
28/28 verts, dont : E-O refusés, 5° hors catalogue fabricant, règle pente Fusion aux bornes (3°/5°/8°),
pente inconnue = « unknown » (bug `Number(null)=0` attrapé et corrigé), re-normalisation stable.

**Reste à faire** : Lot B (modes espacement), Lot C est-ouest (audit moteur bi-azimut d'abord).

---

## 8. LOT D — LIVRÉ le 03/07/2026 (affichage informatif devis/PDF, lecture seule du snapshot Lot A)

**Chaîne** : `payload.validatedRoofData.pans[].flatRoofConfig.mountingSystem` (persisté à la validation
du calepinage) → extraction pure `backend/services/quotePrep/flatRoofMounting.util.js`
(`extractFlatRoofMountingFromPans` + `formatFlatRoofMountingForPdf`) → devis technique
(`quotePrep.service` : champ `flat_roof_mounting` du `technical_snapshot_summary` → bloc informatif
`QuoteFlatRoofMounting` sous le Résumé technique de `StudyQuoteBuilder`) et PDF
(`pdfViewModel.service` → `mapper` : `offer.systemes_pose[]` + `offer.systeme_pose_note` →
lignes conditionnelles « Système de pose » dans la section Configuration de `PdfPage3`).

**Garanties** : aucune re-résolution catalogue (snapshot figé), aucun prix, aucun calcul de lestage
(mention imposée : « Lestage définitif à confirmer via l'outil fabricant (…) / étude technique dédiée. »),
lien calculateur seulement si présent ET https, garde structurelle `arrangement === "SOUTH_SINGLE"`
(un snapshot est-ouest injecté n'est jamais affiché), multi-pans = une ligne par pan (« Pan N : … »),
absent/incomplet → strictement aucun changement d'affichage (rétrocompat totale).

**Validation** : `tests/flatRoofMounting.test.mjs` 8/8 (les 8 cas limites du GO : sans système, incliné,
plat générique, K2, Fusion, snapshot incomplet, multi-pans, E-O injecté) ; non-régression
`pdfVirtualBatteryPage` 1/1 + `test-pdf-viewmodel-mapper` 6/6 ; `tsc --noEmit` 0 erreur ;
syntaxe des 4 fichiers backend vérifiée. Note : la ligne devis vit dans le « Résumé technique »
(pas dans le tableau « Matériel principal », qui est chiffré — pas de prix inventé).
