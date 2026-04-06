/**
 * CP-DSM-UI-003 — Panneau « Quand l’ombre agit le plus » + simulation soleil (repliable).
 * Aucun recalcul shading métier — position solaire pour le radar uniquement.
 *
 * DSM OVERLAY ONLY — not the official shading source of truth (docs/dsm-overlay-governance.md).
 */

import { computeSunPosition } from "./solarPosition.js";
import { getHorizonTemporalUiProfile } from "./dominantDirection.js";
import { getTemporalConclusionLine } from "./shadingUxLabels.js";

const HOUR_MIN = 6;
const HOUR_MAX = 20;
const HOUR_STEP = 0.1;

/**
 * Position solaire pour l'UI.
 * Été → 21 juin, Hiver → 21 décembre.
 */
export function getSolarPositionForUI(hour, season, latDeg, lonDeg) {
  if (typeof latDeg !== "number" || typeof lonDeg !== "number") return null;
  const year = new Date().getFullYear();
  const month = (season || "").toLowerCase() === "été" ? 5 : 11;
  const day = 21;
  const hh = Math.floor(hour);
  const mm = Math.round((hour - hh) * 60);
  const date = new Date(year, month, day, hh, mm, 0);
  return computeSunPosition(date, latDeg, lonDeg);
}

