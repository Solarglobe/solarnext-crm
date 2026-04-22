/**
 * Formulaire « Visite technique V2 » — saisie, analyse automatique, export payload (sauvegarde API ultérieure).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildVisiteTechniquePayload } from "../../modules/visiteTechnique/visiteTechnique.mapper";
import {
  evaluateVisiteTechnique,
  type VisiteTechniqueChantierDifficulte,
} from "../../modules/visiteTechnique/visiteTechnique.rules";
import { Card } from "../ui/Card";
import styles from "./VisiteTechniqueV2.module.css";

const DIFFICULTE_LABELS: Record<VisiteTechniqueChantierDifficulte, string> = {
  FACILE: "Facile",
  MOYENNE: "Moyenne",
  DIFFICILE: "Difficile",
};

/* ——— Types (noms stables pour backend / scoring) ——— */

export type GpsData = {
  latitude?: number;
  longitude?: number;
  altitude?: number;
};

export type BatimentData = {
  typeBatiment: string;
  typeConstruction: string;
  anneeConstruction: number | "";
  nbEtages: number | "";
  gps: GpsData;
};

export type ToitureData = {
  typeCouverture: string;
  etatCouverture: string;
  typeCharpente: string;
  materiauCharpente: string;
  amiante: boolean;
  ecranSousToiture: boolean;
  typeEcran: string;
  isolation: boolean;
  comblesAccessibles: boolean;
  comblesAmenages: boolean;
};

export type ElectriqueData = {
  typeRaccordement: "mono" | "tri" | "";
  presenceLinky: boolean;
  emplacementCompteur: string;
  presenceDDR: boolean;
  priseTerre: string;
  valeurTerre: number | "";
};

export type ChantierData = {
  accesToit: "facile" | "difficile" | "";
  stockagePossible: boolean;
  pointAncrage: boolean;
  besoinNacelle: boolean;
  contraintesSpecifiques: string;
};

export type EnvironnementData = {
  reseauGSM: string;
  zoneABF: string;
  visAvis: boolean;
  ombrage: boolean;
};

export type ProjetData = {
  puissanceSouhaitee: number | "";
  typeIntegration: string;
  orientation: number | "";
  inclinaison: number | "";
  typePose: "portrait" | "paysage" | "";
};

export type PhotosData = {
  batiment: File[];
  toiture: File[];
  tableau: File[];
  environnement: File[];
};

export type VisiteTechniqueMeta = {
  version: "v1";
  createdAt: string;
  updatedAt: string;
};

export type VisiteTechniqueStatus = {
  /** 0–100 — calcul métier ultérieur */
  completion: number;
};

export type VisiteTechniqueFormData = {
  batiment: BatimentData;
  toiture: ToitureData;
  electrique: ElectriqueData;
  chantier: ChantierData;
  environnement: EnvironnementData;
  projet: ProjetData;
  photos: PhotosData;
  meta: VisiteTechniqueMeta;
  status: VisiteTechniqueStatus;
};

type DataSection = keyof Omit<
  VisiteTechniqueFormData,
  "meta" | "status"
>;

const BASE_FORM_DATA: Omit<VisiteTechniqueFormData, "meta" | "status"> = {
  batiment: {
    typeBatiment: "",
    typeConstruction: "",
    anneeConstruction: "",
    nbEtages: "",
    gps: {},
  },
  toiture: {
    typeCouverture: "",
    etatCouverture: "",
    typeCharpente: "",
    materiauCharpente: "",
    amiante: false,
    ecranSousToiture: false,
    typeEcran: "",
    isolation: false,
    comblesAccessibles: false,
    comblesAmenages: false,
  },
  electrique: {
    typeRaccordement: "",
    presenceLinky: false,
    emplacementCompteur: "",
    presenceDDR: false,
    priseTerre: "",
    valeurTerre: "",
  },
  chantier: {
    accesToit: "",
    stockagePossible: false,
    pointAncrage: false,
    besoinNacelle: false,
    contraintesSpecifiques: "",
  },
  environnement: {
    reseauGSM: "",
    zoneABF: "",
    visAvis: false,
    ombrage: false,
  },
  projet: {
    puissanceSouhaitee: "",
    typeIntegration: "",
    orientation: "",
    inclinaison: "",
    typePose: "",
  },
  photos: {
    batiment: [],
    toiture: [],
    tableau: [],
    environnement: [],
  },
};

