/**
 * Panneau d’inspection technique — overlay discret, mode debug / contrôle qualité.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PickProvenance2DViewModel, SceneInspectionViewModel } from "./inspection/sceneInspectionTypes";

/** Édition Z sommet (phase B4) — valeur métier `h` sur `state.pans`. */
export type RoofVertexHeightEditUiModel = {
  readonly panId: string;
  readonly vertexIndex: number;
  readonly referenceHeightM: number;
  /** Pendant un drag vertical 3D sur le marqueur — reflète la hauteur en direct (sans commit intermédiaire). */
  readonly dragLiveHeightM?: number | null;
  readonly heightMinM: number;
  readonly heightMaxM: number;
  /** Position monde du sommet (m, ENU Z up) — affichage seulement. */
  readonly worldPositionM?: { readonly x: number; readonly y: number; readonly z: number };
  readonly onApplyHeightM: (heightM: number) => void;
};

/** Édition XY sommet (phase B5) — `polygonPx` sur `state.pans`, clamp + validation polygone simple. */
export type RoofVertexXYEditUiModel = {
  readonly panId: string;
  readonly vertexIndex: number;
  readonly referenceXPx: number;
  readonly referenceYPx: number;
  readonly maxDisplacementPx: number;
  readonly onApplyDeltaWorldM: (dxM: number, dyM: number) => void;
  readonly onApplyImagePx: (xPx: number, yPx: number) => void;
};

/** Undo / redo local sur `state.pans` (phase B7). */
export type RoofModelingHistoryUiModel = {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
};

/** Pass 3 — hauteur point structurel contour / faîtage / trait (`applyHeightToSelectedPoints` legacy). */
export type StructuralRidgeHeightEditUiModel = {
  readonly structuralKind: "contour" | "ridge" | "trait";
  /** Index dans le tableau filtré `chienAssis` du type concerné. */
  readonly structuralIndexFiltered: number;
  /** Libellé du sommet : index ou extrémité `a` / `b`. */
  readonly pointLabel: string;
  readonly referenceHeightM: number;
  readonly heightMinM: number;
  readonly heightMaxM: number;
  readonly onApplyHeightM: (heightM: number) => void;
};

export type RoofHeightAssistantUiModel = {
  readonly contourPointCount: number;
  readonly ridgeEndpointCount: number;
  readonly traitEndpointCount: number;
  readonly defaultEaveHeightM: number;
  readonly defaultRidgeHeightM: number;
  readonly defaultTraitHeightM: number;
  readonly onApply: (command: {
    readonly eaveHeightM?: number | null;
    readonly ridgeHeightM?: number | null;
    readonly traitHeightM?: number | null;
  }) => void;
};

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  zIndex: 3,
  width: "min(320px, 42vw)",
  maxHeight: "min(70vh, 520px)",
  overflow: "auto",
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(16, 19, 26, 0.88)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 12,
  lineHeight: 1.45,
  color: "rgba(248, 250, 252, 0.94)",
  pointerEvents: "auto",
};

const titleStyle: CSSProperties = {
  fontWeight: 600,
  letterSpacing: "0.03em",
  fontSize: 11,
  textTransform: "uppercase" as const,
  opacity: 0.85,
  marginBottom: 10,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  paddingBottom: 8,
};

const rowLabel: CSSProperties = {
  color: "rgba(148, 163, 184, 0.95)",
  minWidth: 118,
  flexShrink: 0,
};

export interface SceneInspectionPanel3DProps {
  readonly model: SceneInspectionViewModel | null;
  /** Provenance 2D (monde → px, lien `state.pans`) — pick pan / sommet. */
  readonly pickProvenance2D?: PickProvenance2DViewModel | null;
  /** Affiche l’invite « Aucune sélection » quand pas de modèle inspection. */
  readonly showInspectionEmptyPlaceholder?: boolean;
  /** Invite sélection pan quand seul le mode sélection 3D est actif. */
  readonly showPanSelectionEmptyPlaceholder?: boolean;
  /** Affiché uniquement si `inspectMode` + `window.__CALPINAGE_3D_DEBUG__` (voir `SolarScene3DViewer`). */
  readonly roofShellAlignmentLine?: string | null;
  /** Sommet de pan sélectionné + callback parent (`applyRoofVertexHeightEdit` + emit structural). */
  readonly roofVertexHeightEdit?: RoofVertexHeightEditUiModel | null;
  /** Édition plan horizontal px / delta monde (phase B5). */
  readonly roofVertexXYEdit?: RoofVertexXYEditUiModel | null;
  /** Historique local toiture (phase B7) — affiché si édition sommet active. */
  readonly roofModelingHistory?: RoofModelingHistoryUiModel | null;
  /** Hauteur point structurel (contour / faîtage / trait, index filtré chienAssis) — exclusif aux autres blocs d’édition sommet. */
  readonly structuralRidgeHeightEdit?: StructuralRidgeHeightEditUiModel | null;
  readonly roofHeightAssistant?: RoofHeightAssistantUiModel | null;
  /** Pendant un pointer down sur les contrôles d’édition sommet : désactive l’orbite du viewer 3D. */
  readonly onVertexModelingPointerActiveChange?: (active: boolean) => void;
  readonly onDismiss?: () => void;
}

