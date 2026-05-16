/**
 * phases.js — Roadmap data model
 * Step 1: structure + phases definition (items populated in Step 3)
 *
 * ─────────────────────────────────────────────────────────────────
 * ITEM SCHEMA (for Step 3 reference)
 * ─────────────────────────────────────────────────────────────────
 * {
 *   id:           string,        // "C1", "U3", "R2" …
 *   phaseId:      string,        // matches PHASES[n].id
 *   title:        string,
 *   priority:     "critique" | "important" | "polish",
 *   difficulty:   1–5,           // 1 easy → 5 hard
 *   impact:       1–5,           // 1 low → 5 critical
 *   effort:       string,        // "30min" | "2h" | "1j" | "3j+"
 *   areas:        string[],      // ["frontend","backend","3d","css","tests"]
 *   files:        string[],      // affected file paths (short form)
 *   description:  string,        // plain text for card body
 *   riskDetails:  string,        // regression risks
 *   dependencies: string[],      // other item IDs this depends on
 *   prompt:       string,        // ready-to-send prompt for Claude / Codex
 * }
 *
 * Status is NOT stored here — it lives in localStorage via AppState.
 * ─────────────────────────────────────────────────────────────────
 */

/* ================================================================
   PHASES DEFINITION
   ================================================================ */
const PHASES = [
  {
    id:    "critiques",
    number: "01",
    icon:  "🔴",
    title: "Critiques Production",
    desc:  "Bugs bloquants, violations React, corruptions de données silencieuses. À résoudre avant toute démonstration client.",
    color: "var(--critical)",
    items: [],
  },
  {
    id:    "workflow",
    number: "02",
    icon:  "🎯",
    title: "UX & Workflow Métier",
    desc:  "Fluidité du workflow PV, cohérence des interactions Phase 2 → Phase 3, retours utilisateur synchrones.",
    color: "var(--warning)",
    items: [],
  },
  {
    id:    "rendering3d",
    number: "03",
    icon:  "🎮",
    title: "Rendu 3D",
    desc:  "Qualité visuelle Three.js / R3F, instanciation panneaux, postprocessing, animations de transition caméra.",
    color: "var(--area-3d)",
    items: [],
  },
  {
    id:    "performance",
    number: "04",
    icon:  "⚡",
    title: "Performance",
    desc:  "Bundle Three.js non lazy-loadé, BVH raycast manquant, pool DB non configuré, polling 400ms permanent.",
    color: "var(--accent)",
    items: [],
  },
  {
    id:    "shading",
    number: "05",
    icon:  "☀️",
    title: "Shading & Ombrage",
    desc:  "Divergences moteur near shading UI vs backend, triangulation concave incorrecte, fallbacks silencieux.",
    color: "var(--warning)",
    items: [],
  },
  {
    id:    "geometry",
    number: "06",
    icon:  "📐",
    title: "Géométrie & Topologie",
    desc:  "Centroïdes arithmétiques incorrects, propagation mpp manquante, plans quasi-verticaux non supportés.",
    color: "var(--area-css)",
    items: [],
  },
  {
    id:    "mobile",
    number: "07",
    icon:  "📱",
    title: "Mobile",
    desc:  "Viewer 3D sans adaptation mobile, overlays trop larges, toasts non dismissables sur tactile.",
    color: "var(--area-frontend)",
    items: [],
  },
  {
    id:    "polish",
    number: "08",
    icon:  "✨",
    title: "Visual Polish",
    desc:  "Tokens CSS unifiés, dark mode complet, animations, cohérence typographique, overlays debug masqués.",
    color: "var(--info)",
    items: [],
  },
  {
    id:    "architecture",
    number: "09",
    icon:  "🏗️",
    title: "Architecture Long Terme",
    desc:  "Supprimer le global bus window, Zustand source unique, IIFE → modules, DDD backend, Prisma migration.",
    color: "var(--area-backend)",
    items: [],
  },
  {
    id:    "qa",
    number: "10",
    icon:  "🧪",
    title: "QA & Tests",
    desc:  "Couverture mesurée, Playwright mobile, tests contrôleurs backend, CI sans DB live, scripts automatisés.",
    color: "var(--area-tests)",
    items: [],
  },
  {
    id:    "premium",
    number: "11",
    icon:  "🚀",
    title: "Fonctionnalités Premium (niveau Aurora/Archelios)",
    desc:  "Ce qui manque vs les leaders du marché : far shading horizon IGN, ombrage inter-rangées, validation électrique string sizing, panneaux bifaciaux, simulation yield TMY P50/P90.",
    color: "var(--accent)",
    items: [],
  },
];

/* ================================================================
   ITEMS FLAT REGISTRY
   Populated progressively in Step 3.
   Each item must have phaseId matching one of PHASES[n].id
   ================================================================ */
const ITEMS = [
  /* ── Step 3 injecte tous les items : 67 items P1–P10 + 5 items P11 = 72 total ── */
];

/* ================================================================
   HELPER: get items for a phase
   ================================================================ */
function getPhaseItems(phaseId) {
  return ITEMS.filter(item => item.phaseId === phaseId);
}