function createInitialForm(): VisiteTechniqueFormData {
  const ts = new Date().toISOString();
  return {
    ...BASE_FORM_DATA,
    meta: {
      version: "v1",
      createdAt: ts,
      updatedAt: ts,
    },
    status: {
      completion: 0, // 0-100 (calculé plus tard)
    },
  };
}

const STORAGE_KEY_PREFIX = "visite-technique-";

function storageKeyForClient(clientId: string): string {
  return `${STORAGE_KEY_PREFIX}${clientId}`;
}

function serializeVisiteTechniqueForStorage(
  data: VisiteTechniqueFormData
): string {
  return JSON.stringify({
    ...data,
    photos: {
      batiment: [],
      toiture: [],
      tableau: [],
      environnement: [],
    },
  });
}

function hydrateVisiteTechniqueFromStorage(
  raw: string,
  base: VisiteTechniqueFormData
): VisiteTechniqueFormData {
  try {
    const p = JSON.parse(raw) as Partial<VisiteTechniqueFormData>;
    if (!p || typeof p !== "object") return base;
    return {
      batiment: {
        ...base.batiment,
        ...(p.batiment ?? {}),
        gps: {
          ...base.batiment.gps,
          ...(p.batiment?.gps ?? {}),
        },
      },
      toiture: { ...base.toiture, ...(p.toiture ?? {}) },
      electrique: { ...base.electrique, ...(p.electrique ?? {}) },
      chantier: { ...base.chantier, ...(p.chantier ?? {}) },
      environnement: { ...base.environnement, ...(p.environnement ?? {}) },
      projet: { ...base.projet, ...(p.projet ?? {}) },
      photos: { ...base.photos },
      meta: {
        ...base.meta,
        ...(p.meta ?? {}),
      },
      status: {
        ...base.status,
        ...(p.status ?? {}),
      },
    };
  } catch {
    return base;
  }
}

function bumpUpdatedAt(state: VisiteTechniqueFormData): VisiteTechniqueFormData {
  return {
    ...state,
    meta: {
      ...state.meta,
      updatedAt: new Date().toISOString(),
    },
  };
}

function applyVisiteChange(
  prev: VisiteTechniqueFormData,
  section: DataSection,
  path: string,
  value: unknown
): VisiteTechniqueFormData {
  switch (section) {
    case "batiment": {
      if (path.startsWith("gps.")) {
        const key = path.split(".")[1];
        if (key !== "latitude" && key !== "longitude" && key !== "altitude") {
          return prev;
        }
        const gpsKey = key as keyof GpsData;
        return {
          ...prev,
          batiment: {
            ...prev.batiment,
            gps: {
              ...prev.batiment.gps,
              [gpsKey]: value as number | undefined,
            },
          },
        };
      }
      return {
        ...prev,
        batiment: {
          ...prev.batiment,
          [path]: value,
        } as BatimentData,
      };
    }
    case "toiture":
      return {
        ...prev,
        toiture: {
          ...prev.toiture,
          [path]: value,
        } as ToitureData,
      };
    case "electrique":
      return {
        ...prev,
        electrique: {
          ...prev.electrique,
          [path]: value,
        } as ElectriqueData,
      };
    case "chantier":
      return {
        ...prev,
        chantier: {
          ...prev.chantier,
          [path]: value,
        } as ChantierData,
      };
    case "environnement":
      return {
        ...prev,
        environnement: {
          ...prev.environnement,
          [path]: value,
        } as EnvironnementData,
      };
    case "projet":
      return {
        ...prev,
        projet: {
          ...prev.projet,
          [path]: value,
        } as ProjetData,
      };
    case "photos": {
      if (
        path !== "batiment" &&
        path !== "toiture" &&
        path !== "tableau" &&
        path !== "environnement"
      ) {
        return prev;
      }
      const k = path as keyof PhotosData;
      return {
        ...prev,
        photos: {
          ...prev.photos,
          [k]: value as File[],
        },
      };
    }
    default:
      return prev;
  }
}

export type BatimentFlatKey = Exclude<keyof BatimentData, "gps">;
export type BatimentGpsPath = `gps.${keyof GpsData}`;

