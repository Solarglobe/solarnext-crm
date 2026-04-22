/**
 * Normalisation formulaire → payload JSON backend (aucune logique métier).
 */

import type { VisiteTechniqueFormData } from "../../components/visiteTechnique/VisiteTechniqueV2";

/* ——— Types payload (contrat API) ——— */

export type VisiteTechniquePayloadMeta = {
  version: "v1";
  created_at: string;
  updated_at: string;
};

export type VisiteTechniquePayloadBatiment = {
  type_batiment: string | null;
  type_construction: string | null;
  annee_construction: number | null;
  nb_etages: number | null;
  gps: {
    lat: number | null;
    lng: number | null;
    alt: number | null;
  };
};

export type VisiteTechniquePayloadToiture = {
  type_couverture: string | null;
  etat_couverture: string | null;
  type_charpente: string | null;
  materiau_charpente: string | null;
  amiante: boolean | null;
  ecran_sous_toiture: boolean | null;
  type_ecran: string | null;
  isolation: boolean | null;
  combles_accessibles: boolean | null;
  combles_amenages: boolean | null;
};

export type VisiteTechniquePayloadElectrique = {
  type_raccordement: string | null;
  linky: boolean | null;
  emplacement_compteur: string | null;
  ddr_30ma: boolean | null;
  prise_terre: string | null;
  valeur_terre: number | null;
};

export type VisiteTechniquePayloadChantier = {
  acces_toit: string | null;
  stockage: boolean | null;
  point_ancrage: boolean | null;
  nacelle: boolean | null;
  contraintes: string | null;
};

export type VisiteTechniquePayloadEnvironnement = {
  reseau_gsm: string | null;
  zone_abf: string | null;
  vis_a_vis: boolean | null;
  ombrage: boolean | null;
};

export type VisiteTechniquePayloadProjet = {
  puissance_kwc: number | null;
  type_integration: string | null;
  orientation_deg: number | null;
  inclinaison_deg: number | null;
  pose: string | null;
};

export type VisiteTechniquePayloadStatus = {
  completion: number;
};

export type VisiteTechniquePayload = {
  meta: VisiteTechniquePayloadMeta;
  batiment: VisiteTechniquePayloadBatiment;
  toiture: VisiteTechniquePayloadToiture;
  electrique: VisiteTechniquePayloadElectrique;
  chantier: VisiteTechniquePayloadChantier;
  environnement: VisiteTechniquePayloadEnvironnement;
  projet: VisiteTechniquePayloadProjet;
  status: VisiteTechniquePayloadStatus;
};

export type VisiteTechniqueFilesBundle = {
  batiment: File[];
  toiture: File[];
  tableau: File[];
  environnement: File[];
};

/* ——— Normalisation ——— */

function normString(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value === "" ? null : value;
}

function normNumberField(value: number | ""): number | null {
  if (value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function normOptionalNumber(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function normBoolean(value: boolean | undefined): boolean | null {
  if (value === undefined) return null;
  return value;
}

/* ——— API publique ——— */

export function buildVisiteTechniquePayload(
  formData: VisiteTechniqueFormData
): VisiteTechniquePayload {
  const { batiment, toiture, electrique, chantier, environnement, projet, meta, status } =
    formData;

  return {
    meta: {
      version: "v1",
      created_at: meta.createdAt,
      updated_at: meta.updatedAt,
    },
    batiment: {
      type_batiment: normString(batiment.typeBatiment),
      type_construction: normString(batiment.typeConstruction),
      annee_construction: normNumberField(batiment.anneeConstruction),
      nb_etages: normNumberField(batiment.nbEtages),
      gps: {
        lat: normOptionalNumber(batiment.gps.latitude),
        lng: normOptionalNumber(batiment.gps.longitude),
        alt: normOptionalNumber(batiment.gps.altitude),
      },
    },
    toiture: {
      type_couverture: normString(toiture.typeCouverture),
      etat_couverture: normString(toiture.etatCouverture),
      type_charpente: normString(toiture.typeCharpente),
      materiau_charpente: normString(toiture.materiauCharpente),
      amiante: normBoolean(toiture.amiante),
      ecran_sous_toiture: normBoolean(toiture.ecranSousToiture),
      type_ecran: normString(toiture.typeEcran),
      isolation: normBoolean(toiture.isolation),
      combles_accessibles: normBoolean(toiture.comblesAccessibles),
      combles_amenages: normBoolean(toiture.comblesAmenages),
    },
    electrique: {
      type_raccordement: normString(electrique.typeRaccordement),
      linky: normBoolean(electrique.presenceLinky),
      emplacement_compteur: normString(electrique.emplacementCompteur),
      ddr_30ma: normBoolean(electrique.presenceDDR),
      prise_terre: normString(electrique.priseTerre),
      valeur_terre: normNumberField(electrique.valeurTerre),
    },
    chantier: {
      acces_toit: normString(chantier.accesToit),
      stockage: normBoolean(chantier.stockagePossible),
      point_ancrage: normBoolean(chantier.pointAncrage),
      nacelle: normBoolean(chantier.besoinNacelle),
      contraintes: normString(chantier.contraintesSpecifiques),
    },
    environnement: {
      reseau_gsm: normString(environnement.reseauGSM),
      zone_abf: normString(environnement.zoneABF),
      vis_a_vis: normBoolean(environnement.visAvis),
      ombrage: normBoolean(environnement.ombrage),
    },
    projet: {
      puissance_kwc: normNumberField(projet.puissanceSouhaitee),
      type_integration: normString(projet.typeIntegration),
      orientation_deg: normNumberField(projet.orientation),
      inclinaison_deg: normNumberField(projet.inclinaison),
      pose: normString(projet.typePose),
    },
    status: {
      completion: status.completion,
    },
  };
}

export function extractVisiteTechniqueFiles(
  formData: VisiteTechniqueFormData
): VisiteTechniqueFilesBundle {
  const p = formData.photos;
  return {
    batiment: [...p.batiment],
    toiture: [...p.toiture],
    tableau: [...p.tableau],
    environnement: [...p.environnement],
  };
}
