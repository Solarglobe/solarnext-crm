/**
 * keyboard.js — Raccourcis clavier globaux
 * Dépend de: navigation.js, app.js (chargé après)
 * Init: appelé par App.init()
 */

const Keyboard = (() => {

  function init() {
    document.addEventListener("keydown", _onKeyDown);
  }

  function _onKeyDown(e) {
    // Ignorer si focus dans un input / textarea
    const tag = document.activeElement?.tagName?.toLowerCase();
    const inInput = (tag === "input" || tag === "textarea" || tag === "select");

    // Escape — fermer modale ou retour overview
    if (e.key === "Escape") {
      // La fermeture modale est gérée par app.js
      return;
    }

    // "/" — focus recherche
    if (e.key === "/" && !inInput) {
      e.preventDefault();
      const si = document.getElementById("search-input");
      si?.focus();
      si?.select();
      return;
    }

    // "R" — reset filtres (hors input)
    if ((e.key === "r" || e.key === "R") && !inInput && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      Filters.reset();
      showToast("🔄 Filtres réinitialisés");
      return;
    }

    // "ArrowLeft" / "ArrowRight" — phase précédente / suivante (hors input)
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !inInput) {
      e.preventDefault();
      _navigatePhase(e.key === "ArrowLeft" ? -1 : 1);
      return;
    }

    // "Home" — retour vue d'ensemble
    if (e.key === "Home" && !inInput) {
      e.preventDefault();
      Navigation.navigate("all");
      return;
    }
  }

  function _navigatePhase(direction) {
    const current = Navigation.getCurrentPhase();

    if (!current) {
      // Sur l'overview : naviguer vers première/dernière phase
      const target = direction > 0 ? PHASES[0] : PHASES[PHASES.length - 1];
      if (target) Navigation.navigate(target.id);
      return;
    }

    const idx = PHASES.findIndex(p => p.id === current);
    if (idx === -1) return;

    const nextIdx = idx + direction;
    if (nextIdx < 0) {
      Navigation.navigate("all");
    } else if (nextIdx >= PHASES.length) {
      Navigation.navigate("all");
    } else {
      Navigation.navigate(PHASES[nextIdx].id);
    }
  }

  return { init };
})();