export type HandleVisiteChange = {
  (
    section: "batiment",
    path: BatimentFlatKey,
    value: BatimentData[BatimentFlatKey]
  ): void;
  (section: "batiment", path: BatimentGpsPath, value: number | undefined): void;
  (
    section: "toiture",
    path: keyof ToitureData,
    value: ToitureData[keyof ToitureData]
  ): void;
  (
    section: "electrique",
    path: keyof ElectriqueData,
    value: ElectriqueData[keyof ElectriqueData]
  ): void;
  (
    section: "chantier",
    path: keyof ChantierData,
    value: ChantierData[keyof ChantierData]
  ): void;
  (
    section: "environnement",
    path: keyof EnvironnementData,
    value: EnvironnementData[keyof EnvironnementData]
  ): void;
  (
    section: "projet",
    path: keyof ProjetData,
    value: ProjetData[keyof ProjetData]
  ): void;
  (section: "photos", path: keyof PhotosData, value: File[]): void;
};

/* ——— Petits sous-composants ——— */

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={styles.fieldLabel} htmlFor={htmlFor}>
      {children}
    </label>
  );
}

function BooleanSwitch({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={styles.booleanRow}>
      <span className={styles.booleanLabel} id={`${id}-label`}>
        {label}
      </span>
      <button
        type="button"
        id={id}
        className={styles.switch}
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.switchThumb} aria-hidden />
      </button>
    </div>
  );
}

function parseOptionalNumber(raw: string): number | "" {
  if (raw.trim() === "") return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : "";
}

/** Valeurs GPS optionnelles : champ vide → `undefined` pour sérialisation backend. */
function parseGpsInput(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function VisiteSectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card padding="lg" variant="default">
      <h3 className={styles.sectionHeader}>{title}</h3>
      {children}
    </Card>
  );
}

/* ——— Composant principal ——— */

export interface VisiteTechniqueV2Props {
  className?: string;
  /** Identifiant client / lead — autosave localStorage `visite-technique-${clientId}`. */
  clientId: string;
  /** Affiche le titre h2 interne (désactiver dans le modal plein écran). */
  showPageTitle?: boolean;
}

