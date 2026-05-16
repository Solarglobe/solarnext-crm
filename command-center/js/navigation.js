/**
 * navigation.js — Sidebar rendering and phase switching
 * Depends on: components.js (renderNavItem, renderNavItemAll)
 *             data/phases.js (PHASES, ITEMS)
 */

const Navigation = (() => {
  /* ---- State ---- */
  let _currentPhaseId = null; // null = all phases / welcome

  /* ================================================================
     PUBLIC API
     ================================================================ */

  function init() {
    _render();
    _bindSidebarToggle();
    _bindMobileOverlay();
  }

  /** Navigate to a phase (or null / "all" = welcome) */
  function navigate(phaseId) {
    _currentPhaseId = (phaseId === "all" || !phaseId) ? null : phaseId;
    _render();
    _updateBreadcrumb();
    // Delegate content rendering to App
    App.renderPhase(_currentPhaseId);
  }

  /** Re-render nav (called after status changes) */
  function refresh() {
    _render();
  }

  function getCurrentPhase() {
    return _currentPhaseId;
  }

  /* ================================================================
     PRIVATE
     ================================================================ */

  function _render() {
    const nav = document.getElementById("sidebar-nav");
    if (!nav) return;

    let html = "";

    // "All phases" item
    html += renderNavItemAll(_currentPhaseId === null);

    // Section label
    html += `<div class="nav-section-label">Phases</div>`;

    // Phase items
    PHASES.forEach(phase => {
      html += renderNavItem(phase, _currentPhaseId === phase.id);
    });

    nav.innerHTML = html;

    // Bind click/keyboard on all nav-items
    nav.querySelectorAll(".nav-item").forEach(el => {
      el.addEventListener("click", () => navigate(el.dataset.phase));
      el.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(el.dataset.phase);
        }
      });
    });
  }

  function _updateBreadcrumb() {
    const bc = document.getElementById("breadcrumb");
    if (!bc) return;

    if (!_currentPhaseId) {
      bc.innerHTML = `<span>Toutes les phases</span>`;
      return;
    }

    const phase = PHASES.find(p => p.id === _currentPhaseId);
    if (!phase) return;

    bc.innerHTML = `
      <span style="color:var(--text-muted)">Phases</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
           style="margin:0 2px;color:var(--text-muted)" aria-hidden="true">
        <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>${phase.icon} ${escapeHtml(phase.title)}</span>
    `;
  }

  function _bindSidebarToggle() {
    const btn = document.getElementById("btn-sidebar-toggle");
    if (!btn) return;
    btn.addEventListener("click", _toggleSidebar);
  }

  function _bindMobileOverlay() {
    // The overlay element is created by app.js after DOMContentLoaded
    document.addEventListener("click", e => {
      if (e.target.classList.contains("mobile-overlay")) {
        _closeMobileSidebar();
      }
    });
  }

  function _toggleSidebar() {
    const isMobile = window.innerWidth <= 900;
    if (isMobile) {
      const sidebar = document.getElementById("sidebar");
      const overlay = document.querySelector(".mobile-overlay");
      sidebar?.classList.toggle("mobile-open");
      overlay?.classList.toggle("active");
    } else {
      document.body.classList.toggle("sidebar-collapsed");
    }
  }

  function _closeMobileSidebar() {
    document.getElementById("sidebar")?.classList.remove("mobile-open");
    document.querySelector(".mobile-overlay")?.classList.remove("active");
  }

  return { init, navigate, refresh, getCurrentPhase };
})();
