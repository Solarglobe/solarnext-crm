/**
 * Phase2Sidebar — Sidebar React Phase 2 (Relevé toiture).
 * Composant pur, données via usePhase2Data.
 * Structure produit : 5 zones (header → action → pans → validation → secondaire).
 */
import { useEffect, useRef, useState } from "react";
import styles from "./Phase2Sidebar.module.css";
import { usePhase2Data, setupPhase2SidebarNotify } from "../hooks/usePhase2Data";
import Phase2ObstaclePanel from "./Phase2ObstaclePanel";

function Phase2Header() {
  return (
    <header className={styles.zoneHeader}>
      <div className={styles.zoneHeaderTitleRow}>
        <span className={styles.zoneHeaderPhase}>Phase 2</span>
        <span className={styles.zoneHeaderDivider} aria-hidden="true">
          ·
        </span>
        <span className={styles.zoneHeaderSubtitle}>Relevé toiture</span>
      </div>
      <p className={styles.zoneHeaderTagline}>Contour, pans, puis validation pour l’implantation.</p>
    </header>
  );
}

function Phase2Toolbar() {
  const { activeTool } = usePhase2Data();
  const toolLabels: Record<string, string> = {
    select: "Sélection",
    contour: "Contour toiture",
    trait: "Trait",
    ridge: "Faîtage",
    heightEdit: "Éditer hauteurs",
    obstacle: "Obstacle",
    mesure: "Mesure",
    roofExtension: "Extension toiture",
  };
  const label = toolLabels[activeTool] || activeTool;

  return (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label="Outil actif"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className={styles.toolbarLabel}>Outil</span>
      <span className={styles.toolbarValue}>{label}</span>
    </div>
  );
}

/** Accès direct aux 3 bascules les plus fréquentes (même logique que la toolbar legacy). */
function Phase2QuickTools() {
  const { captured, activeTool } = usePhase2Data();
  if (!captured) return null;

  const apply = (name: "select" | "contour" | "heightEdit") => {
    const win = window as unknown as { applyCalpinagePhase2Tool?: (n: string) => void };
    if (typeof win.applyCalpinagePhase2Tool === "function") {
      win.applyCalpinagePhase2Tool(name);
    }
  };

  return (
    <div className={styles.quickTools} role="group" aria-label="Raccourcis outils">
      <span className={styles.quickToolsLabel}>Raccourcis</span>
      <div className={styles.quickToolsRow}>
        <button
          type="button"
          className={`${styles.quickToolBtn} ${activeTool === "select" ? styles.quickToolBtnActive : ""}`}
          aria-pressed={activeTool === "select"}
          onClick={() => apply("select")}
          title="Sélection (barre du haut)"
        >
          Sélection
        </button>
        <button
          type="button"
          className={`${styles.quickToolBtn} ${activeTool === "contour" ? styles.quickToolBtnActive : ""}`}
          aria-pressed={activeTool === "contour"}
          onClick={() => apply("contour")}
          title="Contour bâti"
        >
          Contour
        </button>
        <button
          type="button"
          className={`${styles.quickToolBtn} ${activeTool === "heightEdit" ? styles.quickToolBtnActive : ""}`}
          aria-pressed={activeTool === "heightEdit"}
          onClick={() => apply("heightEdit")}
          title="Éditer les hauteurs"
        >
          Hauteurs
        </button>
      </div>
    </div>
  );
}