export function VisiteTechniqueV2({
  className = "",
  clientId,
  showPageTitle = true,
}: VisiteTechniqueV2Props) {
  const [formData, setFormData] = useState<VisiteTechniqueFormData>(() =>
    createInitialForm()
  );
  const skipNextAutosave = useRef(true);

  const handleChange = useCallback(
    ((section: DataSection, path: string, value: unknown) => {
      setFormData((prev) =>
        bumpUpdatedAt(applyVisiteChange(prev, section, path, value))
      );
    }) as HandleVisiteChange,
    []
  );

  useEffect(() => {
    const key = storageKeyForClient(clientId);
    const saved = localStorage.getItem(key);
    const base = createInitialForm();
    if (saved) {
      setFormData(hydrateVisiteTechniqueFromStorage(saved, base));
    } else {
      setFormData(base);
    }
    skipNextAutosave.current = true;
  }, [clientId]);

  useEffect(() => {
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    try {
      localStorage.setItem(
        storageKeyForClient(clientId),
        serializeVisiteTechniqueForStorage(formData)
      );
    } catch {
      /* quota / mode privé */
    }
  }, [formData, clientId]);

  const handleResetVisite = useCallback(() => {
    try {
      localStorage.removeItem(storageKeyForClient(clientId));
    } catch {
      /* ignore */
    }
    setFormData(createInitialForm());
  }, [clientId]);

  const showTypeEcran = formData.toiture.ecranSousToiture === true;
  const showValeurTerre = formData.electrique.priseTerre === "mesurée";

  const fileSummary = useCallback((files: readonly File[]) => {
    if (files.length === 0) return "Aucun fichier sélectionné";
    return `${files.length} fichier(s) sélectionné(s)`;
  }, []);

  const payload = useMemo(
    () => buildVisiteTechniquePayload(formData),
    [formData]
  );

  const evaluation = useMemo(
    () => evaluateVisiteTechnique(payload),
    [payload]
  );

  const gps = formData.batiment.gps;

  return (
    <div className={`${styles.root} ${className}`.trim()}>
      <div className={styles.topBar}>
        {showPageTitle ? (
          <h2 className={styles.pageTitle}>Visite Technique V2</h2>
        ) : (
          <span className={styles.topBarSpacer} aria-hidden />
        )}
        <button
          type="button"
          className={`sn-btn sn-btn-ghost sn-btn-sm ${styles.resetBtn}`}
          onClick={handleResetVisite}
        >
          Réinitialiser la visite
        </button>
      </div>

      <div className={styles.stack}>
        <VisiteSectionCard title="Bâtiment">
          <div className={styles.grid}>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-bat-type">Type de bâtiment</FieldLabel>
              <select
                id="vt-bat-type"
                className={`sn-input ${styles.inputFull}`}
                value={formData.batiment.typeBatiment}
                onChange={(e) =>
                  handleChange("batiment", "typeBatiment", e.target.value)
                }
              >
                <option value="">— Choisir —</option>
                <option value="maison">Maison</option>
                <option value="appartement">Appartement</option>
                <option value="immeuble">Immeuble</option>
                <option value="local_pro">Local professionnel</option>
                <option value="bat_agri">Bâtiment agricole</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-bat-construct">Type de construction</FieldLabel>
              <select
                id="vt-bat-construct"
                className={`sn-input ${styles.inputFull}`}
                value={formData.batiment.typeConstruction}
                onChange={(e) =>
                  handleChange("batiment", "typeConstruction", e.target.value)
                }
              >
                <option value="">— Choisir —</option>
                <option value="traditionnelle">Traditionnelle</option>
                <option value="ossature_bois">Ossature bois</option>
                <option value="pierre">Pierre</option>
                <option value="brique">Brique</option>
                <option value="beton">Béton</option>
                <option value="mixte">Mixte</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-bat-annee">Année de construction</FieldLabel>
              <input
                id="vt-bat-annee"
                type="number"
                className={`sn-input ${styles.inputFull}`}
                value={
                  formData.batiment.anneeConstruction === ""
                    ? ""
                    : formData.batiment.anneeConstruction
                }
                onChange={(e) =>
                  handleChange(
                    "batiment",
                    "anneeConstruction",
                    parseOptionalNumber(e.target.value)
                  )
                }
                min={1800}
                max={2100}
              />
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-bat-etages">Nombre d&apos;étages</FieldLabel>
              <input
                id="vt-bat-etages"
                type="number"
                className={`sn-input ${styles.inputFull}`}
                value={
                  formData.batiment.nbEtages === ""
                    ? ""
                    : formData.batiment.nbEtages
                }
                onChange={(e) =>
                  handleChange(
                    "batiment",
                    "nbEtages",
                    parseOptionalNumber(e.target.value)
                  )
                }
                min={0}
              />
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-bat-lat">Latitude</FieldLabel>
              <input
                id="vt-bat-lat"
                type="number"
                step="any"
                className={`sn-input ${styles.inputFull}`}
                value={gps.latitude ?? ""}
                onChange={(e) =>
                  handleChange(
                    "batiment",
                    "gps.latitude",
                    parseGpsInput(e.target.value)
                  )
                }
              />
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-bat-lon">Longitude</FieldLabel>
              <input
                id="vt-bat-lon"
                type="number"
                step="any"
                className={`sn-input ${styles.inputFull}`}
                value={gps.longitude ?? ""}
                onChange={(e) =>
                  handleChange(
                    "batiment",
                    "gps.longitude",
                    parseGpsInput(e.target.value)
                  )
                }
              />
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-bat-alt">Altitude (m)</FieldLabel>
              <input
                id="vt-bat-alt"
                type="number"
                step="any"
                className={`sn-input ${styles.inputFull}`}
                value={gps.altitude ?? ""}
                onChange={(e) =>
                  handleChange(
                    "batiment",
                    "gps.altitude",
                    parseGpsInput(e.target.value)
                  )
                }
              />
            </div>
          </div>
        </VisiteSectionCard>

        <VisiteSectionCard title="Toiture">
          <div className={styles.grid}>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-toit-couv">Type de couverture</FieldLabel>
              <select
                id="vt-toit-couv"
                className={`sn-input ${styles.inputFull}`}
                value={formData.toiture.typeCouverture}
                onChange={(e) =>
                  handleChange("toiture", "typeCouverture", e.target.value)
                }
              >
                <option value="">— Choisir —</option>
                <option value="tuiles">Tuiles</option>
                <option value="ardoises">Ardoises</option>
                <option value="bac_acier">Bac acier</option>
                <option value="zinc">Zinc</option>
                <option value="epdm">Membrane (EPDM…)</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-toit-etat">État de la couverture</FieldLabel>
              <select
                id="vt-toit-etat"
                className={`sn-input ${styles.inputFull}`}
                value={formData.toiture.etatCouverture}
                onChange={(e) =>
                  handleChange("toiture", "etatCouverture", e.target.value)
                }
              >
                <option value="">— Choisir —</option>
                <option value="bon">Bon</option>
                <option value="moyen">Moyen</option>
                <option value="mauvais">Mauvais</option>
                <option value="na">Non évalué</option>
              </select>
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-toit-charp">Type de charpente</FieldLabel>
              <select
                id="vt-toit-charp"
                className={`sn-input ${styles.inputFull}`}
                value={formData.toiture.typeCharpente}
                onChange={(e) =>
                  handleChange("toiture", "typeCharpente", e.target.value)
                }
              >
                <option value="">— Choisir —</option>
                <option value="trad">Traditionnelle</option>
                <option value="fermette">Fermette / industrielle</option>
                <option value="panne">Panne / poutre</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-toit-mat">Matériau de charpente</FieldLabel>
              <select
                id="vt-toit-mat"
                className={`sn-input ${styles.inputFull}`}
                value={formData.toiture.materiauCharpente}
                onChange={(e) =>
                  handleChange("toiture", "materiauCharpente", e.target.value)
                }
              >
                <option value="">— Choisir —</option>
                <option value="bois">Bois</option>
                <option value="metallique">Métallique</option>
                <option value="mixte">Mixte</option>
                <option value="inconnu">Inconnu</option>
              </select>
            </div>
            <BooleanSwitch
              id="vt-toit-amiante"
              label="Amiante (soupçon ou repérage)"
              checked={formData.toiture.amiante}
              onChange={(v) => handleChange("toiture", "amiante", v)}
            />
            <BooleanSwitch
              id="vt-toit-ecran-st"
              label="Écran sous-toiture"
              checked={formData.toiture.ecranSousToiture}
              onChange={(v) => handleChange("toiture", "ecranSousToiture", v)}
            />
            {showTypeEcran ? (
              <div className={styles.field}>
                <FieldLabel htmlFor="vt-toit-type-ecran">Type d&apos;écran</FieldLabel>
                <select
                  id="vt-toit-type-ecran"
                  className={`sn-input ${styles.inputFull}`}
                  value={formData.toiture.typeEcran}
                  onChange={(e) =>
                    handleChange("toiture", "typeEcran", e.target.value)
                  }
                >
                  <option value="">— Choisir —</option>
                  <option value="hpv">HPV</option>
                  <option value="micro_respirant">Micro-respirant</option>
                  <option value="bitume">Sous-couche bitumineuse</option>
                  <option value="autre">Autre</option>
                </select>
              </div>
            ) : null}
            <BooleanSwitch
              id="vt-toit-isol"
              label="Isolation de toiture"
              checked={formData.toiture.isolation}
              onChange={(v) => handleChange("toiture", "isolation", v)}
            />
            <BooleanSwitch
              id="vt-toit-combles-acc"
              label="Combles accessibles"
              checked={formData.toiture.comblesAccessibles}
              onChange={(v) => handleChange("toiture", "comblesAccessibles", v)}
            />
            <BooleanSwitch
              id="vt-toit-combles-am"
              label="Combles aménagés"
              checked={formData.toiture.comblesAmenages}
              onChange={(v) => handleChange("toiture", "comblesAmenages", v)}
            />
          </div>
        </VisiteSectionCard>

        <VisiteSectionCard title="Électrique">
          <div className={styles.grid}>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-elec-racc">Type de raccordement</FieldLabel>
              <select
                id="vt-elec-racc"
                className={`sn-input ${styles.inputFull}`}
                value={formData.electrique.typeRaccordement}
                onChange={(e) =>
                  handleChange(
                    "electrique",
                    "typeRaccordement",
                    e.target.value as ElectriqueData["typeRaccordement"]
                  )
                }
              >
                <option value="">— Choisir —</option>
                <option value="mono">Monophasé</option>
                <option value="tri">Triphasé</option>
              </select>
            </div>
            <BooleanSwitch
              id="vt-elec-linky"
              label="Présence Linky"
              checked={formData.electrique.presenceLinky}
              onChange={(v) => handleChange("electrique", "presenceLinky", v)}
            />
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-elec-compt">Emplacement compteur</FieldLabel>
              <select
                id="vt-elec-compt"
                className={`sn-input ${styles.inputFull}`}
                value={formData.electrique.emplacementCompteur}
                onChange={(e) =>
                  handleChange("electrique", "emplacementCompteur", e.target.value)
                }
              >
                <option value="">— Choisir —</option>
                <option value="facade">Façade</option>
                <option value="local_tech">Local technique</option>
                <option value="garage">Garage</option>
                <option value="combles">Combles</option>
                <option value="cave">Cave / sous-sol</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <BooleanSwitch
              id="vt-elec-ddr"
              label="Présence DDR / différentiel adapté"
              checked={formData.electrique.presenceDDR}
              onChange={(v) => handleChange("electrique", "presenceDDR", v)}
            />
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-elec-terre">Prise de terre</FieldLabel>
              <select
                id="vt-elec-terre"
                className={`sn-input ${styles.inputFull}`}
                value={formData.electrique.priseTerre}
                onChange={(e) =>
                  handleChange("electrique", "priseTerre", e.target.value)
                }
              >
                <option value="">— Choisir —</option>
                <option value="mesurée">Mesurée</option>
                <option value="non_mesuree">Non mesurée</option>
                <option value="absente">Absente / non visible</option>
                <option value="inconnue">Inconnue</option>
              </select>
            </div>
            {showValeurTerre ? (
              <div className={styles.field}>
                <FieldLabel htmlFor="vt-elec-val-terre">Valeur terre (Ω)</FieldLabel>
                <input
                  id="vt-elec-val-terre"
                  type="number"
                  min={0}
                  step="any"
                  className={`sn-input ${styles.inputFull}`}
                  value={
                    formData.electrique.valeurTerre === ""
                      ? ""
                      : formData.electrique.valeurTerre
                  }
                  onChange={(e) =>
                    handleChange(
                      "electrique",
                      "valeurTerre",
                      parseOptionalNumber(e.target.value)
                    )
                  }
                />
              </div>
            ) : null}
          </div>
        </VisiteSectionCard>

        <VisiteSectionCard title="Chantier">
          <div className={styles.grid}>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-ch-acc">Accès toit</FieldLabel>
              <select
                id="vt-ch-acc"
                className={`sn-input ${styles.inputFull}`}
                value={formData.chantier.accesToit}
                onChange={(e) =>
                  handleChange(
                    "chantier",
                    "accesToit",
                    e.target.value as ChantierData["accesToit"]
                  )
                }
              >
                <option value="">— Choisir —</option>
                <option value="facile">Facile</option>
                <option value="difficile">Difficile</option>
              </select>
            </div>
            <BooleanSwitch
              id="vt-ch-stock"
              label="Stockage possible sur place"
              checked={formData.chantier.stockagePossible}
              onChange={(v) => handleChange("chantier", "stockagePossible", v)}
            />
            <BooleanSwitch
              id="vt-ch-ancre"
              label="Point d&apos;ancrage / ligne de vie"
              checked={formData.chantier.pointAncrage}
              onChange={(v) => handleChange("chantier", "pointAncrage", v)}
            />
            <BooleanSwitch
              id="vt-ch-nac"
              label="Besoin nacelle / engin"
              checked={formData.chantier.besoinNacelle}
              onChange={(v) => handleChange("chantier", "besoinNacelle", v)}
            />
            <div className={`${styles.field} ${styles.span2}`}>
              <FieldLabel htmlFor="vt-ch-constraints">Contraintes spécifiques</FieldLabel>
              <textarea
                id="vt-ch-constraints"
                className={`sn-input ${styles.inputFull} ${styles.textarea}`}
                value={formData.chantier.contraintesSpecifiques}
                onChange={(e) =>
                  handleChange(
                    "chantier",
                    "contraintesSpecifiques",
                    e.target.value
                  )
                }
                rows={4}
              />
            </div>
          </div>
        </VisiteSectionCard>

        <VisiteSectionCard title="Environnement">
          <div className={styles.grid}>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-env-gsm">Réseau GSM</FieldLabel>
              <select
                id="vt-env-gsm"
                className={`sn-input ${styles.inputFull}`}
                value={formData.environnement.reseauGSM}
                onChange={(e) =>
                  handleChange("environnement", "reseauGSM", e.target.value)
                }
              >
                <option value="">— Choisir —</option>
                <option value="bon">Bon</option>
                <option value="moyen">Moyen</option>
                <option value="faible">Faible</option>
                <option value="absent">Absent</option>
              </select>
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-env-abf">Zone ABF / patrimoine</FieldLabel>
              <select
                id="vt-env-abf"
                className={`sn-input ${styles.inputFull}`}
                value={formData.environnement.zoneABF}
                onChange={(e) =>
                  handleChange("environnement", "zoneABF", e.target.value)
                }
              >
                <option value="">— Choisir —</option>
                <option value="non">Non</option>
                <option value="proximite">À proximité</option>
                <option value="oui">Oui</option>
                <option value="inconnu">Inconnu</option>
              </select>
            </div>
            <BooleanSwitch
              id="vt-env-vis"
              label="Vis-à-vis / visibilité"
              checked={formData.environnement.visAvis}
              onChange={(v) => handleChange("environnement", "visAvis", v)}
            />
            <BooleanSwitch
              id="vt-env-ombr"
              label="Ombrage avoisinant"
              checked={formData.environnement.ombrage}
              onChange={(v) => handleChange("environnement", "ombrage", v)}
            />
          </div>
        </VisiteSectionCard>

        <VisiteSectionCard title="Projet">
          <div className={styles.grid}>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-pr-puiss">Puissance souhaitée (kWc)</FieldLabel>
              <input
                id="vt-pr-puiss"
                type="number"
                min={0}
                step="any"
                className={`sn-input ${styles.inputFull}`}
                value={
                  formData.projet.puissanceSouhaitee === ""
                    ? ""
                    : formData.projet.puissanceSouhaitee
                }
                onChange={(e) =>
                  handleChange(
                    "projet",
                    "puissanceSouhaitee",
                    parseOptionalNumber(e.target.value)
                  )
                }
              />
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-pr-integ">Type d&apos;intégration</FieldLabel>
              <select
                id="vt-pr-integ"
                className={`sn-input ${styles.inputFull}`}
                value={formData.projet.typeIntegration}
                onChange={(e) =>
                  handleChange("projet", "typeIntegration", e.target.value)
                }
              >
                <option value="">— Choisir —</option>
                <option value="surimposition">Surimposition</option>
                <option value="integration">Intégration au bâti</option>
                <option value="mixte">Mixte</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-pr-orient">Orientation (°)</FieldLabel>
              <input
                id="vt-pr-orient"
                type="number"
                step="any"
                className={`sn-input ${styles.inputFull}`}
                value={
                  formData.projet.orientation === ""
                    ? ""
                    : formData.projet.orientation
                }
                onChange={(e) =>
                  handleChange(
                    "projet",
                    "orientation",
                    parseOptionalNumber(e.target.value)
                  )
                }
              />
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-pr-incl">Inclinaison (°)</FieldLabel>
              <input
                id="vt-pr-incl"
                type="number"
                step="any"
                className={`sn-input ${styles.inputFull}`}
                value={
                  formData.projet.inclinaison === ""
                    ? ""
                    : formData.projet.inclinaison
                }
                onChange={(e) =>
                  handleChange(
                    "projet",
                    "inclinaison",
                    parseOptionalNumber(e.target.value)
                  )
                }
              />
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="vt-pr-pose">Type de pose</FieldLabel>
              <select
                id="vt-pr-pose"
                className={`sn-input ${styles.inputFull}`}
                value={formData.projet.typePose}
                onChange={(e) =>
                  handleChange(
                    "projet",
                    "typePose",
                    e.target.value as ProjetData["typePose"]
                  )
                }
              >
                <option value="">— Choisir —</option>
                <option value="portrait">Portrait</option>
                <option value="paysage">Paysage</option>
              </select>
            </div>
          </div>
        </VisiteSectionCard>

        <VisiteSectionCard title="Photos">
          <div className={styles.grid}>
            <div className={`${styles.field} ${styles.span2}`}>
              <FieldLabel htmlFor="vt-ph-bat">Photos bâtiment</FieldLabel>
              <div className={styles.fileRow}>
                <input
                  id="vt-ph-bat"
                  type="file"
                  multiple
                  accept="image/*"
                  className={styles.fileInput}
                  onChange={(e) =>
                    handleChange(
                      "photos",
                      "batiment",
                      e.target.files && e.target.files.length > 0
                        ? Array.from(e.target.files)
                        : []
                    )
                  }
                />
                <p className={styles.fieldHint}>
                  {fileSummary(formData.photos.batiment)}
                </p>
              </div>
            </div>
            <div className={`${styles.field} ${styles.span2}`}>
              <FieldLabel htmlFor="vt-ph-toit">Photos toiture</FieldLabel>
              <div className={styles.fileRow}>
                <input
                  id="vt-ph-toit"
                  type="file"
                  multiple
                  accept="image/*"
                  className={styles.fileInput}
                  onChange={(e) =>
                    handleChange(
                      "photos",
                      "toiture",
                      e.target.files && e.target.files.length > 0
                        ? Array.from(e.target.files)
                        : []
                    )
                  }
                />
                <p className={styles.fieldHint}>
                  {fileSummary(formData.photos.toiture)}
                </p>
              </div>
            </div>
            <div className={`${styles.field} ${styles.span2}`}>
              <FieldLabel htmlFor="vt-ph-tab">Photos tableau électrique</FieldLabel>
              <div className={styles.fileRow}>
                <input
                  id="vt-ph-tab"
                  type="file"
                  multiple
                  accept="image/*"
                  className={styles.fileInput}
                  onChange={(e) =>
                    handleChange(
                      "photos",
                      "tableau",
                      e.target.files && e.target.files.length > 0
                        ? Array.from(e.target.files)
                        : []
                    )
                  }
                />
                <p className={styles.fieldHint}>
                  {fileSummary(formData.photos.tableau)}
                </p>
              </div>
            </div>
            <div className={`${styles.field} ${styles.span2}`}>
              <FieldLabel htmlFor="vt-ph-env">Photos environnement</FieldLabel>
              <div className={styles.fileRow}>
                <input
                  id="vt-ph-env"
                  type="file"
                  multiple
                  accept="image/*"
                  className={styles.fileInput}
                  onChange={(e) =>
                    handleChange(
                      "photos",
                      "environnement",
                      e.target.files && e.target.files.length > 0
                        ? Array.from(e.target.files)
                        : []
                    )
                  }
                />
                <p className={styles.fieldHint}>
                  {fileSummary(formData.photos.environnement)}
                </p>
              </div>
            </div>
          </div>
        </VisiteSectionCard>

        <VisiteSectionCard title="Analyse automatique">
          <div className={styles.analysisBlock}>
            <div className={styles.analysisKpis}>
              <div className={styles.analysisKpi}>
                <span className={styles.analysisKpiLabel}>Statut</span>
                <span
                  className={`${styles.statusPill} ${
                    evaluation.status === "OK"
                      ? styles.statusPillOk
                      : evaluation.status === "WARNING"
                        ? styles.statusPillWarning
                        : styles.statusPillBlocked
                  }`}
                >
                  {evaluation.status}
                </span>
              </div>
              <div className={styles.analysisKpi}>
                <span className={styles.analysisKpiLabel}>Score</span>
                <span className={styles.analysisScore}>
                  {evaluation.score} / 100
                </span>
              </div>
            </div>

            <div className={styles.analysisSection}>
              <p className={styles.analysisSectionTitle}>Points bloquants</p>
              {evaluation.alerts.blocking.length === 0 ? (
                <p className={styles.analysisEmpty}>Aucun</p>
              ) : (
                <ul className={styles.alertListBlocking}>
                  {evaluation.alerts.blocking.map((t, i) => (
                    <li key={`blocking-${i}`}>{t}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className={styles.analysisSection}>
              <p className={styles.analysisSectionTitle}>Avertissements</p>
              {evaluation.alerts.warning.length === 0 ? (
                <p className={styles.analysisEmpty}>Aucun</p>
              ) : (
                <ul className={styles.alertListWarning}>
                  {evaluation.alerts.warning.map((t, i) => (
                    <li key={`warning-${i}`}>{t}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className={styles.analysisSection}>
              <p className={styles.analysisSectionTitle}>
                Difficulté chantier
              </p>
              <p className={styles.analysisPlain}>
                {DIFFICULTE_LABELS[evaluation.chantier_summary.difficulte]}
              </p>
            </div>

            <div className={styles.analysisSection}>
              <p className={styles.analysisSectionTitle}>
                Matériel à prévoir
              </p>
              {evaluation.chantier_summary.materiel.length === 0 ? (
                <p className={styles.analysisEmpty}>Aucun</p>
              ) : (
                <ul className={styles.analysisBulletList}>
                  {evaluation.chantier_summary.materiel.map((t, i) => (
                    <li key={`mat-${i}`}>{t}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className={styles.analysisSection}>
              <p className={styles.analysisSectionTitle}>Contraintes</p>
              {evaluation.chantier_summary.contraintes.length === 0 ? (
                <p className={styles.analysisEmpty}>Aucune</p>
              ) : (
                <ul className={styles.analysisBulletList}>
                  {evaluation.chantier_summary.contraintes.map((t, i) => (
                    <li key={`ctr-${i}`}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </VisiteSectionCard>
      </div>
    </div>
  );
}