function RoofModelingHistoryBlock({ h }: { readonly h: RoofModelingHistoryUiModel }) {
  return (
    <div
      data-testid="roof-modeling-history-block"
      style={{
        marginBottom: 12,
        paddingBottom: 10,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <span style={{ ...titleStyle, marginBottom: 0, borderBottom: "none", paddingBottom: 0, flex: "1 1 100%" }}>
        Historique toiture
      </span>
      <button
        type="button"
        data-testid="roof-modeling-undo"
        disabled={!h.canUndo}
        onClick={() => h.onUndo()}
        title="Annuler (Ctrl+Z)"
        style={{
          flex: 1,
          minWidth: 100,
          padding: "6px 8px",
          borderRadius: 6,
          border: "1px solid rgba(148, 163, 184, 0.35)",
          background: h.canUndo ? "rgba(71, 85, 105, 0.35)" : "rgba(30, 41, 59, 0.4)",
          color: "inherit",
          fontSize: 11,
          fontWeight: 600,
          cursor: h.canUndo ? "pointer" : "not-allowed",
          opacity: h.canUndo ? 1 : 0.45,
        }}
      >
        Annuler
      </button>
      <button
        type="button"
        data-testid="roof-modeling-redo"
        disabled={!h.canRedo}
        onClick={() => h.onRedo()}
        title="Refaire (Ctrl+Shift+Z ou Ctrl+Y)"
        style={{
          flex: 1,
          minWidth: 100,
          padding: "6px 8px",
          borderRadius: 6,
          border: "1px solid rgba(148, 163, 184, 0.35)",
          background: h.canRedo ? "rgba(71, 85, 105, 0.35)" : "rgba(30, 41, 59, 0.4)",
          color: "inherit",
          fontSize: 11,
          fontWeight: 600,
          cursor: h.canRedo ? "pointer" : "not-allowed",
          opacity: h.canRedo ? 1 : 0.45,
        }}
      >
        Refaire
      </button>
      <div style={{ flex: "1 1 100%", fontSize: 10, opacity: 0.5, lineHeight: 1.35 }}>
        Mémoire locale uniquement (pas de persistance disque). Jusqu’à 15 pas.
      </div>
    </div>
  );
}

function renderProvenanceBlock(p: PickProvenance2DViewModel, onDismiss: (() => void) | undefined) {
  return (
    <div data-testid="pick-provenance-2d-block" style={{ marginTop: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          paddingBottom: 8,
        }}
      >
        <div style={{ ...titleStyle, marginBottom: 0, borderBottom: "none", paddingBottom: 0, flex: 1 }}>{p.title}</div>
        {onDismiss != null && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Effacer la sélection et la provenance"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "inherit",
              borderRadius: 6,
              padding: "2px 8px",
              fontSize: 11,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Effacer
          </button>
        )}
      </div>
      <dl style={{ margin: 0 }}>
        {p.rows.map((r, idx) => (
          <div
            key={`pv-${idx}-${r.label}`}
            style={{
              display: "flex",
              gap: 10,
              padding: "5px 0",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <dt style={rowLabel}>{r.label}</dt>
            <dd style={{ margin: 0, flex: 1, wordBreak: "break-word", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      {p.warnings.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 11, opacity: 0.8, marginBottom: 6 }}>Alertes (2D)</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(251, 191, 36, 0.92)" }}>
            {p.warnings.map((w, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const HEIGHT_STEP_M = 0.01;
/** Saisie clavier : commit après pause pour éviter un rebuild à chaque caractère. */
const TEXT_COMMIT_DEBOUNCE_MS = 450;

function RoofVertexHeightEditBlock({ edit }: { readonly edit: RoofVertexHeightEditUiModel }) {
  const [draftM, setDraftM] = useState(edit.referenceHeightM);
  const [heightText, setHeightText] = useState(() => String(edit.referenceHeightM));
  const [inputError, setInputError] = useState<string | null>(null);
  const [appliedFlash, setAppliedFlash] = useState(false);
  const textCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHeightTextRef = useRef(heightText);

  useEffect(() => {
    return () => {
      if (textCommitTimerRef.current != null) clearTimeout(textCommitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setDraftM(edit.referenceHeightM);
    setHeightText(String(edit.referenceHeightM));
    pendingHeightTextRef.current = String(edit.referenceHeightM);
    setInputError(null);
    setAppliedFlash(false);
  }, [edit.panId, edit.vertexIndex, edit.referenceHeightM]);

  useEffect(() => {
    if (edit.dragLiveHeightM == null || !Number.isFinite(edit.dragLiveHeightM)) return;
    setDraftM(edit.dragLiveHeightM);
    setHeightText(edit.dragLiveHeightM.toFixed(2));
    pendingHeightTextRef.current = edit.dragLiveHeightM.toFixed(2);
  }, [edit.dragLiveHeightM]);

  const clamped = Math.min(edit.heightMaxM, Math.max(edit.heightMinM, draftM));

  /** Curseur / ± : écrit tout de suite dans le runtime + rebuild 3D. */
  function applyLiveClampedM(m: number) {
    const c = Math.min(edit.heightMaxM, Math.max(edit.heightMinM, m));
    setInputError(null);
    setDraftM(c);
    setHeightText(String(c));
    pendingHeightTextRef.current = String(c);
    edit.onApplyHeightM(c);
  }

  function parseHeightM(raw: string): number | null {
    const t = raw.trim().replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  function applyWithValidation(heightM: number, showFlash: boolean) {
    if (!Number.isFinite(heightM)) {
      setInputError("Saisissez un nombre valide.");
      return;
    }
    if (heightM < edit.heightMinM || heightM > edit.heightMaxM) {
      setInputError(`Hauteur hors plage : entre ${edit.heightMinM} m et ${edit.heightMaxM} m.`);
      return;
    }
    setInputError(null);
    edit.onApplyHeightM(heightM);
    if (showFlash) {
      setAppliedFlash(true);
      window.setTimeout(() => setAppliedFlash(false), 1600);
    }
  }

  return (
    <div data-testid="roof-vertex-z-edit-block" style={{ marginTop: 0 }}>
      <div
        style={{
          ...titleStyle,
          marginBottom: 8,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          paddingBottom: 8,
        }}
      >
        Hauteur (m)
      </div>
      <div style={{ fontSize: 10, opacity: 0.65, marginBottom: 10, fontFamily: "ui-monospace, monospace" }}>
        {edit.panId} · sommet {edit.vertexIndex}
      </div>
      <label style={{ display: "block", fontSize: 11, marginBottom: 8 }}>
        Valeur (m)
        <input
          type="text"
          inputMode="decimal"
          data-testid="roof-vertex-z-number"
          autoComplete="off"
          value={heightText}
          onChange={(e) => {
            const raw = e.target.value;
            pendingHeightTextRef.current = raw;
            setHeightText(raw);
            setInputError(null);
            const n = parseHeightM(raw);
            if (n != null) setDraftM(n);

            if (textCommitTimerRef.current != null) clearTimeout(textCommitTimerRef.current);
            textCommitTimerRef.current = setTimeout(() => {
              textCommitTimerRef.current = null;
              const t = pendingHeightTextRef.current;
              const typed = parseHeightM(t);
              if (typed == null) return;
              if (typed < edit.heightMinM || typed > edit.heightMaxM) return;
              const c = Math.min(edit.heightMaxM, Math.max(edit.heightMinM, typed));
              edit.onApplyHeightM(c);
            }, TEXT_COMMIT_DEBOUNCE_MS);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (textCommitTimerRef.current != null) {
              clearTimeout(textCommitTimerRef.current);
              textCommitTimerRef.current = null;
            }
            const typed = parseHeightM(pendingHeightTextRef.current);
            if (typed == null) {
              setInputError("Saisissez un nombre valide.");
              return;
            }
            applyWithValidation(typed, false);
          }}
          onBlur={() => {
            if (textCommitTimerRef.current != null) {
              clearTimeout(textCommitTimerRef.current);
              textCommitTimerRef.current = null;
            }
            const typed = parseHeightM(pendingHeightTextRef.current);
            if (typed == null) return;
            if (typed < edit.heightMinM || typed > edit.heightMaxM) return;
            const c = Math.min(edit.heightMaxM, Math.max(edit.heightMinM, typed));
            edit.onApplyHeightM(c);
          }}
          style={{
            width: "100%",
            marginTop: 6,
            padding: "6px 8px",
            borderRadius: 6,
            border: inputError ? "1px solid rgba(248, 113, 113, 0.7)" : "1px solid rgba(255,255,255,0.15)",
            background: "rgba(0,0,0,0.25)",
            color: "inherit",
            boxSizing: "border-box",
          }}
        />
      </label>
      <div style={{ fontSize: 11, marginBottom: 6, opacity: 0.9 }}>Réglage fin · {clamped.toFixed(2)} m</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          data-testid="roof-vertex-z-minus"
          aria-label="Diminuer la hauteur"
          onClick={() => applyLiveClampedM(clamped - HEIGHT_STEP_M)}
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.08)",
            color: "inherit",
            fontSize: 18,
            fontWeight: 600,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          −
        </button>
        <input
          type="range"
          data-testid="roof-vertex-z-slider"
          min={edit.heightMinM}
          max={edit.heightMaxM}
          step={HEIGHT_STEP_M}
          value={clamped}
          onChange={(e) => {
            applyLiveClampedM(Number(e.target.value));
          }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          type="button"
          data-testid="roof-vertex-z-plus"
          aria-label="Augmenter la hauteur"
          onClick={() => applyLiveClampedM(clamped + HEIGHT_STEP_M)}
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.08)",
            color: "inherit",
            fontSize: 18,
            fontWeight: 600,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          +
        </button>
      </div>
      {inputError != null && (
        <div
          role="alert"
          data-testid="roof-vertex-z-input-error"
          style={{ fontSize: 11, color: "rgba(252, 165, 165, 0.95)", marginBottom: 8 }}
        >
          {inputError}
        </div>
      )}
      {appliedFlash && (
        <div
          data-testid="roof-vertex-z-applied-flash"
          style={{ fontSize: 11, color: "rgba(134, 239, 172, 0.95)", marginBottom: 8 }}
        >
          Demande envoyée — la scène se met à jour.
        </div>
      )}
      <button
        type="button"
        data-testid="roof-vertex-z-apply"
        onClick={() => {
          if (textCommitTimerRef.current != null) {
            clearTimeout(textCommitTimerRef.current);
            textCommitTimerRef.current = null;
          }
          const typed = parseHeightM(heightText);
          if (typed == null) {
            setInputError("Saisissez un nombre valide.");
            return;
          }
          applyWithValidation(typed, true);
        }}
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid rgba(96, 165, 250, 0.45)",
          background: "rgba(59, 130, 246, 0.22)",
          color: "inherit",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Appliquer la hauteur
      </button>
      <div style={{ marginTop: 6, fontSize: 10, opacity: 0.5, lineHeight: 1.35 }}>
        Curseur et ± enregistrent tout de suite (rebuild 3D). Saisie : application après une courte pause, Entrée ou
        sortie du champ. Glisser le point orange : valide au relâchement. Plage {edit.heightMinM}–{edit.heightMaxM} m.
      </div>
    </div>
  );
}

function RoofVertexXYEditBlock({ edit }: { readonly edit: RoofVertexXYEditUiModel }) {
  const [dXm, setDXm] = useState(0);
  const [dYm, setDYm] = useState(0);
  const [xPx, setXPx] = useState(edit.referenceXPx);
  const [yPx, setYPx] = useState(edit.referenceYPx);
  useEffect(() => {
    setXPx(edit.referenceXPx);
    setYPx(edit.referenceYPx);
    setDXm(0);
    setDYm(0);
  }, [edit.panId, edit.vertexIndex, edit.referenceXPx, edit.referenceYPx]);

  return (
    <div data-testid="roof-vertex-xy-edit-block" style={{ marginTop: 14 }}>
      <div
        style={{
          ...titleStyle,
          marginBottom: 8,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          paddingBottom: 8,
        }}
      >
        Position sommet (plan image)
      </div>
      <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 8 }}>
        Pan <span style={{ fontFamily: "ui-monospace, monospace" }}>{edit.panId}</span> — sommet #{edit.vertexIndex}
        <br />
        Réf. state : {edit.referenceXPx.toFixed(2)} px , {edit.referenceYPx.toFixed(2)} px — max Δ{" "}
        {edit.maxDisplacementPx} px
      </div>
      <div style={{ fontSize: 11, marginBottom: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Δ monde (m)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            dX
            <input
              type="number"
              data-testid="roof-vertex-xy-dxm"
              step={0.01}
              value={dXm}
              onChange={(e) => setDXm(Number(e.target.value))}
              style={{ width: 88, padding: 4, borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "inherit" }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            dY
            <input
              type="number"
              data-testid="roof-vertex-xy-dym"
              step={0.01}
              value={dYm}
              onChange={(e) => setDYm(Number(e.target.value))}
              style={{ width: 88, padding: 4, borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "inherit" }}
            />
          </label>
          <button
            type="button"
            data-testid="roof-vertex-xy-apply-world"
            onClick={() => edit.onApplyDeltaWorldM(dXm, dYm)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid rgba(52, 211, 153, 0.45)",
              background: "rgba(16, 185, 129, 0.2)",
              color: "inherit",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Appliquer Δ monde
          </button>
        </div>
      </div>
      <div style={{ fontSize: 11, marginBottom: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Cible px image</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            x
            <input
              type="number"
              data-testid="roof-vertex-xy-xpx"
              step={0.5}
              value={xPx}
              onChange={(e) => setXPx(Number(e.target.value))}
              style={{ width: 88, padding: 4, borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "inherit" }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            y
            <input
              type="number"
              data-testid="roof-vertex-xy-ypx"
              step={0.5}
              value={yPx}
              onChange={(e) => setYPx(Number(e.target.value))}
              style={{ width: 88, padding: 4, borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "inherit" }}
            />
          </label>
          <button
            type="button"
            data-testid="roof-vertex-xy-apply-px"
            onClick={() => edit.onApplyImagePx(xPx, yPx)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid rgba(96, 165, 250, 0.45)",
              background: "rgba(59, 130, 246, 0.22)",
              color: "inherit",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Appliquer px
          </button>
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 10, opacity: 0.55, lineHeight: 1.35 }}>
        Déplacement clampé ; polygone simple requis (surface non nulle, ≥ 3 sommets, pas d’auto-croisement). Aucune
        fusion de pans.
      </div>
    </div>
  );
}

function StructuralRidgeHeightEditBlock({ edit }: { readonly edit: StructuralRidgeHeightEditUiModel }) {
  const [draftM, setDraftM] = useState(edit.referenceHeightM);
  const [heightText, setHeightText] = useState(() => String(edit.referenceHeightM));
  const [inputError, setInputError] = useState<string | null>(null);
  const [appliedFlash, setAppliedFlash] = useState(false);
  const textCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (textCommitTimerRef.current != null) clearTimeout(textCommitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setDraftM(edit.referenceHeightM);
    setHeightText(String(edit.referenceHeightM));
    setInputError(null);
    setAppliedFlash(false);
  }, [edit.structuralIndexFiltered, edit.structuralKind, edit.pointLabel, edit.referenceHeightM]);

  const clamped = Math.min(edit.heightMaxM, Math.max(edit.heightMinM, draftM));

  function applyLiveClampedM(m: number) {
    const c = Math.min(edit.heightMaxM, Math.max(edit.heightMinM, m));
    setInputError(null);
    setDraftM(c);
    setHeightText(String(c));
    edit.onApplyHeightM(c);
  }

  function parseHeightM(raw: string): number | null {
    const t = raw.trim().replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  function applyWithValidation(heightM: number, showFlash: boolean) {
    if (!Number.isFinite(heightM)) {
      setInputError("Saisissez un nombre valide.");
      return;
    }
    if (heightM < edit.heightMinM || heightM > edit.heightMaxM) {
      setInputError(`Hauteur hors plage : entre ${edit.heightMinM} m et ${edit.heightMaxM} m.`);
      return;
    }
    setInputError(null);
    edit.onApplyHeightM(heightM);
    if (showFlash) {
      setAppliedFlash(true);
      window.setTimeout(() => setAppliedFlash(false), 1600);
    }
  }

  const kindTitle =
    edit.structuralKind === "contour"
      ? "Hauteur contour (m)"
      : edit.structuralKind === "trait"
        ? "Hauteur trait (m)"
        : "Hauteur faîtage (m)";
  const kindLine =
    edit.structuralKind === "contour"
      ? `Contour #${edit.structuralIndexFiltered} — sommet ${edit.pointLabel}`
      : edit.structuralKind === "trait"
        ? `Trait #${edit.structuralIndexFiltered} — extrémité ${edit.pointLabel}`
        : `Faîtage #${edit.structuralIndexFiltered} — extrémité ${edit.pointLabel}`;
  const applyLabel =
    edit.structuralKind === "contour"
      ? "Appliquer la hauteur (contour)"
      : edit.structuralKind === "trait"
        ? "Appliquer la hauteur (trait)"
        : "Appliquer la hauteur (faîtage)";

  return (
    <div data-testid="structural-ridge-height-edit-block" style={{ marginTop: 0 }}>
      <div
        style={{
          ...titleStyle,
          marginBottom: 8,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          paddingBottom: 8,
        }}
      >
        {kindTitle}
      </div>
      <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 8 }}>
        <span style={{ fontFamily: "ui-monospace, monospace" }}>{kindLine}</span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          aria-label="Diminuer"
          onClick={() => applyLiveClampedM(clamped - HEIGHT_STEP_M)}
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.08)",
            color: "inherit",
            fontSize: 18,
            fontWeight: 600,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          −
        </button>
        <input
          type="range"
          data-testid="structural-ridge-height-slider"
          min={edit.heightMinM}
          max={edit.heightMaxM}
          step={HEIGHT_STEP_M}
          value={clamped}
          onChange={(e) => applyLiveClampedM(Number(e.target.value))}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          type="button"
          aria-label="Augmenter"
          onClick={() => applyLiveClampedM(clamped + HEIGHT_STEP_M)}
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.08)",
            color: "inherit",
            fontSize: 18,
            fontWeight: 600,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          +
        </button>
      </div>
      {inputError != null && (
        <div role="alert" style={{ fontSize: 11, color: "rgba(252, 165, 165, 0.95)", marginBottom: 8 }}>
          {inputError}
        </div>
      )}
      {appliedFlash && (
        <div style={{ fontSize: 11, color: "rgba(134, 239, 172, 0.95)", marginBottom: 8 }}>Hauteur appliquée.</div>
      )}
      <button
        type="button"
        data-testid="structural-ridge-height-apply"
        onClick={() => {
          const typed = parseHeightM(heightText);
          if (typed == null) {
            setInputError("Saisissez un nombre valide.");
            return;
          }
          applyWithValidation(typed, true);
        }}
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid rgba(251, 191, 36, 0.45)",
          background: "rgba(245, 158, 11, 0.22)",
          color: "inherit",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {applyLabel}
      </button>
      <div style={{ marginTop: 6, fontSize: 10, opacity: 0.5, lineHeight: 1.35 }}>
        Même chaîne que l’outil hauteur 2D (contour, faîtage ou trait). Plage {edit.heightMinM}–{edit.heightMaxM} m.
      </div>
    </div>
  );
}

function RoofHeightAssistantBlock({ assistant }: { readonly assistant: RoofHeightAssistantUiModel }) {
  const [eaveText, setEaveText] = useState(String(assistant.defaultEaveHeightM));
  const [ridgeText, setRidgeText] = useState(String(assistant.defaultRidgeHeightM));
  const [traitText, setTraitText] = useState(String(assistant.defaultTraitHeightM));
  const [includeTrait, setIncludeTrait] = useState(assistant.traitEndpointCount > 0);
  const [inputError, setInputError] = useState<string | null>(null);
  const [appliedFlash, setAppliedFlash] = useState(false);

  useEffect(() => {
    setEaveText(String(assistant.defaultEaveHeightM));
    setRidgeText(String(assistant.defaultRidgeHeightM));
    setTraitText(String(assistant.defaultTraitHeightM));
    setIncludeTrait(assistant.traitEndpointCount > 0);
  }, [assistant.defaultEaveHeightM, assistant.defaultRidgeHeightM, assistant.defaultTraitHeightM, assistant.traitEndpointCount]);

  const parseHeightM = (raw: string): number | null => {
    const t = raw.trim().replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const inputStyle: CSSProperties = {
    width: 82,
    padding: "5px 7px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.22)",
    color: "inherit",
    fontSize: 12,
  };

  return (
    <div data-testid="roof-height-assistant-block" style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ ...titleStyle, marginBottom: 8 }}>Assistant hauteur toiture</div>
      <div style={{ fontSize: 11, opacity: 0.72, marginBottom: 10 }}>
        {assistant.contourPointCount} points egout · {assistant.ridgeEndpointCount} extremites faitage · {assistant.traitEndpointCount} lignes rupture
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 11 }}>
          Hauteur egout
          <input data-testid="roof-height-assistant-eave" inputMode="decimal" value={eaveText} onChange={(e) => setEaveText(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 11 }}>
          Hauteur faitage
          <input data-testid="roof-height-assistant-ridge" inputMode="decimal" value={ridgeText} onChange={(e) => setRidgeText(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 11, opacity: assistant.traitEndpointCount > 0 ? 1 : 0.5 }}>
          <span>
            <input
              type="checkbox"
              checked={includeTrait}
              disabled={assistant.traitEndpointCount === 0}
              onChange={(e) => setIncludeTrait(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Arêtier / noue / rupture
          </span>
          <input data-testid="roof-height-assistant-trait" inputMode="decimal" disabled={!includeTrait || assistant.traitEndpointCount === 0} value={traitText} onChange={(e) => setTraitText(e.target.value)} style={inputStyle} />
        </label>
      </div>
      {inputError != null ? (
        <div role="alert" style={{ fontSize: 11, color: "rgba(252, 165, 165, 0.95)", marginTop: 8 }}>
          {inputError}
        </div>
      ) : null}
      {appliedFlash ? (
        <div style={{ fontSize: 11, color: "rgba(134, 239, 172, 0.95)", marginTop: 8 }}>Assistant appliqué.</div>
      ) : null}
      <button
        type="button"
        data-testid="roof-height-assistant-apply"
        onClick={() => {
          const eave = parseHeightM(eaveText);
          const ridge = parseHeightM(ridgeText);
          const trait = includeTrait ? parseHeightM(traitText) : null;
          if (eave == null || ridge == null || (includeTrait && trait == null)) {
            setInputError("Saisissez des hauteurs valides.");
            return;
          }
          setInputError(null);
          assistant.onApply({
            eaveHeightM: eave,
            ridgeHeightM: ridge,
            traitHeightM: includeTrait ? trait : null,
          });
          setAppliedFlash(true);
          window.setTimeout(() => setAppliedFlash(false), 1600);
        }}
        style={{
          width: "100%",
          marginTop: 10,
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid rgba(96, 165, 250, 0.42)",
          background: "rgba(37, 99, 235, 0.24)",
          color: "inherit",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Reconstruire les hauteurs
      </button>
      <div style={{ marginTop: 6, fontSize: 10, opacity: 0.55, lineHeight: 1.35 }}>
        Applique les cotes aux lignes structurelles, puis le solveur interpole les pans. Les chiens assis sont exclus.
      </div>
    </div>
  );
}

export function SceneInspectionPanel3D({
  model,
  pickProvenance2D = null,
  showInspectionEmptyPlaceholder = false,
  showPanSelectionEmptyPlaceholder = false,
  onDismiss,
  roofShellAlignmentLine,
  roofVertexHeightEdit = null,
  roofVertexXYEdit = null,
  structuralRidgeHeightEdit = null,
  roofHeightAssistant = null,
  roofModelingHistory = null,
  onVertexModelingPointerActiveChange,
}: SceneInspectionPanel3DProps) {
  useEffect(() => {
    if (!onVertexModelingPointerActiveChange) return;
    const release = () => onVertexModelingPointerActiveChange(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [onVertexModelingPointerActiveChange]);

  const vertexEditCapture =
    onVertexModelingPointerActiveChange != null &&
    (roofVertexHeightEdit != null || roofVertexXYEdit != null || structuralRidgeHeightEdit != null || roofHeightAssistant != null);

  /** Clic sommet / outils Z·XY : overlay allégé (pas d’historique, provenance 2D ni fiche inspection). */
  const vertexModelingActive =
    roofVertexHeightEdit != null || roofVertexXYEdit != null || structuralRidgeHeightEdit != null || roofHeightAssistant != null;

  const panelStyleResolved: CSSProperties = vertexModelingActive
    ? { ...panelStyle, width: "min(300px, 92vw)", maxHeight: "min(55vh, 400px)" }
    : panelStyle;

  return (
    <div style={panelStyleResolved} data-testid="scene-inspection-panel-3d">
      {vertexModelingActive && onDismiss != null ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Fermer"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "inherit",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Fermer
          </button>
        </div>
      ) : null}
      {!vertexModelingActive && roofModelingHistory != null ? <RoofModelingHistoryBlock h={roofModelingHistory} /> : null}
      {!vertexModelingActive && roofShellAlignmentLine != null && roofShellAlignmentLine.length > 0 ? (
        <div
          data-testid="scene-inspection-shell-align"
          style={{
            marginBottom: 10,
            paddingBottom: 8,
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            fontFamily: "ui-monospace, monospace",
            fontSize: 10,
            lineHeight: 1.4,
            color: "rgba(165, 180, 252, 0.95)",
            wordBreak: "break-word",
          }}
        >
          {roofShellAlignmentLine}
        </div>
      ) : null}
      {!vertexModelingActive && model == null && showInspectionEmptyPlaceholder && pickProvenance2D == null ? (
        <>
          <div style={titleStyle}>Inspection</div>
          <div style={{ opacity: 0.75 }}>Aucune sélection</div>
          <div style={{ marginTop: 8, fontSize: 11, opacity: 0.55 }}>
            Cliquez un pan, un panneau ou un volume pour inspecter.
          </div>
        </>
      ) : null}
      {!vertexModelingActive &&
      model == null &&
      showPanSelectionEmptyPlaceholder &&
      pickProvenance2D == null &&
      !showInspectionEmptyPlaceholder ? (
        <>
          <div style={titleStyle}>Sélection 3D</div>
          <div style={{ opacity: 0.75 }}>Aucun pan sélectionné</div>
          <div style={{ marginTop: 8, fontSize: 11, opacity: 0.55 }}>
            Cliquez un pan (ou un sommet) pour afficher la provenance 2D.
          </div>
        </>
      ) : null}
      {!vertexModelingActive && model != null ? (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              paddingBottom: 8,
            }}
          >
            <div style={{ ...titleStyle, marginBottom: 0, borderBottom: "none", paddingBottom: 0, flex: 1 }}>{model.title}</div>
            {onDismiss != null && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Fermer l’inspection"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "inherit",
                  borderRadius: 6,
                  padding: "2px 8px",
                  fontSize: 11,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Effacer
              </button>
            )}
          </div>
          <dl style={{ margin: 0 }}>
            {model.rows.map((r, idx) => (
              <div
                key={`${idx}-${r.label}`}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "5px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <dt style={rowLabel}>{r.label}</dt>
                <dd style={{ margin: 0, flex: 1, wordBreak: "break-word" }}>{r.value}</dd>
              </div>
            ))}
          </dl>
          {model.warnings.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 11, opacity: 0.8, marginBottom: 6 }}>Alertes</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(251, 191, 36, 0.92)" }}>
                {model.warnings.map((w, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}
      {!vertexModelingActive && pickProvenance2D != null
        ? renderProvenanceBlock(pickProvenance2D, model == null ? onDismiss : undefined)
        : null}
      {vertexEditCapture ? (
        <div onPointerDownCapture={() => onVertexModelingPointerActiveChange!(true)}>
          {roofHeightAssistant != null ? <RoofHeightAssistantBlock assistant={roofHeightAssistant} /> : null}
          {roofVertexHeightEdit != null ? <RoofVertexHeightEditBlock edit={roofVertexHeightEdit} /> : null}
          {roofVertexXYEdit != null ? <RoofVertexXYEditBlock edit={roofVertexXYEdit} /> : null}
          {structuralRidgeHeightEdit != null ? (
            <StructuralRidgeHeightEditBlock edit={structuralRidgeHeightEdit} />
          ) : null}
        </div>
      ) : (
        <>
          {roofHeightAssistant != null ? <RoofHeightAssistantBlock assistant={roofHeightAssistant} /> : null}
          {roofVertexHeightEdit != null ? <RoofVertexHeightEditBlock edit={roofVertexHeightEdit} /> : null}
          {roofVertexXYEdit != null ? <RoofVertexXYEditBlock edit={roofVertexXYEdit} /> : null}
          {structuralRidgeHeightEdit != null ? (
            <StructuralRidgeHeightEditBlock edit={structuralRidgeHeightEdit} />
          ) : null}
        </>
      )}
    </div>
  );
}