function Phase2Steps() {
  const {
    contourClosed,
    ridgeDefined,
    heightsDefined,
    obstaclesCount,
    captured,
  } = usePhase2Data();

  const step3Unlocked = ridgeDefined;
  const step3Done =
    obstaclesCount > 0 || (heightsDefined && ridgeDefined);
  const steps = [
    {
      id: "phase2-step-1",
      short: "Contour",
      label: "Contour toiture",
      status: contourClosed ? "completed" : "active",
    },
    {
      id: "phase2-step-2",
      short: "Faîtage",
      label: "Faîtage",
      status: !contourClosed ? "inactive" : ridgeDefined ? "completed" : "active",
    },
    {
      id: "phase2-step-3",
      short: "Obs.",
      label: "Obstacles (facultatif)",
      status: !step3Unlocked
        ? "inactive"
        : step3Done
          ? "completed"
          : "active",
    },
    {
      id: "phase2-step-4",
      short: "Haut.",
      label: "Hauteurs & validation",
      status: !step3Unlocked
        ? "inactive"
        : heightsDefined
          ? "completed"
          : obstaclesCount > 0
            ? "active"
            : "pending",
    },
  ];

  if (!captured) return null;

  return (
    <ul className={styles.stepsCompact} aria-label="Étapes du relevé toiture">
      {steps.map((s) => (
        <li
          key={s.id}
          className={styles.stepChip}
          data-step={s.id.replace("phase2-step-", "")}
          data-status={s.status}
          title={s.label}
        >
          <span className={styles.stepChipDot} aria-hidden="true" />
          <span className={styles.stepChipText}>{s.short}</span>
        </li>
      ))}
    </ul>
  );
}

function Phase2StateBlock() {
  const { captured, hasExistingGeometry } = usePhase2Data();
  return (
    <div className={styles.stateBlockCompact}>
      <div className={styles.stateTitleCompact}>État</div>
      <ul className={styles.stateCompactList}>
        <li className={styles.stateCompactItem} id="state-scale">
          Échelle auto
        </li>
        <li className={styles.stateCompactItem} id="state-north">
          Nord auto
        </li>
        <li className={styles.stateCompactItem} id="state-capture">
          <span id="state-capture-text">
            {captured ? "Capture : effectuée" : "Capture : non effectuée"}
          </span>
        </li>
      </ul>
      {hasExistingGeometry ? (
        <p className={styles.existingGeomHintCompact} role="status" aria-live="polite">
          Brouillon existant — nouvelle capture = effacement (confirmation).
        </p>
      ) : null}
    </div>
  );
}

function Phase2Actions() {
  const { canValidate, validateHint } = usePhase2Data();

  const handleValidate = () => {
    document.getElementById("btn-validate-roof")?.click();
  };

  return (
    <div className={styles.actions} id="zone-a-validate-block">
      <button
        type="button"
        className={`${styles.actionBtn} ${styles.primary}`}
        onClick={handleValidate}
        disabled={!canValidate}
        title={
          canValidate
            ? "Cliquez pour figer le relevé et passer à l'implantation des panneaux."
            : "Contour bâti valide et au moins un pan requis"
        }
      >
        Valider le relevé toiture
      </button>
      <p
        className={styles.validateHint}
        id="zone-a-validate-hint"
        aria-live="polite"
      >
        {validateHint || "Contour bâti et au moins un pan requis."}
      </p>
    </div>
  );
}

const MAP_SOURCE_OPTIONS: { value: "google" | "geoportail-ortho"; label: string }[] = [
  { value: "google", label: "Google Satellite" },
  { value: "geoportail-ortho", label: "IGN Ortho" },
];