function formatHour(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h${String(mm).padStart(2, "0")}`;
}

function maxInList(items) {
  let m = 0;
  for (const x of items) m = Math.max(m, x);
  return m || 1;
}

function barRowHtml(items, maxVal, activeKey) {
  return items
    .map((it) => {
      const w = maxVal > 0 ? Math.round((it.value / maxVal) * 100) : 0;
      const active = it.key === activeKey ? " dsm-temporal-hbar-fill--active" : "";
      return `<div class="dsm-temporal-hbar" title="${it.label}">
        <span class="dsm-temporal-hbar-label">${it.label}</span>
        <div class="dsm-temporal-hbar-track"><div class="dsm-temporal-hbar-fill${active}" style="width:${w}%"></div></div>
      </div>`;
    })
    .join("");
}

/**
 * @param {HTMLElement} overlayRoot
 * @param {Object} opts
 * @param {function(): { lat: number, lon: number } | null} opts.getGps
 * @param {function(): void} opts.onSolarUpdate
 * @param {function(sunPos): void} opts.setSolarPosition
 * @param {HTMLElement} [opts.mountParent] — conteneur (ex. colonne droite) ; défaut overlayRoot
 * @param {boolean} [opts.insertFirst] — insérer avant le premier enfant du mountParent
 * @returns {{ destroy: () => void, refreshTemporal: (ctx: object) => void }}
 */
export function createDsmSolarAnimationControls(overlayRoot, opts = {}) {
  const getGps = opts.getGps || (() => null);
  const onSolarUpdate = opts.onSolarUpdate || (() => {});
  const setSolarPosition = opts.setSolarPosition || (() => {});
  const mountParent = opts.mountParent || overlayRoot;
  const insertFirst = !!opts.insertFirst;

  if (!mountParent || !mountParent.isConnected) {
    return { destroy: () => {}, refreshTemporal: () => {} };
  }

  const panel = document.createElement("div");
  panel.id = "dsm-shading-temporal-panel";
  panel.className = "dsm-shading-temporal-panel";
  panel.setAttribute("aria-label", "Quand l’ombre agit le plus");

  panel.innerHTML = `
    <div class="dsm-temporal-head">
      <span class="dsm-temporal-title">Quand l’ombre agit le plus</span>
    </div>
    <div class="dsm-temporal-body" id="dsm-temporal-dynamic">
      <p class="dsm-temporal-muted">Chargement…</p>
    </div>
    <details class="dsm-sun-sim-details">
      <summary>Simulation soleil sur le radar</summary>
      <div class="dsm-sun-sim-inner">
        <div class="dsm-solar-header">
          <span class="dsm-solar-hour-display" id="dsm-solar-hour-display">12h00</span>
          <div class="dsm-solar-season-toggle" id="dsm-solar-season-toggle">
            <button type="button" class="dsm-solar-season-btn active" data-season="été">Été</button>
            <button type="button" class="dsm-solar-season-btn" data-season="hiver">Hiver</button>
          </div>
        </div>
        <div class="dsm-solar-controls-row">
          <input type="range" class="dsm-solar-slider" id="dsm-solar-slider" min="${HOUR_MIN}" max="${HOUR_MAX}" step="${HOUR_STEP}" value="12" aria-label="Heure du jour" />
          <button type="button" class="dsm-solar-play-btn" id="dsm-solar-play" aria-label="Lancer l'animation">▶</button>
        </div>
      </div>
    </details>
  `;

  if (insertFirst && mountParent.firstChild) {
    mountParent.insertBefore(panel, mountParent.firstChild);
  } else {
    mountParent.appendChild(panel);
  }

  const hourDisplay = panel.querySelector("#dsm-solar-hour-display");
  const slider = panel.querySelector("#dsm-solar-slider");
  const playBtn = panel.querySelector("#dsm-solar-play");
  const seasonToggle = panel.querySelector("#dsm-solar-season-toggle");
  const dynamicEl = panel.querySelector("#dsm-temporal-dynamic");

  let hour = 12;
  let season = "été";
  let playing = false;
  let _raf = null;
  let _lastTs = 0;

  function updateSunPosition() {
    const gps = getGps();
    if (!gps || typeof gps.lat !== "number" || typeof gps.lon !== "number") {
      setSolarPosition(null);
      onSolarUpdate();
      return;
    }
    const sunPos = getSolarPositionForUI(hour, season, gps.lat, gps.lon);
    setSolarPosition(sunPos);
    onSolarUpdate();
  }

  function tick(ts) {
    if (!playing) return;
    const dt = (ts - _lastTs) / 1000;
    _lastTs = ts;
    hour += dt * 0.5;
    if (hour >= HOUR_MAX) {
      hour = HOUR_MIN + (hour - HOUR_MAX);
    } else if (hour < HOUR_MIN) {
      hour = HOUR_MAX - (HOUR_MIN - hour);
    }
    hour = Math.max(HOUR_MIN, Math.min(HOUR_MAX, hour));
    slider.value = String(hour);
    hourDisplay.textContent = formatHour(hour);
    updateSunPosition();
    _raf = requestAnimationFrame(tick);
  }

  function startPlay() {
    if (playing) return;
    playing = true;
    _lastTs = performance.now();
    _raf = requestAnimationFrame(tick);
    playBtn.innerHTML = "⏸";
    playBtn.setAttribute("aria-label", "Mettre en pause");
  }

  function stopPlay() {
    playing = false;
    if (_raf) {
      cancelAnimationFrame(_raf);
      _raf = null;
    }
    playBtn.innerHTML = "▶";
    playBtn.setAttribute("aria-label", "Lancer l'animation");
  }

  slider.addEventListener("input", () => {
    hour = parseFloat(slider.value) || 12;
    hourDisplay.textContent = formatHour(hour);
    updateSunPosition();
  });

  playBtn.addEventListener("click", () => {
    if (playing) stopPlay();
    else startPlay();
  });

  seasonToggle.querySelectorAll(".dsm-solar-season-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      season = btn.dataset.season || "été";
      seasonToggle.querySelectorAll(".dsm-solar-season-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      updateSunPosition();
    });
  });

  hourDisplay.textContent = formatHour(hour);
  updateSunPosition();

  function refreshTemporal(ctx) {
    if (!dynamicEl) return;
    const {
      horizonData,
      gps,
      farBlocked,
      dominant,
      nearPct,
      farPct,
    } = ctx || {};

    if (farBlocked || !horizonData || !gps) {
      dynamicEl.innerHTML = `
        <p class="dsm-temporal-conclusion">${getTemporalConclusionLine({ hasSignal: false }, dominant, true, nearPct, farPct)}</p>
        <p class="dsm-temporal-muted">Répartition jour / saison : disponible dès que le site est géolocalisé et le masque d’horizon chargé.</p>
      `;
      return;
    }

    const profile = getHorizonTemporalUiProfile(horizonData, gps.lat, gps.lon);
    const dayMax = maxInList(profile.dayParts.map((d) => d.value));
    const seasonMax = maxInList(profile.seasons.map((s) => s.value));

    const dayHtml = `
      <div class="dsm-temporal-section">
        <span class="dsm-temporal-section-label">Répartition sur la journée</span>
        <div class="dsm-temporal-bars dsm-temporal-bars--day">
          ${barRowHtml(profile.dayParts, dayMax, profile.dominantDayKey)}
        </div>
      </div>`;

    const seasonHtml = `
      <div class="dsm-temporal-section">
        <span class="dsm-temporal-section-label">Répartition par saison</span>
        <div class="dsm-temporal-bars dsm-temporal-bars--season">
          ${barRowHtml(profile.seasons, seasonMax, profile.dominantSeasonKey)}
        </div>
      </div>`;

    const conclusion = getTemporalConclusionLine(profile, dominant, false, nearPct, farPct);

    dynamicEl.innerHTML = `${dayHtml}${seasonHtml}<p class="dsm-temporal-conclusion">${conclusion}</p>`;
  }

  return {
    refreshTemporal,
    destroy() {
      stopPlay();
      panel.remove();
    },
  };
}
