/**
 * items-p11-premium.js — Phase 11 : Fonctionnalités Premium (niveau Aurora/Archelios)
 *
 * Ce qui manque vs les leaders du marché et N'EST PAS dans la roadmap actuelle.
 * 5 items (F1–F5) — vérifiés contre la codebase réelle le 2026-05-16.
 *
 * NOTA BENE :
 *   F1 — L'infrastructure far shading EXISTE déjà (backend/horizon_mask/ +
 *        backend/shading/horizonMaskEngine.js) mais n'est PAS connectée au frontend.
 *        C'est un branchement, pas un chantier from scratch.
 *   F2–F5 — Fonctionnalités entièrement nouvelles à construire.
 */

ITEMS.push(

  /* ────────────────────────────────────────────────────────────────────
     F1 — Far Shading / Masque solaire horizon
     Infrastructure existante : backend non connecté au frontend
  ──────────────────────────────────────────────────────────────────── */
  {
    id:          "F1",
    phaseId:     "premium",
    title:       "Far Shading — Masque Solaire Horizon",
    priority:    "critique",
    difficulty:  4,
    impact:      5,
    effort:      "3j+",
    areas:       ["frontend", "backend", "3d"],
    files: [
      "backend/horizon_mask/compute_horizon_mask.py",
      "backend/horizon_mask/fetch_lidarhd_mnt_manifest.py",
      "backend/shading/horizonMaskEngine.js",
      "backend/routes/shading.routes.js",
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
      "frontend/src/modules/calpinage/canonical3d/nearShading3d/nearShading3dLayer.ts",
      "frontend/src/modules/calpinage/canonical3d/featureFlags.ts",
      "frontend/src/modules/calpinage/store/calpinageStore.ts",
    ],
    description: `L'infrastructure far shading EXISTE DÉJÀ dans la codebase mais n'est pas branchée au frontend.

EXISTANT (backend) :
• backend/horizon_mask/compute_horizon_mask.py — Calcul masque horizon depuis données LiDAR HD IGN (MNT 1m). Génère un profil angulaire (azimut → élévation max) sur 360°.
• backend/horizon_mask/fetch_lidarhd_mnt_manifest.py — Fetch du manifest IGN LiDAR HD, localisation des tuiles MNT couvrant le site.
• backend/shading/horizonMaskEngine.js — Moteur JS qui consomme le profil horizon et calcule le facteur d'ombrage lointain par tranche horaire.

CE QUI MANQUE (à implémenter) :
1. Route API : exposer POST /api/shading/horizon-mask (coordonnées GPS → profil horizon JSON).
2. Appel frontend : déclencher la route après validation Phase 2, stocker le résultat dans calpinageStore.
3. Visualisation 3D : afficher le profil horizon comme un anneau SVG/Three.js en overlay dans SolarScene3DViewer (style Aurora Solar horizon line).
4. Intégration calcul : transmettre horizonMask au moteur de production (calc.controller.js) pour corriger les heures d'ensoleillement.

IMPACT MÉTIER : Sans far shading, les simulations surestiment la production de 5–25 % sur sites avec obstacles distants (collines, bâtiments voisins). Archelios et Aurora l'affichent systématiquement dans leurs rapports.`,
    riskDetails:  "La route Python compute_horizon_mask.py peut timeout sur sites avec nombreuses tuiles LiDAR (prévoir timeout 30s + cache Redis/fichier). Le profil horizon doit être invalidé si les coordonnées GPS du projet changent.",
    dependencies: ["C1", "S1"],
    prompt: `# Contexte
Le projet SolarNext a une infrastructure far shading complète côté backend (backend/horizon_mask/ + backend/shading/horizonMaskEngine.js) mais elle n'est pas connectée au frontend.

# Objectif
Connecter le masque horizon au workflow calpinage en 4 étapes :

## Étape 1 — Route API
Dans backend/routes/shading.routes.js (ou créer backend/routes/horizonMask.routes.js) :
\`\`\`js
POST /api/shading/horizon-mask
Body: { lat: number, lng: number, radiusM?: number }
Response: { azimuthDeg: number[], elevationDeg: number[] }  // 360 points
\`\`\`
Appelle compute_horizon_mask.py via child_process.spawn (Python).
Timeout 30s. Cache résultat par (lat,lng,radius) dans un fichier JSON temporaire.

## Étape 2 — Store Zustand
Dans frontend/src/modules/calpinage/store/calpinageStore.ts, ajouter :
\`\`\`ts
horizonMask: { azimuthDeg: number[]; elevationDeg: number[] } | null;
setHorizonMask: (mask: ...) => void;
\`\`\`

## Étape 3 — Appel depuis Phase 2
Dans frontend/src/modules/calpinage/components/Phase2Sidebar.tsx, après validation des coordonnées GPS :
\`\`\`ts
const res = await fetch('/api/shading/horizon-mask', { method:'POST', body: JSON.stringify({lat, lng}) });
const mask = await res.json();
store.setHorizonMask(mask);
\`\`\`
Protéger avec le feature flag ENABLE_FAR_SHADING dans canonical3d/featureFlags.ts.

## Étape 4 — Visualisation 3D
Dans SolarScene3DViewer.tsx, si horizonMask != null, tracer une ligne Three.js (LineLoop) représentant le profil horizon en coordonnées sphériques autour de la scène (rayon 500m, hauteur Y = tan(elevationDeg) * 500).
Couleur : orange translucide (0xff6b35, opacity 0.6). Label "Masque horizon" dans la légende.

# Contraintes
- Ne pas bloquer le rendu 3D si la route échoue (try/catch, log warning)
- Tester avec coordonnées réelles : lat=45.18, lng=5.72 (Grenoble, site montagneux)
- Ne pas modifier compute_horizon_mask.py (il fonctionne)`,
  },

  /* ────────────────────────────────────────────────────────────────────
     F2 — Auto-Shading Inter-Rangées
     Calcul de l'ombrage rangée sur rangée (toiture plate / sol)
  ──────────────────────────────────────────────────────────────────── */
  {
    id:          "F2",
    phaseId:     "premium",
    title:       "Auto-Shading Inter-Rangées (Flat Roof / Ground-Mount)",
    priority:    "important",
    difficulty:  4,
    impact:      4,
    effort:      "3j+",
    areas:       ["backend", "frontend", "3d"],
    files: [
      "backend/shading/rowToRowShading.js",
      "backend/controllers/calc.controller.js",
      "frontend/src/modules/calpinage/store/calpinageStore.ts",
      "frontend/src/modules/calpinage/canonical3d/pvPanels/pvPanelsLayer.ts",
      "frontend/src/modules/calpinage/components/Phase3Checklist.tsx",
    ],
    description: `Calcul de l'ombrage inter-rangées (row-to-row shading) pour toitures plates et installations au sol. Absent de la roadmap actuelle, essentiel pour tout projet ≥ 2 rangées.

PROBLÈME ACTUEL :
Le moteur near shading calcule l'ombrage des obstacles proches mais n'implémente pas la géométrie spécifique des rangées parallèles (angle d'inclinaison, pitch, largeur panneau). Un calpinage sur toiture plate avec 3 rangées de 10 panneaux ne calcule pas l'ombrage de la rangée 1 sur la rangée 2 à 8h du matin en décembre.

FORMULE CIBLE :
Hauteur ombre portée = H × cos(β) / sin(α_soleil)
où H = hauteur panneau × sin(tilt), β = angle azimut relatif, α_soleil = altitude solaire.

Pitch minimum IEC recommandé : pitch = H / tan(α_min) avec α_min = altitude solaire à 9h au solstice d'hiver.

À IMPLÉMENTER :
1. backend/shading/rowToRowShading.js — Moteur de calcul : prend (tilt, azimuth, pitch, panelHeight, latitude) → retourne facteur d'ombrage horaire (8760h) et pitch minimum recommandé.
2. Intégration dans calc.controller.js — Appliquer le facteur inter-rangées à chaque heure de simulation.
3. Visualisation 3D — Dans pvPanelsLayer.ts : projeter l'ombre portée d'une rangée sur la rangée suivante (shape Three.js translucide) selon l'heure sélectionnée.
4. Alerte dans Phase 3 — Si pitch actuel < pitch minimum recommandé, afficher un warning dans Phase3Checklist avec le pitch recommandé.`,
    riskDetails:  "La projection 3D des ombres inter-rangées peut entrer en conflit avec le near shading existant. Bien séparer les layers. Le calcul doit être recalculé si l'utilisateur modifie tilt, azimuth ou pitch dans la configuration.",
    dependencies: ["S1", "S2", "C1"],
    prompt: `# Contexte
SolarNext calcule l'ombrage proche (near shading) mais pas l'ombrage inter-rangées pour les installations en rangées parallèles (toitures plates, sol). C'est une feature manquante critique.

# Objectif
Implémenter le calcul et la visualisation de l'ombrage inter-rangées.

## Étape 1 — Moteur backend
Créer backend/shading/rowToRowShading.js :
\`\`\`js
/**
 * Calcule le facteur d'ombrage inter-rangées et le pitch minimum recommandé.
 * @param {object} params
 * @param {number} params.tiltDeg      — Inclinaison des panneaux (°)
 * @param {number} params.azimuthDeg   — Azimut des panneaux (° depuis N)
 * @param {number} params.pitchM       — Distance entre rangées (m, bord à bord)
 * @param {number} params.panelHeightM — Hauteur d'un panneau (m)
 * @param {number} params.latitudeDeg  — Latitude du site (°)
 * @returns {{ shadingFactor8760: number[], pitchMinRecommendedM: number }}
 */
function computeRowToRowShading(params) { ... }
module.exports = { computeRowToRowShading };
\`\`\`

Algorithme :
- Pour chaque heure h sur 8760 : calculer altitude solaire α et azimut solaire Az
- Hauteur ombre = panelHeight × sin(tilt) × cos(Az - azimuth) / tan(α)
- Si hauteur ombre > 0 et pitchM < hauteur ombre → shadingFactor = (hauteur_ombre - pitchM) / panelWidth (clampé [0,1])
- pitchMinRecommendedM = panelHeight × sin(tilt) / tan(altitude_solaire_9h_21_dec)

## Étape 2 — Intégration calc.controller.js
Dans la boucle de calcul de production, multiplier l'irradiance par (1 - shadingFactor[h]) pour chaque heure.

## Étape 3 — Visualisation 3D (pvPanelsLayer.ts)
Ajouter une fonction drawRowShadow(hour, rowIndex) qui trace un PlaneGeometry translucide (couleur bleu-gris, opacity 0.3) projeté au sol depuis chaque rangée. Déclenché par un slider horaire dans l'UI.

## Étape 4 — Warning Phase 3
Dans Phase3Checklist.tsx, si store.rowToRowResult.pitchMinRecommendedM > store.currentLayout.pitchM, afficher :
"⚠️ Pitch actuel (Xm) inférieur au pitch minimum recommandé (Ym). Pertes estimées : Z%/an."

# Contraintes
- L'algorithme de position solaire doit être cohérent avec celui utilisé dans le near shading existant
- Le shadingFactor8760 doit être exportable dans le rapport PDF de l'étude`,
  },

  /* ────────────────────────────────────────────────────────────────────
     F3 — Validation Électrique (String Sizing / DC-AC / MPPT)
     Dimensionnement conforme IEC 62109 / NF C 15-100
  ──────────────────────────────────────────────────────────────────── */
  {
    id:          "F3",
    phaseId:     "premium",
    title:       "Validation Électrique — String Sizing, DC/AC Ratio, MPPT",
    priority:    "important",
    difficulty:  3,
    impact:      5,
    effort:      "3j+",
    areas:       ["backend", "frontend"],
    files: [
      "backend/electrical/stringSizing.js",
      "backend/electrical/dcAcRatio.js",
      "backend/controllers/calc.controller.js",
      "frontend/src/modules/calpinage/components/Phase3Checklist.tsx",
      "frontend/src/modules/calpinage/store/calpinageStore.ts",
    ],
    description: `Validation électrique complète du dimensionnement PV, absente de SolarNext. Aurora Solar et Helios3D proposent une validation automatique avec alertes couleur (vert/orange/rouge) sur chaque critère.

CRITÈRES À VALIDER :

1. STRING SIZING (IEC 62109 / guide UTE C 15-712-1) :
   • Tension Voc max string ≤ Vmax onduleur × 0.95 (marge thermique)
   • Tension Vmpp string dans plage [Vmpp_min_onduleur, Vmpp_max_onduleur]
   • Courant Isc max ≤ Imax entrée MPPT
   • Calcul à Tmin site (typiquement −10°C France), avec coefficients de température panneau

2. DC/AC RATIO :
   • Ratio = P_crête_DC / P_AC_onduleur
   • Optimal : 1.10 – 1.30 (selon DNI site)
   • Alerte si < 1.05 (sous-utilisation onduleur) ou > 1.40 (clipping excessif)

3. MPPT CHECK :
   • Nombre strings par MPPT ≤ max MPPT onduleur
   • Équilibrage : strings par MPPT identiques ou ±1 panneau
   • Alerte si déséquilibre > 15%

SORTIE ATTENDUE :
JSON de validation avec statut par critère {ok|warning|error} + valeur mesurée + limite + message explicatif.
Dashboard visuel dans Phase3Checklist avec codes couleur.`,
    riskDetails:  "Nécessite une base de données d'onduleurs avec leurs caractéristiques MPPT (Fronius, SMA, Huawei…). Prévoir un fichier JSON statique minimal ou une API externe. Les coefficients de température varient par panneau — stocker dans le modèle de panneau.",
    dependencies: ["W2", "W3"],
    prompt: `# Contexte
SolarNext ne valide pas le dimensionnement électrique (string sizing, DC/AC ratio, MPPT). C'est un gap critique : un bureau d'études doit pouvoir vérifier que le câblage est conforme avant de déposer le dossier.

# Objectif
Implémenter un moteur de validation électrique et son affichage dans Phase 3.

## Étape 1 — Moteur String Sizing (backend/electrical/stringSizing.js)
\`\`\`js
/**
 * @param {object} panel   — { vocSTC, vmppSTC, iscSTC, tempCoeffVoc (%/°C) }
 * @param {object} inverter — { vmppMin, vmppMax, vocMax, imppMax }
 * @param {number} nSeries  — Nombre de panneaux en série
 * @param {number} tMinC    — Température minimale site (°C, défaut −10)
 * @returns {{ vocMaxString, vmppString, iscString, checks: Check[] }}
 */
\`\`\`
Formule Voc corrigée : Voc_T = Voc_STC × (1 + tempCoeffVoc/100 × (tMin - 25))
Checks : { criterion, measured, limit, status: 'ok'|'warning'|'error', message }

## Étape 2 — DC/AC Ratio (backend/electrical/dcAcRatio.js)
\`\`\`js
function computeDcAcRatio({ panelWp, panelCount, inverterKw }) {
  const ratio = (panelWp * panelCount) / (inverterKw * 1000);
  const status = ratio < 1.05 ? 'warning' : ratio > 1.40 ? 'error' : 'ok';
  return { ratio, status, clippingEstimatePct: Math.max(0, (ratio - 1.25) * 8) };
}
\`\`\`

## Étape 3 — Intégration calc.controller.js
Appeler stringSizing() et computeDcAcRatio() pendant le calcul. Inclure le résultat dans la réponse JSON sous \`electricalValidation\`.

## Étape 4 — Dashboard Phase3Checklist.tsx
Ajouter une section "Validation Électrique" avec un tableau :
| Critère         | Mesuré   | Limite    | Statut |
|----------------|----------|-----------|--------|
| Voc max string | 1 020 V  | ≤ 1 000 V | 🔴 KO  |
| DC/AC ratio    | 1.18     | 1.05–1.30 | 🟢 OK  |
| MPPT balance   | ±2 pan.  | ≤ ±1      | 🟡 ⚠️  |

Couleurs : CSS var(--critical) pour error, var(--warning) pour warning, var(--success) pour ok.

# Données minimales onduleur à prévoir
Créer backend/electrical/inverterDatabase.json avec 10 modèles courants (Fronius Symo, SMA Sunny Tripower, Huawei SUN2000) avec vmppMin/Max, vocMax, imppMax, puissance.`,
  },

  /* ────────────────────────────────────────────────────────────────────
     F4 — Support Panneaux Bifaciaux
     Gain bifacial, albédo sol, irradiance face arrière
  ──────────────────────────────────────────────────────────────────── */
  {
    id:          "F4",
    phaseId:     "premium",
    title:       "Support Panneaux Bifaciaux — Gain Bifacial & Albédo",
    priority:    "important",
    difficulty:  3,
    impact:      4,
    effort:      "2j",
    areas:       ["backend", "frontend"],
    files: [
      "backend/shading/bifacialGain.js",
      "backend/controllers/calc.controller.js",
      "frontend/src/modules/calpinage/store/calpinageStore.ts",
      "frontend/src/modules/calpinage/components/Phase2Sidebar.tsx",
      "frontend/src/modules/calpinage/canonical3d/featureFlags.ts",
    ],
    description: `Les panneaux bifaciaux représentent >40% du marché en 2026. SolarNext ne les supporte pas. Aurora Solar et PVsyst modélisent le gain bifacial selon la norme IEC 60904-1-2.

MODÈLE BIFACIAL SIMPLIFIÉ (niveau Archelios) :
Gain bifacial = bifaciality_factor × albedo × view_factor × G_diffus_arriere

où :
• bifaciality_factor : coefficient du panneau (typiquement 0.65–0.80), fourni par fabricant
• albedo : réflectivité du sol (béton gris = 0.20, gravier blanc = 0.35, herbe = 0.22, neige = 0.80)
• view_factor : fraction du sol "vue" par la face arrière (~0.85 pour rangée surélevée 30cm)
• G_diffus_arriere : irradiance diffuse au sol (estimée à 15–25% de G_global)

PRODUCTION CORRIGÉE :
P_bifacial = P_monofacial × (1 + gain_bifacial)

À IMPLÉMENTER :
1. Modèle de panneau : ajouter champ isBifacial + bifacialityFactor dans la fiche panneau (Phase2Sidebar).
2. Sélection albédo : dropdown "Type de sol" dans Phase 2 avec valeurs d'albédo prédéfinies.
3. Moteur backend/shading/bifacialGain.js : calcul du gain par heure ou par mois.
4. Application dans calc.controller.js : corriger P_total si panneau bifacial.
5. Afficher "+X% gain bifacial" dans les résultats de simulation.`,
    riskDetails:  "Le modèle simplifié peut surestimer le gain bifacial sur installations avec inter-rangées proches (ombrage face arrière). Prévoir un avertissement si pitch < 2× hauteur panneau. Ne pas activer par défaut (feature flag ENABLE_BIFACIAL).",
    dependencies: ["F2"],
    prompt: `# Contexte
SolarNext ne supporte pas les panneaux bifaciaux. Les projets modernes utilisent majoritairement du bifacial. Ajouter le support sans casser le calcul monofacial existant.

# Objectif
Implémenter le calcul de gain bifacial et l'intégration dans le workflow.

## Étape 1 — Modèle panneau étendu (Phase2Sidebar.tsx)
Ajouter deux champs dans le formulaire de sélection panneau :
\`\`\`tsx
<label>Panneau bifacial
  <input type="checkbox" name="isBifacial" />
</label>
{isBifacial && (
  <label>Bifacialité (%)
    <input type="number" name="bifacialityFactor" min="60" max="85" defaultValue={70} />
  </label>
)}
<label>Type de sol (albédo)
  <select name="albedo">
    <option value="0.20">Béton gris (0.20)</option>
    <option value="0.22">Herbe (0.22)</option>
    <option value="0.30">Gravier clair (0.30)</option>
    <option value="0.35">Gravier blanc (0.35)</option>
    <option value="0.60">Toiture membrane blanche (0.60)</option>
    <option value="0.80">Neige (0.80)</option>
  </select>
</label>
\`\`\`

## Étape 2 — Moteur bifacial (backend/shading/bifacialGain.js)
\`\`\`js
/**
 * @param {object} p
 * @param {number} p.bifacialityFactor  — 0.65 à 0.80
 * @param {number} p.albedo             — réflectivité sol
 * @param {number} p.tiltDeg            — inclinaison panneau
 * @param {number} p.pitchM             — distance inter-rangées
 * @param {number} p.heightAboveGroundM — garde au sol
 * @param {number[]} p.gGlobal8760      — irradiance globale horaire (W/m²)
 * @returns {{ gainFactor: number, gainPct: number }}
 */
function computeBifacialGain(p) {
  const viewFactor = 0.5 × (1 - Math.cos(p.tiltDeg * Math.PI/180));  // simplified
  const gRear = p.gGlobal8760.map(g => g * 0.15 * p.albedo);
  const gainPct = p.bifacialityFactor * p.albedo * viewFactor * 100;
  return { gainFactor: 1 + gainPct/100, gainPct };
}
module.exports = { computeBifacialGain };
\`\`\`

## Étape 3 — Intégration calc.controller.js
\`\`\`js
if (config.isBifacial) {
  const bifacial = computeBifacialGain({ ...config, gGlobal8760: hourlyIrradiance });
  totalKwh *= bifacial.gainFactor;
  result.bifacialGainPct = bifacial.gainPct;
}
\`\`\`

## Étape 4 — Feature flag
Dans canonical3d/featureFlags.ts, ajouter ENABLE_BIFACIAL = false (activer manuellement en dev).

## Étape 5 — Résultats
Dans la vue résultats, afficher :
"Gain bifacial estimé : +X.X% (+Y kWh/an)" si isBifacial.`,
  },

  /* ────────────────────────────────────────────────────────────────────
     F5 — Simulation Yield TMY (données météo réelles, P50/P90)
     Niveau PVsyst / Aurora Solar
  ──────────────────────────────────────────────────────────────────── */
  {
    id:          "F5",
    phaseId:     "premium",
    title:       "Simulation Yield TMY — Météo Réelle, P50/P90, Température Cellule",
    priority:    "important",
    difficulty:  5,
    impact:      5,
    effort:      "3j+",
    areas:       ["backend", "frontend"],
    files: [
      "backend/weather/fetchTMY.js",
      "backend/weather/cellTemperature.js",
      "backend/controllers/calc.controller.js",
      "frontend/src/modules/calpinage/components/Phase3Checklist.tsx",
      "frontend/src/modules/calpinage/store/calpinageStore.ts",
    ],
    description: `SolarNext utilise un calcul de production simplifié (irradiance PVGIS moyenne, température fixe). Les logiciels leaders (PVsyst, Aurora) utilisent des données TMY (Typical Meteorological Year) horaires avec modèle de température cellule et intervalles d'incertitude P50/P90.

COMPOSANTS À IMPLÉMENTER :

1. DONNÉES TMY :
   Source : PVGIS API v5 (gratuite) — endpoint /seriescalc avec outputformat=json.
   Alternative : open-meteo.com (données ERA5 horaires, 30 ans d'historique, API gratuite).
   Résolution : 8760 valeurs horaires (GHI, DHI, DNI, T_air, WindSpeed).

2. MODÈLE TEMPÉRATURE CELLULE (NOCT ou Faiman) :
   T_cellule = T_air + (NOCT - 20) / 800 × G_irradiance
   Correction puissance : P_T = P_STC × (1 + γ × (T_cellule - 25))
   où γ = tempCoeffPmax (%/°C, typiquement −0.35 à −0.45).

3. VARIABILITÉ INTER-ANNUELLE (P50/P90) :
   P50 = production médiane (50e percentile des années historiques).
   P90 = production dépassée 90% des années (valeur prudente pour financement).
   Méthode simplifiée : P90 ≈ P50 × (1 − 1.28 × σ_relative)
   σ_relative ≈ 4–6% (variabilité typique France).

4. COURBE DE PRODUCTION MENSUELLE :
   Graphique bar chart (12 mois) avec barres P50 + overlay P90.
   Intégré dans les résultats Phase 3.

IMPACT : La différence P50 vs simulation actuelle peut atteindre ±10%. Les banquiers et assureurs exigent P90 pour les projets > 100 kWc.`,
    riskDetails:  "L'API PVGIS peut être lente (2–5s) ou indisponible. Mettre en cache les données TMY par (lat, lng) avec TTL 30 jours. L'API open-meteo est plus fiable mais nécessite un post-traitement pour convertir ERA5 en GHI/DHI. Prévoir fallback sur irradiance mensuelle PVGIS si l'API TMY échoue.",
    dependencies: ["C1", "F1"],
    prompt: `# Contexte
SolarNext calcule la production avec une irradiance moyenne annuelle. Les professionnels du secteur PV attendent des données TMY horaires, un modèle de température cellule, et des intervalles P50/P90. C'est la feature qui sépare un outil "amateur" d'un outil "bureau d'études".

# Objectif
Implémenter la simulation yield basée sur données TMY avec modèle thermique et incertitudes.

## Étape 1 — Fetch TMY (backend/weather/fetchTMY.js)
\`\`\`js
const PVGIS_TMY_URL = 'https://re.jrc.ec.europa.eu/api/v5_2/seriescalc';

async function fetchTMY(lat, lng) {
  const url = \`\${PVGIS_TMY_URL}?lat=\${lat}&lon=\${lng}&outputformat=json&browser=0\`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const json = await res.json();
  // Extraire GHI, DHI, T2m sur 8760h depuis json.outputs.hourly
  return { ghi8760, dhi8760, tAir8760 };  // arrays de 8760 valeurs
}
module.exports = { fetchTMY };
\`\`\`
Mettre en cache par (lat,lng) dans backend/weather/cache/ (JSON, TTL = 30 jours via mtime).

## Étape 2 — Modèle Température Cellule (backend/weather/cellTemperature.js)
\`\`\`js
/**
 * Modèle NOCT (IEC 61215)
 * @param {number[]} ghi8760    — Irradiance (W/m²) horaire
 * @param {number[]} tAir8760   — Température air (°C) horaire
 * @param {number}   noct       — NOCT panneau (°C, typique 45)
 * @param {number}   tempCoeff  — Coefficient température Pmax (%/°C, ex: -0.40)
 * @returns {{ tCell8760: number[], corrFactor8760: number[] }}
 */
function computeCellTemperature({ ghi8760, tAir8760, noct, tempCoeff }) {
  return ghi8760.map((g, i) => {
    const tCell = tAir8760[i] + ((noct - 20) / 800) * g;
    const corrFactor = 1 + (tempCoeff / 100) * (tCell - 25);
    return { tCell, corrFactor };
  });
}
module.exports = { computeCellTemperature };
\`\`\`

## Étape 3 — Intégration calc.controller.js
\`\`\`js
// Remplacer le calcul simplifié par :
const { ghi8760, dhi8760, tAir8760 } = await fetchTMY(lat, lng);
const thermalCorr = computeCellTemperature({ ghi8760, tAir8760, noct: panel.noct, tempCoeff: panel.tempCoeff });

const kwh8760 = ghi8760.map((g, h) => {
  const irr = g / 1000;  // kW/m²
  const p = panelCount * panelKwp * irr * thermalCorr[h].corrFactor * (1 - systemLosses);
  return p;
});

const totalKwhP50 = kwh8760.reduce((a,b) => a+b, 0);
const totalKwhP90 = totalKwhP50 * (1 - 1.28 * 0.05);  // σ=5%
result.tmy = { totalKwhP50, totalKwhP90, monthly12: aggregateMonthly(kwh8760) };
\`\`\`

## Étape 4 — Graphique Phase3Checklist.tsx
Ajouter un bar chart (Canvas 2D ou SVG) des 12 mois de production :
- Barres bleues = P50 mensuel (kWh)
- Overlay rouge translucide = P90 mensuel
- Légende : "P50 : X XXX kWh/an | P90 : Y YYY kWh/an"
Pas de dépendance externe : utiliser SVG pur (12 rect + axes).

## Étape 5 — Export rapport
Inclure le tableau P50/P90 mensuel dans le PDF de l'étude (si feature PDF existe).

# Données panneau requises pour ce calcul
Ajouter dans le modèle panneau : noct (°C) et tempCoeffPmax (%/°C).
Valeurs par défaut si non renseignées : noct=45, tempCoeffPmax=-0.40.`,
  },

);
