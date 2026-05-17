/**
 * Panneau métier : obstacle / volume ombrant sélectionné (Phase 2).
 * P4 — hiérarchie, vocabulaire client, micro-aides sobres.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./Phase2ObstaclePanel.module.css";
import { usePhase2Data } from "../hooks/usePhase2Data";
import { estimateSolarImpactFromHeuristic } from "../catalog/obstacleSolarImpact";
import { ConfirmDialog } from "../ui/ConfirmDialog";

type EditorState =
  | { kind: null; metersPerPixel: number }
  | {
      kind: "obstacle";
      index: number;
      metersPerPixel: number;
      shapeKind: string;
      planWidthM: number | null;
      planHeightM: number | null;
      diameterM: number | null;
      heightMStored: number | null;
      heightMEffective: number;
      label: string;
      isShadingObstacle: boolean;
      catalogDescription: string;
      footprintAreaM2: number;
    }
  | {
      kind: "shadow_volume";
      index: number;
      metersPerPixel: number;
      shape: string;
      widthM: number;
      depthM: number;
      heightM: number;
      label: string;
      isShadingObstacle: boolean;
      catalogDescription: string;
      footprintAreaM2: number;
    };

function getEditorState(): EditorState {
  const api = (window as unknown as { phase2ObstacleEditor?: { getState: () => EditorState } }).phase2ObstacleEditor;
  if (!api || typeof api.getState !== "function") {
    return { kind: null, metersPerPixel: 1 };
  }
  return api.getState() as EditorState;
}

function formatM(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(digits);
}

/** Affichage saisie cm pour la profondeur au sol (2ᵉ côté du rectangle) — keepout ; stockage en m côté moteur. */
function formatCmFromM(m: number, digits = 0): string {
  if (!Number.isFinite(m)) return "";
  return (m * 100).toFixed(digits);
}

