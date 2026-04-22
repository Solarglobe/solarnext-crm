/**
 * Enregistrement du versioning DP1–DP8 + UI compacte (menu document).
 * Chargé après dp-app.js (utilise dp4DefaultState, etc.).
 */
(function (global) {
  var V = global.snDpV;
  if (!V || typeof V.register !== "function") {
    console.warn("[dp-versions-register] snDpV absent — versioning DP1–DP8 inactif");
    return;
  }

  if (!global.__snDpVDocMenuRefresh) global.__snDpVDocMenuRefresh = {};

  function dp3DefaultEmpty() {
    return {
      hasDP3: false,
      typeKey: null,
      poseType: null,
      baseImage: null,
      installationOrientation: "portrait",
      module: null,
      manualImageName: null,
      textBoxes: [],
      validatedAt: null,
    };
  }

  function dp5DefaultEmpty() {
    return {};
  }

  function dp6DefaultEmpty() {
    return {
      category: null,
      selectionUIMode: "draw",
      activePatchIndex: null,
      patches: [],
      sourceImage: "",
      beforeImage: "",
      afterImage: "",
      selection: null,
      module: null,
      layout: { orientation: "PORTRAIT" },
    };
  }

  function dp7DefaultEmpty() {
    return {
      mode: "EDITION",
      backgroundImage: null,
      finalImage: null,
      arrows: [],
    };
  }

  function dp8DefaultEmpty() {
    return dp7DefaultEmpty();
  }

  function previewFromDataUrl(s) {
    if (typeof s !== "string" || s.indexOf("data:image") !== 0) return null;
    return s.length > 120000 ? s.slice(0, 120000) : s;
  }

  function dp1DefaultEmpty() {
    return {
      currentMode: "strict",
      isValidated: false,
      selectedParcel: null,
      lastCentroid: null,
      currentPoint: null,
      dp1SnapshotImages: {},
    };
  }

  V.register("dp1", {
    stateGlobal: "DP1_STATE",
    versionsKey: "dp1Versions",
    activeKey: "dp1ActiveVersionId",
    prefix: "dp1",
    defaultEmpty: dp1DefaultEmpty,
    hasContent: function (w) {
      if (!w) return false;
      if (w.isValidated) return true;
      if (w.selectedParcel && typeof w.selectedParcel === "object") {
        var p = w.selectedParcel;
        if (p.section || p.numero != null || p.parcel || p.parcelle) return true;
      }
      if (w.lastCentroid) return true;
      if (w.currentPoint) return true;
      var im = w.dp1SnapshotImages;
      if (im && typeof im === "object" && (im.view_20000 || im.view_5000 || im.view_650)) return true;
      return false;
    },
    isValidated: function (s) {
      return !!s.isValidated;
    },
    collectPreview: function () {
      return null;
    },
  });

  V.register("dp3", {
    stateGlobal: "DP3_STATE",
    versionsKey: "dp3Versions",
    activeKey: "dp3ActiveVersionId",
    prefix: "dp3",
    defaultEmpty: dp3DefaultEmpty,
    hasContent: function (w) {
      if (!w) return false;
      return !!(w.hasDP3 || w.baseImage || w.validatedAt || (w.textBoxes && w.textBoxes.length));
    },
    isValidated: function (s) {
      return !!s.validatedAt;
    },
    collectPreview: function (s) {
      var b = s.baseImage;
      return previewFromDataUrl(b) || null;
    },
  });

  V.register("dp4", {
    stateGlobal: "DP4_STATE",
    versionsKey: "dp4Versions",
    activeKey: "dp4ActiveVersionId",
    prefix: "dp4",
    defaultEmpty: function () {
      return typeof global.dp4DefaultState === "function" ? global.dp4DefaultState() : {};
    },
    hasContent: function (w) {
      if (!w) return false;
      if (w.photoCategory) return true;
      if (w.roofType) return true;
      if (w.capture && w.capture.imageBase64) return true;
      if (w.plans && (w.plans.before || w.plans.after)) return true;
      var b = w.before;
      var a = w.after;
      function hasDraw(x) {
        return (
          x &&
          ((x.roofGeometry && x.roofGeometry.length) ||
            (x.panels && x.panels.length) ||
            (x.textObjects && x.textObjects.length) ||
            (x.businessObjects && x.businessObjects.length))
        );
      }
      return hasDraw(b) || hasDraw(a);
    },
    isValidated: function (s) {
      return !!(s.capture && s.capture.imageBase64);
    },
    collectPreview: function (s) {
      var c = s.capture && s.capture.imageBase64;
      return previewFromDataUrl(c) || null;
    },
  });

  V.register("dp5", {
    stateGlobal: "DP5_STATE",
    versionsKey: "dp5Versions",
    activeKey: "dp5ActiveVersionId",
    prefix: "dp5",
    defaultEmpty: dp5DefaultEmpty,
    hasContent: function (w) {
      if (!w || typeof w !== "object") return false;
      return Object.keys(w).some(function (k) {
        return k !== "dp5Versions" && k !== "dp5ActiveVersionId";
      });
    },
    isValidated: function () {
      return false;
    },
    collectPreview: function () {
      return null;
    },
  });

  V.register("dp6", {
    stateGlobal: "DP6_STATE",
    versionsKey: "dp6Versions",
    activeKey: "dp6ActiveVersionId",
    prefix: "dp6",
    defaultEmpty: dp6DefaultEmpty,
    hasContent: function (w) {
      if (!w) return false;
      if (w.sourceImage || w.beforeImage || w.afterImage) return true;
      if (Array.isArray(w.patches) && w.patches.length) return true;
      return false;
    },
    isValidated: function (s) {
      return !!(s.afterImage && String(s.afterImage).indexOf("data:image") === 0);
    },
    collectPreview: function (s) {
      return previewFromDataUrl(s.afterImage || s.beforeImage || s.sourceImage) || null;
    },
  });

  V.register("dp7", {
    stateGlobal: "DP7_STATE",
    versionsKey: "dp7Versions",
    activeKey: "dp7ActiveVersionId",
    prefix: "dp7",
    defaultEmpty: dp7DefaultEmpty,
    hasContent: function (w) {
      if (!w) return false;
      if (w.finalImage || w.backgroundImage) return true;
      if (Array.isArray(w.arrows) && w.arrows.length) return true;
      return false;
    },
    isValidated: function (s) {
      return !!(s.finalImage && String(s.finalImage).indexOf("data:image") === 0);
    },
    collectPreview: function (s) {
      return previewFromDataUrl(s.finalImage || s.backgroundImage) || null;
    },
  });

  V.register("dp8", {
    stateGlobal: "DP8_STATE",
    versionsKey: "dp8Versions",
    activeKey: "dp8ActiveVersionId",
    prefix: "dp8",
    defaultEmpty: dp8DefaultEmpty,
    hasContent: function (w) {
      if (!w) return false;
      if (w.finalImage || w.backgroundImage) return true;
      if (Array.isArray(w.arrows) && w.arrows.length) return true;
      return false;
    },
    isValidated: function (s) {
      return !!(s.finalImage && String(s.finalImage).indexOf("data:image") === 0);
    },
    collectPreview: function (s) {
      return previewFromDataUrl(s.finalImage || s.backgroundImage) || null;
    },
  });

  function shortDateFr(iso) {
    if (!iso || typeof iso !== "string") return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  }

  function statusLabel(v, activeId) {
    if (!v) return "Brouillon";
    if (v.isValidated) return "Validée";
    if (v.id === activeId) return "En cours";
    return "Brouillon";
  }

  function isMenuOpen(root) {
    return root && root.dataset.snDpVMenuOpen === "1";
  }

  /**
   * @param {{
   *   getVersions: function(): array,
   *   getActiveId: function(): string|null,
   *   versionStatus: function(v, activeId): string,
   *   onSelectVersion: function(vid): void,
   *   onNew: function(): void,
   *   onDup: function(): void,
   *   onDel: function(): void,
   * }} handlers
   */
  function renderDocVersionFace(kind, root, menuEl, labelEl, triggerEl, handlers) {
    var versions = handlers.getVersions() || [];
    var active = handlers.getActiveId();

    var activeIdx = -1;
    for (var ix = 0; ix < versions.length; ix++) {
      if (versions[ix] && versions[ix].id === active) {
        activeIdx = ix;
        break;
      }
    }
    var n = activeIdx >= 0 ? activeIdx + 1 : 1;
    var activeV = activeIdx >= 0 ? versions[activeIdx] : null;
    var stText = handlers.versionStatus(activeV, active);
    if (labelEl) {
      labelEl.textContent = "Version " + n + " (" + stText + ")";
    }

    if (triggerEl) {
      triggerEl.setAttribute("aria-expanded", isMenuOpen(root) ? "true" : "false");
    }

    if (!menuEl) return;

    while (menuEl.firstChild) {
      menuEl.removeChild(menuEl.firstChild);
    }

    for (var j = versions.length - 1; j >= 0; j--) {
      var v = versions[j];
      if (!v || !v.id) continue;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      btn.className = "dp-doc-version__item";
      if (v.id === active) {
        btn.className += " dp-doc-version__item--active";
      }
      btn.setAttribute("data-vid", v.id);
      var line = "Version " + (j + 1) + " — " + handlers.versionStatus(v, active);
      var dd = shortDateFr(v.createdAt);
      if (dd) line += " · " + dd;
      btn.textContent = line;
      menuEl.appendChild(btn);
    }

    var sep = document.createElement("div");
    sep.className = "dp-doc-version__sep";
    sep.setAttribute("role", "separator");
    menuEl.appendChild(sep);

    var bNew = document.createElement("button");
    bNew.type = "button";
    bNew.setAttribute("role", "menuitem");
    bNew.className = "dp-doc-version__action";
    bNew.setAttribute("data-action", "new");
    bNew.textContent = "Nouvelle version";
    menuEl.appendChild(bNew);

    var bDup = document.createElement("button");
    bDup.type = "button";
    bDup.setAttribute("role", "menuitem");
    bDup.className = "dp-doc-version__action";
    bDup.setAttribute("data-action", "dup");
    bDup.textContent = "Dupliquer";
    menuEl.appendChild(bDup);

    var bDel = document.createElement("button");
    bDel.type = "button";
    bDel.setAttribute("role", "menuitem");
    bDel.className = "dp-doc-version__action dp-doc-version__action--danger";
    bDel.setAttribute("data-action", "del");
    bDel.textContent = "Supprimer";
    menuEl.appendChild(bDel);
  }

  /**
   * @param {string} kind
   * @param {*} handlers
   * @param {{ onAfter?: function(kind):void }} [cfg]
   */
  function mountDocVersionUi(kind, handlers, cfg) {
    cfg = cfg || {};

    var root = document.getElementById(kind + "-doc-version");
    var trigger = document.getElementById(kind + "-doc-version-trigger");
    var label = document.getElementById(kind + "-doc-version-label");
    var menu = document.getElementById(kind + "-doc-version-menu");
    if (!root || !trigger || !label || !menu) return;

    function setOpen(on) {
      root.dataset.snDpVMenuOpen = on ? "1" : "0";
      menu.hidden = !on;
      trigger.setAttribute("aria-expanded", on ? "true" : "false");
    }

    function onDocPointer(e) {
      if (!isMenuOpen(root)) return;
      if (root.contains(e.target)) return;
      setOpen(false);
      renderDocVersionFace(kind, root, menu, label, trigger, handlers);
    }

    function onKey(e) {
      if (e.key === "Escape" && isMenuOpen(root)) {
        setOpen(false);
        renderDocVersionFace(kind, root, menu, label, trigger, handlers);
      }
    }

    function fullRefresh() {
      renderDocVersionFace(kind, root, menu, label, trigger, handlers);
      if (typeof cfg.onAfter === "function") {
        try {
          cfg.onAfter(kind);
        } catch (e0) {}
      }
      try {
        if (typeof global.__snDpPersistDebounced === "function") global.__snDpPersistDebounced("fast");
      } catch (_) {}
    }

    /** Re-render menu from current state (no extra persist). Use after external mutations (e.g. delete). */
    global.__snDpVDocMenuRefresh[kind] = function refreshDocVersionMenuOnly() {
      try {
        setOpen(false);
        renderDocVersionFace(kind, root, menu, label, trigger, handlers);
        if (typeof cfg.onAfter === "function") {
          try {
            cfg.onAfter(kind);
          } catch (e0) {}
        }
      } catch (e) {
        console.warn("[doc-version] menu refresh", kind, e);
      }
    };

    if (root.dataset.snDpVDocUiInit !== "1") {
      root.dataset.snDpVDocUiInit = "1";

      trigger.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(!isMenuOpen(root));
        renderDocVersionFace(kind, root, menu, label, trigger, handlers);
      });

      menu.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var item = t.closest("[data-vid]");
        if (item && item.getAttribute("data-vid")) {
          e.preventDefault();
          var vid = item.getAttribute("data-vid");
          setOpen(false);
          try {
            handlers.onSelectVersion(vid);
          } catch (err) {
            console.warn("[doc-version] select", kind, err);
          }
          fullRefresh();
          return;
        }
        var act = t.closest("[data-action]");
        if (!act) return;
        e.preventDefault();
        var action = act.getAttribute("data-action");
        setOpen(false);
        try {
          if (action === "new") handlers.onNew();
          else if (action === "del") handlers.onDel();
          else if (action === "dup") handlers.onDup();
        } catch (err2) {
          console.warn("[doc-version]", kind, err2);
        }
        fullRefresh();
      });

      document.addEventListener("pointerdown", onDocPointer, true);
      document.addEventListener("keydown", onKey, true);
    }

    setOpen(false);
    fullRefresh();
  }

  /**
   * @param {string} kind — dp1, dp2, dp3 … dp8
   * @param {{ onAfter?: function(kind):void }} [cfg]
   */
  global.snDpVSetupPageUi = function (kind, cfg) {
    cfg = cfg || {};

    if (kind === "dp2") {
      mountDocVersionUi(
        "dp2",
        {
          getVersions: function () {
            return typeof global.dp2EnsureVersionsArray === "function" ? global.dp2EnsureVersionsArray() : [];
          },
          getActiveId: function () {
            return global.DP2_STATE ? global.DP2_STATE.dp2ActiveVersionId : null;
          },
          versionStatus: function (v, activeId) {
            if (typeof global.dp2VersionStatusForDocMenu === "function") {
              return global.dp2VersionStatusForDocMenu(v, activeId);
            }
            if (!v) return "Brouillon";
            var sj = v.state_json;
            if (sj && sj.capture && sj.capture.imageBase64) return "Validée";
            if (v.id === activeId) return "En cours";
            return "Brouillon";
          },
          onSelectVersion: function (vid) {
            if (typeof global.dp2SetActiveVersion === "function") global.dp2SetActiveVersion(vid);
          },
          onNew: function () {
            if (typeof global.dp2OnEntryNewVersion === "function") {
              global.dp2OnEntryNewVersion({ preventDefault: function () {} });
            }
          },
          onDup: function () {
            if (typeof global.dp2DuplicateActiveVersion === "function") global.dp2DuplicateActiveVersion();
          },
          onDel: function () {
            if (typeof global.dp2OnEntryDeleteVersion === "function") {
              global.dp2OnEntryDeleteVersion({ preventDefault: function () {} });
            }
          },
        },
        cfg
      );
      return;
    }

    var o = V.getOpts(kind);
    if (!o) return;

    mountDocVersionUi(
      kind,
      {
        getVersions: function () {
          var st = global[o.stateGlobal];
          return (st && st[o.versionsKey]) || [];
        },
        getActiveId: function () {
          var st = global[o.stateGlobal];
          return st ? st[o.activeKey] : null;
        },
        versionStatus: statusLabel,
        onSelectVersion: function (vid) {
          var st = global[o.stateGlobal];
          if (!st) return;
          V.setActiveVersion(st, vid, o);
        },
        onNew: function () {
          var st = global[o.stateGlobal];
          if (!st) return;
          V.createNewVersion(st, o);
        },
        onDup: function () {
          var st = global[o.stateGlobal];
          if (!st) return;
          var id = st[o.activeKey];
          if (id) V.duplicateVersion(st, id, o);
        },
        onDel: function () {
          var st = global[o.stateGlobal];
          if (!st) return;
          var idDel = st[o.activeKey];
          if (idDel) V.deleteVersion(st, idDel, o);
        },
      },
      cfg
    );
  };

  if (typeof global.snDpVRefreshDocVersionMenu !== "function") {
    global.snDpVRefreshDocVersionMenu = function (k) {
      var kk = k || "dp2";
      var fn = global.__snDpVDocMenuRefresh && global.__snDpVDocMenuRefresh[kk];
      if (typeof fn === "function") {
        try {
          fn();
        } catch (e) {
          console.warn("[snDpVRefreshDocVersionMenu]", kk, e);
        }
      }
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
