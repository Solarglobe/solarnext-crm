/**
 * app.js — Application principale : state, filtres, rendu, événements
 * Dépend de : components.js, navigation.js, keyboard.js, data/phases.js
 */

/* ================================================================
   APP STATE — localStorage
   ================================================================ */
const AppState = (() => {
  const KEY = "solarnext_cc_v1";
  let _s = {};

  function load() {
    try { _s = JSON.parse(localStorage.getItem(KEY) || "{}"); }
    catch { _s = {}; }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(_s)); }
    catch { /* quota — silent */ }
  }

  function getItemStatus(id) { return _s[id] || "todo"; }

  function setItemStatus(id, status) {
    _s[id] = status;
    save();
  }

  function reset() { _s = {}; save(); }

  function exportJson() {
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      statuses: { ..._s },
    }, null, 2);
  }

  function importJson(json) {
    const parsed = JSON.parse(json);
    if (parsed.statuses && typeof parsed.statuses === "object") {
      _s = parsed.statuses;
      save();
      return true;
    }
    return false;
  }

  return { load, save, getItemStatus, setItemStatus, reset, exportJson, importJson };
})();


/* ================================================================
   FILTERS
   ================================================================ */
const Filters = (() => {
  let _f = { priority: "all", area: "all", status: "all", search: "" };

  function get() { return { ..._f }; }

  function set(key, value) {
    _f[key] = value;
    App.renderCurrentView();
  }

  function reset() {
    _f = { priority: "all", area: "all", status: "all", search: "" };
    const si = document.getElementById("search-input");
    if (si) si.value = "";
    ["filter-priority", "filter-status", "filter-area"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "all";
    });
    App.renderCurrentView();
  }

  function apply(items) {
    return items.filter(item => {
      if (_f.priority !== "all" && item.priority !== _f.priority) return false;
      if (_f.status   !== "all" && AppState.getItemStatus(item.id) !== _f.status) return false;
      if (_f.area     !== "all" && !(item.areas || []).includes(_f.area)) return false;
      if (_f.search) {
        const q = _f.search.toLowerCase();
        const hay = [
          item.id, item.title, item.description || "",
          ...(item.files || []), ...(item.areas || []),
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function hasActive() {
    return _f.priority !== "all" || _f.area !== "all" ||
           _f.status !== "all" || _f.search !== "";
  }

  return { get, set, reset, apply, hasActive };
})();


/* ================================================================
   MAIN APP
   ================================================================ */
const App = (() => {

  /* ----------------------------------------------------------------
     INIT
     ---------------------------------------------------------------- */
  function init() {
    AppState.load();
    _createMobileOverlay();
    _renderFilterBar();
    _updateGlobalProgress();
    Navigation.init();
    Keyboard.init();
    _bindGlobalEvents();
  }

  /* ----------------------------------------------------------------
     FILTER BAR
     ---------------------------------------------------------------- */
  function _renderFilterBar() {
    const group = document.getElementById("filter-group");
    if (!group) return;

    group.innerHTML = `
      <select class="filter-select" id="filter-priority" aria-label="Priorité">
        <option value="all">Toutes priorités</option>
        <option value="critique">🔴 Critique</option>
        <option value="important">🟠 Important</option>
        <option value="polish">🟡 Polish</option>
      </select>
      <select class="filter-select" id="filter-status" aria-label="Statut">
        <option value="all">Tous statuts</option>
        <option value="todo">TODO</option>
        <option value="inprogress">EN COURS</option>
        <option value="validated">VALIDÉ</option>
        <option value="blocked">BLOQUÉ</option>
      </select>
      <select class="filter-select" id="filter-area" aria-label="Zone">
        <option value="all">Toutes zones</option>
        <option value="frontend">Frontend</option>
        <option value="backend">Backend</option>
        <option value="3d">3D</option>
        <option value="css">CSS</option>
        <option value="tests">Tests</option>
      </select>
    `;

    document.getElementById("filter-priority")
      ?.addEventListener("change", e => Filters.set("priority", e.target.value));
    document.getElementById("filter-status")
      ?.addEventListener("change", e => Filters.set("status", e.target.value));
    document.getElementById("filter-area")
      ?.addEventListener("change", e => Filters.set("area", e.target.value));
  }

  /* ----------------------------------------------------------------
     GLOBAL PROGRESS UPDATE
     ---------------------------------------------------------------- */
  function _updateGlobalProgress() {
    const total = ITEMS.length;
    const done  = ITEMS.filter(i => AppState.getItemStatus(i.id) === "validated").length;
    const pct   = total ? Math.round((done / total) * 100) : 0;

    const bar    = document.getElementById("global-bar");
    const pctEl  = document.getElementById("global-pct");
    const doneEl = document.getElementById("global-done");
    const totEl  = document.getElementById("global-total");

    if (bar)    { bar.style.width = pct + "%"; bar.parentElement?.setAttribute("aria-valuenow", pct); }
    if (pctEl)  pctEl.textContent  = pct + "%";
    if (doneEl) doneEl.textContent = done;
    if (totEl)  totEl.textContent  = total;
  }

  /* ----------------------------------------------------------------
     RENDER PHASE  (null → overview)
     ---------------------------------------------------------------- */
  function renderPhase(phaseId) {
    const overviewEl = document.getElementById("overview-view");
    const phaseViewEl= document.getElementById("phase-view");
    const headerEl   = document.getElementById("phase-header");
    const gridEl     = document.getElementById("cards-grid");
    const emptyEl    = document.getElementById("empty-state");

    /* ── OVERVIEW ── */
    if (!phaseId) {
      overviewEl.style.display  = "flex";
      phaseViewEl.style.display = "none";
      headerEl.style.display    = "none";

      // Stats bar
      const sbEl = document.getElementById("stats-bar");
      if (sbEl) sbEl.innerHTML = renderStatsBar();

      // Distribution bar
      const dbEl = document.getElementById("distribution-bar-wrap");
      if (dbEl) {
        const db = renderDistributionBar();
        dbEl.innerHTML = db;
        dbEl.style.display = db ? "flex" : "none";
      }

      // Phase cards
      const ogEl = document.getElementById("overview-grid");
      if (ogEl) {
        ogEl.innerHTML = PHASES.map(renderPhaseCard).join("");
        _bindPhaseCardEvents(ogEl);
      }

      _updateGlobalProgress();
      Navigation.refresh();
      return;
    }

    /* ── PHASE VIEW ── */
    const phase = PHASES.find(p => p.id === phaseId);
    if (!phase) return;

    overviewEl.style.display  = "none";
    phaseViewEl.style.display = "flex";
    headerEl.style.display    = "flex";

    document.getElementById("phase-number").textContent = phase.icon;
    document.getElementById("phase-title").textContent  = phase.title;
    document.getElementById("phase-desc").textContent   = phase.desc;
    document.getElementById("phase-stats").innerHTML    = renderPhaseStats(phase);

    // Filter items
    let items = ITEMS.filter(i => i.phaseId === phaseId);
    items = Filters.apply(items);

    if (items.length === 0) {
      gridEl.style.display  = "none";
      emptyEl.style.display = "flex";
    } else {
      emptyEl.style.display = "none";
      gridEl.style.display  = "grid";
      gridEl.innerHTML = items.map(renderTaskCard).join("");
      _bindCardEvents(gridEl);
    }

    _updateGlobalProgress();
    Navigation.refresh();
  }

  /* ----------------------------------------------------------------
     RENDER CURRENT VIEW
     ---------------------------------------------------------------- */
  function renderCurrentView() {
    renderPhase(Navigation.getCurrentPhase());
  }

  /* ----------------------------------------------------------------
     PHASE CARD EVENTS (overview)
     ---------------------------------------------------------------- */
  function _bindPhaseCardEvents(container) {
    container.querySelectorAll(".phase-card").forEach(card => {
      card.addEventListener("click", () => Navigation.navigate(card.dataset.phase));
      card.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          Navigation.navigate(card.dataset.phase);
        }
      });
    });
  }

  /* ----------------------------------------------------------------
     CARD EVENTS (phase view)
     ---------------------------------------------------------------- */
  function _bindCardEvents(container) {
    // Open modal
    container.querySelectorAll(".task-card").forEach(card => {
      card.addEventListener("click", e => {
        if (e.target.closest(".card-check") ||
            e.target.closest(".copy-prompt-btn") ||
            e.target.closest(".quick-status-trigger")) return;
        _openModal(card.dataset.id);
      });
      card.addEventListener("keydown", e => {
        if (e.key === "Enter") _openModal(card.dataset.id);
      });
    });

    // Checkbox: toggle validated ↔ todo
    container.querySelectorAll(".card-check").forEach(check => {
      check.addEventListener("click", e => {
        e.stopPropagation();
        const id   = check.dataset.id;
        const next = AppState.getItemStatus(id) === "validated" ? "todo" : "validated";
        AppState.setItemStatus(id, next);
        renderCurrentView();
      });
    });

    // Copy prompt (pass btn for animation feedback)
    container.querySelectorAll(".copy-prompt-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        copyPrompt(btn.dataset.id, btn);
      });
    });

    // Quick status trigger
    container.querySelectorAll(".quick-status-trigger").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        _toggleQuickMenu(btn, btn.dataset.id);
      });
    });
  }

  /* ----------------------------------------------------------------
     QUICK STATUS MENU
     ---------------------------------------------------------------- */
  let _activeQuickMenu = null;

  function _toggleQuickMenu(trigger, itemId) {
    // Close if same menu open
    if (_activeQuickMenu) {
      _activeQuickMenu.remove();
      _activeQuickMenu = null;
      return;
    }

    const menuHtml = renderQuickStatusMenu(itemId);
    const wrapper  = trigger.closest(".card-actions");
    if (!wrapper) return;

    wrapper.style.position = "relative";
    wrapper.insertAdjacentHTML("beforeend", menuHtml);
    _activeQuickMenu = wrapper.querySelector(".quick-status-menu");

    // Bind items
    _activeQuickMenu.querySelectorAll(".quick-status-item").forEach(item => {
      item.addEventListener("click", e => {
        e.stopPropagation();
        AppState.setItemStatus(item.dataset.id, item.dataset.status);
        _activeQuickMenu?.remove();
        _activeQuickMenu = null;
        renderCurrentView();
      });
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener("click", _closeQuickMenu, { once: true });
    }, 0);
  }

  function _closeQuickMenu() {
    _activeQuickMenu?.remove();
    _activeQuickMenu = null;
  }

  /* ----------------------------------------------------------------
     MODAL
     ---------------------------------------------------------------- */
  function _openModal(itemId) {
    const item = ITEMS.find(i => i.id === itemId);
    if (!item) return;

    const overlay = document.getElementById("modal-overlay");
    const metaEl  = document.getElementById("modal-meta");
    const bodyEl  = document.getElementById("modal-body");

    const phase      = PHASES.find(p => p.id === item.phaseId);
    const areaBadges = (item.areas || []).map(renderAreaBadge).join("");
    const status     = AppState.getItemStatus(item.id);

    metaEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        ${renderPriorityBadge(item.priority)}
        ${renderStatusBadge(status)}
        ${areaBadges}
        ${phase ? `<span style="font-size:var(--text-xs);color:var(--text-muted);margin-left:4px">
          ${phase.icon} ${escapeHtml(phase.title)}
        </span>` : ""}
      </div>
      <div style="font-size:var(--text-xs);color:var(--text-muted);font-family:var(--font-mono);margin-bottom:4px">
        ${escapeHtml(item.id)} ·
        Effort&nbsp;<strong style="color:var(--text-secondary)">${escapeHtml(item.effort || '—')}</strong> ·
        Impact&nbsp;<strong style="color:var(--text-secondary)">${item.impact || 1}/5</strong>
      </div>
      <h2 id="modal-task-title"
          style="font-size:var(--text-xl);font-weight:var(--weight-semi);
                 color:var(--text-primary);line-height:1.3">
        ${escapeHtml(item.title)}
      </h2>
    `;

    bodyEl.innerHTML = renderModalBody(item);

    // Status buttons
    bodyEl.querySelectorAll(".status-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest(".status-buttons")?.dataset.id;
        if (!id) return;
        AppState.setItemStatus(id, btn.dataset.status);
        bodyEl.querySelectorAll(".status-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderCurrentView();
      });
    });

    // Copy prompt in modal
    bodyEl.querySelectorAll(".copy-prompt-btn").forEach(btn => {
      btn.addEventListener("click", () => copyPrompt(btn.dataset.id));
    });

    overlay.style.display = "flex";
    document.body.style.overflow = "hidden";
    setTimeout(() => document.getElementById("modal-close")?.focus(), 50);
  }

  function _closeModal() {
    document.getElementById("modal-overlay").style.display = "none";
    document.body.style.overflow = "";
  }

  /* ----------------------------------------------------------------
     EXPORT / IMPORT
     ---------------------------------------------------------------- */
  function _exportProgress() {
    const json = AppState.exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `cc-progress-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("✅ Progression exportée !");
  }

  function _importProgress(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const ok = AppState.importJson(e.target.result);
        if (ok) {
          showToast("✅ Progression importée avec succès !");
          renderCurrentView();
        } else {
          showToast("❌ Format JSON invalide");
        }
      } catch {
        showToast("❌ Fichier JSON illisible");
      }
    };
    reader.readAsText(file);
  }

  /* ----------------------------------------------------------------
     GLOBAL EVENTS
     ---------------------------------------------------------------- */
  function _bindGlobalEvents() {
    // Search debounced
    let _st;
    document.getElementById("search-input")?.addEventListener("input", e => {
      clearTimeout(_st);
      _st = setTimeout(() => Filters.set("search", e.target.value.trim()), 220);
    });

    // Reset filters
    document.getElementById("btn-reset-filters")?.addEventListener("click", e => {
      e.preventDefault();
      Filters.reset();
    });

    // Clear filters (empty state)
    document.getElementById("btn-clear-filters")?.addEventListener("click", () => Filters.reset());

    // Modal close
    document.getElementById("modal-close")?.addEventListener("click", _closeModal);
    document.getElementById("modal-overlay")?.addEventListener("click", e => {
      if (e.target === e.currentTarget) _closeModal();
    });

    // Escape (also handled by keyboard.js, but also here for safety)
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") _closeModal();
    });

    // Export
    document.getElementById("btn-export")?.addEventListener("click", _exportProgress);

    // Import
    document.getElementById("btn-import")?.addEventListener("click", () => {
      document.getElementById("import-file-input")?.click();
    });
    document.getElementById("import-file-input")?.addEventListener("change", e => {
      _importProgress(e.target.files?.[0]);
      e.target.value = "";
    });
  }

  /* ----------------------------------------------------------------
     MOBILE OVERLAY
     ---------------------------------------------------------------- */
  function _createMobileOverlay() {
    if (!document.querySelector(".mobile-overlay")) {
      const el = document.createElement("div");
      el.className = "mobile-overlay";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
  }

  return { init, renderPhase, renderCurrentView };
})();


/* ================================================================
   BOOT
   ================================================================ */
document.addEventListener("DOMContentLoaded", () => App.init());
