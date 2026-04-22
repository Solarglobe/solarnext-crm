/**
 * Versioning DP1 + DP3–DP8 — aligné sur le modèle DP2 (dp2Versions / dp2ActiveVersionId).
 * Chaque état runtime contient : champs métier à la racine + dpNVersions + dpNActiveVersionId.
 * Les entrées de version : { id, createdAt, updatedAt, state_json, preview_image, isValidated }.
 */
(function (global) {
  function uuid(prefix) {
    return (prefix || "v") + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  function excludeVersionKeys(state, versionsKey, activeKey) {
    try {
      var raw = JSON.parse(JSON.stringify(state || {}));
      delete raw[versionsKey];
      delete raw[activeKey];
      Object.keys(raw).forEach(function (k) {
        if (k.indexOf("_") === 0) delete raw[k];
      });
      return raw;
    } catch (e) {
      return {};
    }
  }

  function ensureVersionsArray(state, versionsKey) {
    if (!Array.isArray(state[versionsKey])) state[versionsKey] = [];
    return state[versionsKey];
  }

  function findVersionIndex(versions, id) {
    if (!id) return -1;
    return versions.findIndex(function (v) {
      return v && v.id === id;
    });
  }

  /**
   * @param {object} state
   * @param {{ versionsKey: string, activeKey: string, prefix?: string, hasContent?: function(object):boolean, defaultEmpty: function():object, isValidated?: function(object):boolean, collectPreview?: function(object): string|null }} opts
   */
  function migrate(state, opts) {
    if (!state || typeof state !== "object" || !opts.versionsKey || !opts.activeKey) return;
    var vk = opts.versionsKey;
    var ak = opts.activeKey;
    var versions = state[vk];
    if (Array.isArray(versions) && versions.length > 0) return;

    var working = excludeVersionKeys(state, vk, ak);
    var hasLegacy = typeof opts.hasContent === "function" ? opts.hasContent(working) : false;
    if (!hasLegacy) {
      var empty = opts.defaultEmpty();
      Object.keys(state).forEach(function (k) {
        if (k !== vk && k !== ak) {
          try {
            delete state[k];
          } catch (_) {
            state[k] = undefined;
          }
        }
      });
      Object.assign(state, empty);
      working = excludeVersionKeys(state, vk, ak);
    }

    var id = uuid(opts.prefix || "v");
    var now = new Date().toISOString();
    var prev = typeof opts.isValidated === "function" ? opts.isValidated(state) : false;
    var preview = typeof opts.collectPreview === "function" ? opts.collectPreview(state) : null;

    state[vk] = [
      {
        id: id,
        createdAt: now,
        updatedAt: now,
        state_json: working,
        preview_image: preview,
        isValidated: !!prev,
      },
    ];
    state[ak] = id;
  }

  function applyStateJson(state, json, versionsKey, activeKey, versionsArr, activeId) {
    if (!json || typeof json !== "object") json = {};
    var copy = {};
    try {
      copy = JSON.parse(JSON.stringify(json));
    } catch (_) {
      copy = {};
    }
    Object.keys(state).forEach(function (k) {
      if (k !== versionsKey && k !== activeKey) {
        try {
          delete state[k];
        } catch (_) {
          state[k] = undefined;
        }
      }
    });
    Object.assign(state, copy);
    state[versionsKey] = versionsArr;
    state[activeKey] = activeId;
  }

  function syncActiveBeforeDraft(state, opts) {
    if (!state || typeof state !== "object" || !opts.versionsKey || !opts.activeKey) return;
    var versions = ensureVersionsArray(state, opts.versionsKey);
    var id = state[opts.activeKey];
    if (!id && versions.length) {
      id = versions[versions.length - 1].id;
      state[opts.activeKey] = id;
    }
    if (!id) return;
    var idx = findVersionIndex(versions, id);
    if (idx < 0) return;
    var sj = excludeVersionKeys(state, opts.versionsKey, opts.activeKey);
    var prev = versions[idx] || {};
    var preview = typeof opts.collectPreview === "function" ? opts.collectPreview(state) : null;
    var isVal = typeof opts.isValidated === "function" ? opts.isValidated(state) : false;
    versions[idx] = {
      id: prev.id || id,
      createdAt: prev.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state_json: sj,
      preview_image: preview != null ? preview : prev.preview_image != null ? prev.preview_image : null,
      isValidated: !!isVal,
    };
  }

  function createNewVersion(state, opts) {
    syncActiveBeforeDraft(state, opts);
    var versions = ensureVersionsArray(state, opts.versionsKey);
    var id = uuid(opts.prefix || "v");
    var now = new Date().toISOString();
    var empty = opts.defaultEmpty();
    versions.push({
      id: id,
      createdAt: now,
      updatedAt: now,
      state_json: excludeVersionKeys(empty, opts.versionsKey, opts.activeKey),
      preview_image: null,
      isValidated: false,
    });
    applyStateJson(state, empty, opts.versionsKey, opts.activeKey, versions, id);
  }

  function deleteVersion(state, vid, opts) {
    if (!global.confirm("Supprimer cette version ?")) return;
    syncActiveBeforeDraft(state, opts);
    var versions = ensureVersionsArray(state, opts.versionsKey);
    var idx = findVersionIndex(versions, vid);
    if (idx < 0) return;
    versions.splice(idx, 1);
    if (!versions.length) {
      var empty = opts.defaultEmpty();
      var id = uuid(opts.prefix || "v");
      var now = new Date().toISOString();
      var sj = excludeVersionKeys(empty, opts.versionsKey, opts.activeKey);
      versions.push({
        id: id,
        createdAt: now,
        updatedAt: now,
        state_json: sj,
        preview_image: null,
        isValidated: false,
      });
      applyStateJson(state, empty, opts.versionsKey, opts.activeKey, versions, id);
      return;
    }
    var last = versions[versions.length - 1];
    state[opts.activeKey] = last.id;
    var lastSj = last.state_json && typeof last.state_json === "object" ? last.state_json : opts.defaultEmpty();
    applyStateJson(state, lastSj, opts.versionsKey, opts.activeKey, versions, last.id);
  }

  function duplicateVersion(state, vid, opts) {
    syncActiveBeforeDraft(state, opts);
    var versions = ensureVersionsArray(state, opts.versionsKey);
    var src = versions.find(function (v) {
      return v && v.id === vid;
    });
    if (!src || !src.state_json) return;
    var id = uuid(opts.prefix || "v");
    var now = new Date().toISOString();
    var copyJson = {};
    try {
      copyJson = JSON.parse(JSON.stringify(src.state_json));
    } catch (_) {
      copyJson = opts.defaultEmpty();
    }
    versions.push({
      id: id,
      createdAt: now,
      updatedAt: now,
      state_json: copyJson,
      preview_image: src.preview_image || null,
      isValidated: false,
    });
    applyStateJson(state, copyJson, opts.versionsKey, opts.activeKey, versions, id);
  }

  function setActiveVersion(state, vid, opts) {
    syncActiveBeforeDraft(state, opts);
    var versions = ensureVersionsArray(state, opts.versionsKey);
    var v = versions.find(function (x) {
      return x && x.id === vid;
    });
    if (!v || !v.state_json) return;
    var sj = {};
    try {
      sj = JSON.parse(JSON.stringify(v.state_json));
    } catch (_) {
      sj = opts.defaultEmpty();
    }
    applyStateJson(state, sj, opts.versionsKey, opts.activeKey, versions, vid);
  }

  /** Enregistre les options par clé logique : "dp3" … "dp8" (sauf dp5 optionnel). */
  var REG = {};

  function register(kind, opts) {
    if (!kind || !opts) return;
    REG[kind] = opts;
  }

  function syncAllForDraft() {
    var order = ["dp1", "dp3", "dp4", "dp5", "dp6", "dp7", "dp8"];
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      var o = REG[k];
      if (!o || !o.stateGlobal) continue;
      var st = global[o.stateGlobal];
      if (!st || typeof st !== "object") continue;
      try {
        migrate(st, o);
        syncActiveBeforeDraft(st, o);
      } catch (e) {}
    }
  }

  function runAfterHydrate() {
    var order = ["dp1", "dp3", "dp4", "dp5", "dp6", "dp7", "dp8"];
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      var o = REG[k];
      if (!o || !o.stateGlobal) continue;
      var st = global[o.stateGlobal];
      if (!st || typeof st !== "object") continue;
      try {
        migrate(st, o);
      } catch (e) {}
    }
  }

  function migrateKind(kind) {
    var o = REG[kind];
    if (!o || !o.stateGlobal) return;
    var st = global[o.stateGlobal];
    if (st && typeof st === "object") migrate(st, o);
  }

  function getOpts(kind) {
    return REG[kind] || null;
  }

  global.snDpV = {
    uuid: uuid,
    excludeVersionKeys: excludeVersionKeys,
    migrate: migrate,
    syncActiveBeforeDraft: syncActiveBeforeDraft,
    applyStateJson: applyStateJson,
    createNewVersion: createNewVersion,
    deleteVersion: deleteVersion,
    duplicateVersion: duplicateVersion,
    setActiveVersion: setActiveVersion,
    register: register,
    syncAllForDraft: syncAllForDraft,
    runAfterHydrate: runAfterHydrate,
    migrateKind: migrateKind,
    getOpts: getOpts,
    _registry: REG,
  };
})(typeof window !== "undefined" ? window : globalThis);