export default function Phase2ObstaclePanel({ compact = false }: { compact?: boolean }) {
  usePhase2Data();
  const [tick, setTick] = useState(0);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onUpdate = () => setTick((t) => t + 1);
    window.addEventListener("phase2:update", onUpdate);
    return () => window.removeEventListener("phase2:update", onUpdate);
  }, []);

  const state = useMemo(() => getEditorState(), [tick]);

  const scheduleApply = useCallback((fn: () => void) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      fn();
    }, 72);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const api = (window as unknown as {
    phase2ObstacleEditor?: {
      applyObstaclePlanDimensions: (i: number, p: Record<string, number>) => boolean;
      setObstacleHeightM: (i: number, h: number) => boolean;
      applyShadowVolumeDimensions: (i: number, p: Record<string, number>) => boolean;
      deleteSelection: () => boolean;
      duplicateSelection: () => boolean;
      resetSelectionSize: () => boolean;
    };
  }).phase2ObstacleEditor;

  if (!state || state.kind === null) {
    if (compact) {
      return (
        <div className={`${styles.root} ${styles.empty} ${styles.emptyCompact}`}>
          <p className={styles.emptyTitleCompact}>Aucune sélection</p>
          <p className={styles.emptyBodyCompact}>Sélection + clic sur le plan.</p>
        </div>
      );
    }
    return (
      <div className={`${styles.root} ${styles.empty}`}>
        <p className={styles.emptyTitle}>Aucun élément sélectionné</p>
        <p className={styles.emptyBody}>
          Activez l’outil <strong>Sélection</strong>, puis cliquez sur un obstacle ou un volume au sol sur le plan
          pour afficher ses propriétés et les ajuster.
        </p>
        <p className={styles.emptyLegend}>
          <strong>Éléments ombrants</strong> — pris en compte pour l’ombrage proche et la production.&nbsp;
          <strong>Zones de non-pose</strong> — réservées à l’exclusion des panneaux, sans effet sur l’ombrage
          modélisé ici.
        </p>
        <p className={styles.note}>Un seul élément à la fois (pas de sélection multiple).</p>
      </div>
    );
  }

  if (state.kind === "obstacle") {
    const s = state;
    const typeLine = s.isShadingObstacle ? "Élément ombrant" : "Zone de non-pose";
    const microHint = s.isShadingObstacle
      ? "Peut projeter une ombre sur les panneaux selon sa hauteur et sa position."
      : "Cette zone empêche simplement la pose de panneaux.";
    const tagline =
      s.catalogDescription ||
      (s.isShadingObstacle
        ? "Pris en compte pour l’ombrage de proximité."
        : "Exclusion de pose uniquement.");

    const heightDisplay = s.heightMStored !== null ? s.heightMStored : s.heightMEffective;
    const impact =
      s.isShadingObstacle
        ? estimateSolarImpactFromHeuristic({
            heightM: heightDisplay,
            footprintAreaM2: Math.max(1e-6, s.footprintAreaM2),
          })
        : null;

    const canEditPlanDims = s.shapeKind === "rect" || s.shapeKind === "circle";

    return (
      <div className={`${styles.root} ${styles.rootActive} ${compact ? styles.rootCompact : ""}`}>
        <div className={styles.titleRow}>
          {!compact && <p className={styles.eyebrow}>Propriétés</p>}
          <div className={`${styles.typeBadge} ${s.isShadingObstacle ? styles.typeShading : styles.typeKeepout}`}>
            {typeLine}
          </div>
          <h2 className={compact ? styles.businessNameCompact : styles.businessName}>{s.label}</h2>
          {!compact && <p className={styles.microHint}>{microHint}</p>}
          {!compact && <p className={styles.tagline}>{tagline}</p>}
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{compact ? "Emprise" : "Emprise au sol"}</h3>
          <div className={styles.sectionInner}>
            {!canEditPlanDims ? (
              <p className={styles.polygonHint}>
                {compact
                  ? "Polygone : ajuster sur le plan."
                  : "Polygone : ajustez la forme sur le plan (sommets et poignées). Les dimensions se déduisent du tracé."}
              </p>
            ) : s.shapeKind === "rect" && s.planWidthM != null && s.planHeightM != null ? (
              <div className={styles.dimGrid}>
                <div className={styles.dimRow}>
                  <span className={styles.dimLabel}>Largeur</span>
                  <div className={styles.dimInputWrap}>
                    <input
                      className={styles.dimInput}
                      type="number"
                      step="0.01"
                      min={0.05}
                      defaultValue={formatM(s.planWidthM)}
                      key={`pw-${s.index}-${tick}`}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isFinite(v) || v <= 0) return;
                        scheduleApply(() =>
                          api?.applyObstaclePlanDimensions(s.index, { planWidthM: v, planHeightM: s.planHeightM! })
                        );
                      }}
                      aria-label="Largeur au sol en mètres"
                    />
                    <span className={styles.unit}>m</span>
                  </div>
                </div>
                <div className={styles.dimRow}>
                  <span className={styles.dimLabel}>
                    {s.isShadingObstacle ? "Longueur" : "Profondeur au sol"}
                  </span>
                  <div className={styles.dimInputWrap}>
                    <input
                      className={styles.dimInput}
                      type="number"
                      step={s.isShadingObstacle ? "0.01" : "1"}
                      min={s.isShadingObstacle ? 0.05 : 5}
                      defaultValue={
                        s.isShadingObstacle ? formatM(s.planHeightM) : formatCmFromM(s.planHeightM)
                      }
                      key={`ph-${s.index}-${tick}`}
                      onChange={(e) => {
                        const raw = parseFloat(e.target.value);
                        if (!Number.isFinite(raw) || raw <= 0) return;
                        const planHeightM = s.isShadingObstacle ? raw : raw / 100;
                        if (!s.isShadingObstacle && planHeightM < 0.05) return;
                        scheduleApply(() =>
                          api?.applyObstaclePlanDimensions(s.index, { planWidthM: s.planWidthM!, planHeightM })
                        );
                      }}
                      aria-label={
                        s.isShadingObstacle
                          ? "Longueur au sol en mètres"
                          : "Profondeur au sol (deuxième côté du rectangle) en centimètres"
                      }
                    />
                    <span className={styles.unit}>{s.isShadingObstacle ? "m" : "cm"}</span>
                  </div>
                </div>
              </div>
            ) : s.shapeKind === "circle" && s.diameterM != null ? (
              <div className={styles.dimGrid}>
                <div className={styles.dimRow}>
                  <span className={styles.dimLabel}>Diamètre</span>
                  <div className={styles.dimInputWrap}>
                    <input
                      className={styles.dimInput}
                      type="number"
                      step="0.01"
                      min={0.05}
                      defaultValue={formatM(s.diameterM)}
                      key={`dia-${s.index}-${tick}`}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isFinite(v) || v <= 0) return;
                        scheduleApply(() => api?.applyObstaclePlanDimensions(s.index, { diameterM: v }));
                      }}
                      aria-label="Diamètre au sol en mètres"
                    />
                    <span className={styles.unit}>m</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {s.isShadingObstacle ? (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{compact ? "Hauteur" : "Hauteur au-dessus du toit"}</h3>
            <div className={styles.sectionInner}>
              <div className={styles.dimRow}>
                <span className={styles.dimLabel}>Hauteur</span>
                <div className={styles.dimInputWrap}>
                  <input
                    className={styles.dimInput}
                    type="number"
                    step="0.05"
                    min={0}
                    defaultValue={formatM(heightDisplay)}
                    key={`hm-${s.index}-${tick}`}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isFinite(v) || v < 0) return;
                      scheduleApply(() => api?.setObstacleHeightM(s.index, v));
                    }}
                    aria-label="Hauteur au-dessus du plan de toiture en mètres"
                  />
                  <span className={styles.unit}>m</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{compact ? "Impact (ordre de grandeur)" : "Impact sur la production (ordre de grandeur)"}</h3>
          <div className={styles.sectionInner}>
            {s.isShadingObstacle && impact ? (
              <div className={styles.impactBox}>
                <span className={styles.impactBadge}>{impact.labelShort}</span>
                <p className={compact ? styles.impactDetailCompact : styles.impactDetail}>{impact.detailFr}</p>
              </div>
            ) : (
              <div className={styles.impactNeutral}>
                {compact
                  ? "Pose bloquée sur cette surface."
                  : "Hors calcul d’ombrage : seule la pose des panneaux est bloquée sur cette surface."}
              </div>
            )}
            {s.isShadingObstacle && !compact && (
              <p className={styles.note}>
                Indication pédagogique (hauteur × emprise). Le bilan d’ombrage détaillé reste celui du moteur
                métier.
              </p>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Actions</h3>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionDanger}`}
              onClick={() => setConfirmTarget(s.label)}
              aria-label={"Supprimer l'obstacle " + s.label}
            >
              Supprimer
            </button>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionSecondary}`}
              onClick={() => api?.duplicateSelection()}
            >
              Dupliquer
            </button>
            <button type="button" className={styles.actionBtn} onClick={() => api?.resetSelectionSize()}>
              Taille par défaut
            </button>
          </div>
        <ConfirmDialog
          open={confirmTarget !== null}
          title="Supprimer l'élément ?"
          description="Cette action est irréversible."
          onConfirm={() => { api?.deleteSelection(); setConfirmTarget(null); }}
          onCancel={() => setConfirmTarget(null)}
        />
        </div>
      </div>
    );
  }

  const v = state;
  const typeLine = "Volume ombrant (3D)";
  const microHint =
    "Représente un obstacle en volume pour l’ombrage de proximité.";
  const tagline = v.catalogDescription || "Modèle simplifié pour le rendez-vous et le dimensionnement.";
  const impact = estimateSolarImpactFromHeuristic({
    heightM: v.heightM,
    footprintAreaM2: Math.max(1e-6, v.footprintAreaM2),
  });
  const isTube = v.shape === "tube";

  return (
    <div className={`${styles.root} ${styles.rootActive} ${compact ? styles.rootCompact : ""}`}>
      <div className={styles.titleRow}>
        {!compact && <p className={styles.eyebrow}>Propriétés</p>}
        <div className={`${styles.typeBadge} ${styles.typeShading}`}>{typeLine}</div>
        <h2 className={compact ? styles.businessNameCompact : styles.businessName}>{v.label}</h2>
        {!compact && <p className={styles.microHint}>{microHint}</p>}
        {!compact && <p className={styles.tagline}>{tagline}</p>}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{compact ? "Volume" : "Dimensions du volume"}</h3>
        <div className={styles.sectionInner}>
          <div className={styles.dimGrid}>
            {isTube ? (
              <div className={styles.dimRow}>
                <span className={styles.dimLabel}>Diamètre</span>
                <div className={styles.dimInputWrap}>
                  <input
                    className={styles.dimInput}
                    type="number"
                    step="0.01"
                    min={0.05}
                    defaultValue={formatM(v.widthM)}
                    key={`svw-${v.index}-${tick}`}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (!Number.isFinite(n) || n <= 0) return;
                      scheduleApply(() =>
                        api?.applyShadowVolumeDimensions(v.index, { widthM: n, depthM: n, heightM: v.heightM })
                      );
                    }}
                    aria-label="Diamètre en mètres"
                  />
                  <span className={styles.unit}>m</span>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.dimRow}>
                  <span className={styles.dimLabel}>Largeur</span>
                  <div className={styles.dimInputWrap}>
                    <input
                      className={styles.dimInput}
                      type="number"
                      step="0.01"
                      min={0.05}
                      defaultValue={formatM(v.widthM)}
                      key={`svw2-${v.index}-${tick}`}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        if (!Number.isFinite(n) || n <= 0) return;
                        scheduleApply(() =>
                          api?.applyShadowVolumeDimensions(v.index, { widthM: n, depthM: v.depthM, heightM: v.heightM })
                        );
                      }}
                      aria-label="Largeur en mètres"
                    />
                    <span className={styles.unit}>m</span>
                  </div>
                </div>
                <div className={styles.dimRow}>
                  <span className={styles.dimLabel}>Longueur</span>
                  <div className={styles.dimInputWrap}>
                    <input
                      className={styles.dimInput}
                      type="number"
                      step="0.01"
                      min={0.05}
                      defaultValue={formatM(v.depthM)}
                      key={`svd-${v.index}-${tick}`}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        if (!Number.isFinite(n) || n <= 0) return;
                        scheduleApply(() =>
                          api?.applyShadowVolumeDimensions(v.index, { widthM: v.widthM, depthM: n, heightM: v.heightM })
                        );
                      }}
                      aria-label="Longueur en mètres"
                    />
                    <span className={styles.unit}>m</span>
                  </div>
                </div>
              </>
            )}
            <div className={styles.dimRow}>
              <span className={styles.dimLabel}>Hauteur</span>
              <div className={styles.dimInputWrap}>
                <input
                  className={styles.dimInput}
                  type="number"
                  step="0.05"
                  min={0}
                  defaultValue={formatM(v.heightM)}
                  key={`svh-${v.index}-${tick}`}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    if (!Number.isFinite(n) || n < 0) return;
                    scheduleApply(() =>
                      api?.applyShadowVolumeDimensions(v.index, {
                        widthM: v.widthM,
                        depthM: v.depthM,
                        heightM: n,
                      })
                    );
                  }}
                  aria-label="Hauteur du volume au-dessus du toit en mètres"
                />
                <span className={styles.unit}>m</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{compact ? "Impact (ordre de grandeur)" : "Impact sur la production (ordre de grandeur)"}</h3>
        <div className={styles.sectionInner}>
          <div className={styles.impactBox}>
            <span className={styles.impactBadge}>{impact.labelShort}</span>
            <p className={compact ? styles.impactDetailCompact : styles.impactDetail}>{impact.detailFr}</p>
          </div>
          {!compact && (
            <p className={styles.note}>Indication pour l’échange client — le moteur d’ombrage affine le résultat.</p>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Actions</h3>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionDanger}`}
            onClick={() => setConfirmTarget(v.label)}
            aria-label={"Supprimer l'obstacle " + v.label}
          >
            Supprimer
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionSecondary}`}
            onClick={() => api?.duplicateSelection()}
          >
            Dupliquer
          </button>
          <button type="button" className={styles.actionBtn} onClick={() => api?.resetSelectionSize()}>
            Taille par défaut
          </button>
        </div>
      <ConfirmDialog
        open={confirmTarget !== null}
        title="Supprimer l'élément ?"
        description="Cette action est irréversible."
        onConfirm={() => { api?.deleteSelection(); setConfirmTarget(null); }}
        onCancel={() => setConfirmTarget(null)}
      />
      </div>
    </div>
  );
}