/** Source carte : dropdown custom light-only, même logique que l’ancien select. */
function Phase2MapSource() {
  const [mapProvider, setMapProvider] = useState<"google" | "geoportail-ortho">("google");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (window as unknown as { __CALPINAGE_INITIAL_PROVIDER__?: string }).__CALPINAGE_INITIAL_PROVIDER__ = mapProvider;
  }, [mapProvider]);

  const applySelection = (value: "google" | "geoportail-ortho") => {
    setMapProvider(value);
    if (typeof (window as unknown as { calpinageMap?: { switchProvider?: (src: string) => void } }).calpinageMap?.switchProvider === "function") {
      (window as unknown as { calpinageMap: { switchProvider: (src: string) => void } }).calpinageMap.switchProvider(value);
    }
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setHighlightedIndex(MAP_SOURCE_OPTIONS.findIndex((o) => o.value === mapProvider));
  }, [isOpen, mapProvider]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setIsOpen(true);
        setHighlightedIndex(MAP_SOURCE_OPTIONS.findIndex((o) => o.value === mapProvider));
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((i) => (i + 1) % MAP_SOURCE_OPTIONS.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((i) => (i - 1 + MAP_SOURCE_OPTIONS.length) % MAP_SOURCE_OPTIONS.length);
        break;
      case "Enter":
        e.preventDefault();
        applySelection(MAP_SOURCE_OPTIONS[highlightedIndex].value);
        break;
      default:
        break;
    }
  };

  const selectedLabel = MAP_SOURCE_OPTIONS.find((o) => o.value === mapProvider)?.label ?? "Google Satellite";

  return (
    <div
      className={`${styles.mapSourceRoot} map-source-selector`}
      id="zone-a-source-container"
      ref={containerRef}
    >
      <label className={styles.mapSourceLabel} htmlFor="calpinage-map-source">
        Carte
      </label>
      <button
        type="button"
        id="calpinage-map-source"
        className={styles.mapSourceTrigger}
        aria-label="Source de la carte"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((o) => !o)}
        onKeyDown={handleKeyDown}
      >
        {selectedLabel}
      </button>
      {isOpen && (
        <div
          className={styles.mapSourceDropdown}
          role="listbox"
          aria-activedescendant={MAP_SOURCE_OPTIONS[highlightedIndex] ? `map-source-opt-${MAP_SOURCE_OPTIONS[highlightedIndex].value}` : undefined}
        >
          {MAP_SOURCE_OPTIONS.map((opt, i) => (
            <div
              key={opt.value}
              id={`map-source-opt-${opt.value}`}
              role="option"
              aria-selected={mapProvider === opt.value}
              data-value={opt.value}
              className={`${styles.mapSourceOption} ${mapProvider === opt.value ? styles.mapSourceOptionActive : ""} ${i === highlightedIndex ? styles.mapSourceOptionHighlight : ""}`}
              onClick={() => applySelection(opt.value)}
              onMouseEnter={() => setHighlightedIndex(i)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Emplacement pour la liste des pans — le legacy peuple #zone-a-pans-list. */
function Phase2PansBlock() {
  return (
    <div className={styles.pansZone} id="zone-a-pans-block">
      <div className={styles.pansZoneTitle}>Pans</div>
      <ul
        id="zone-a-pans-list"
        className="pans-list"
        aria-label="Liste des pans du toit"
      />
    </div>
  );
}

export default function Phase2Sidebar() {
  useEffect(() => {
    const previous = (window as any).notifyPhase2SidebarUpdate;
    const fn = setupPhase2SidebarNotify();
    return () => {
      if ((window as any).notifyPhase2SidebarUpdate === fn) {
        if (previous) (window as any).notifyPhase2SidebarUpdate = previous;
        else delete (window as any).notifyPhase2SidebarUpdate;
      }
    };
  }, []);

  return (
    <aside className={styles.sidebar}>
      <Phase2Header />

      <section className={styles.zoneAction} aria-label="Action">
        <span className={styles.zoneEyebrow}>Action</span>
        <div className={styles.actionCard}>
          <Phase2Toolbar />
          <Phase2QuickTools />
        </div>
      </section>

      <section className={styles.zoneValidation} aria-label="Validation">
        <span className={styles.zoneEyebrow}>Validation</span>
        <Phase2Steps />
        <Phase2Actions />
      </section>

      <section className={styles.zonePans} aria-label="Pans">
        <span className={styles.zoneEyebrow}>Pans</span>
        <Phase2PansBlock />
      </section>

      <section className={styles.zoneSecondary} aria-label="Infos complémentaires">
        <span className={styles.zoneEyebrow}>Secondaire</span>
        <Phase2MapSource />
        <details className={styles.secondaryDetails}>
          <summary className={styles.secondarySummary}>État et propriétés</summary>
          <div className={styles.secondaryDetailsBody}>
            <Phase2StateBlock />
            <div className={styles.propertiesSlot}>
              <Phase2ObstaclePanel compact />
            </div>
          </div>
        </details>
      </section>
    </aside>
  );
}
