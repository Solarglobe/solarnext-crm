// Extracted from dp2.js. Loaded after dp2.js and before initDP2 is called.
// DP2 — SCALE (METERS PER PIXEL)
// --------------------------
function lockDP2Scale() {
  // ⚠️ Si scale_m_per_px est déjà défini, ne pas l'écraser (immutable)
  if (window.DP2_STATE?.scale_m_per_px != null) {
    console.log("[DP2] Échelle déjà verrouillée :", window.DP2_STATE.scale_m_per_px, "m / px");
    return;
  }

  const planCapLock =
    typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
  if (!window.DP2_STATE || !planCapLock) {
    console.warn("[DP2] Impossible de verrouiller l'échelle : capture plan absente");
    return;
  }

  const scale = planCapLock.resolution;

  if (typeof scale !== "number" || scale <= 0) {
    console.warn("[DP2] Échelle invalide :", scale);
    return;
  }

  window.DP2_STATE.scale_m_per_px = scale;

  console.log("[DP2] Échelle verrouillée :", scale, "m / px");
}

// --------------------------
// DP2 — MVT : compteur chargement tuiles + attente idle
// --------------------------
let dp2MvtTilesLoadingCount = 0;
let dp2MvtFeatureLogged = false;

// --------------------------
// DP2 — WFS OFFICIEL (plan DP vectoriel propre)
// --------------------------
const DP2_OFFICIAL_WFS_BASE_URL = "https://data.geopf.fr/wfs";
const DP2_OFFICIAL_CADASTRE_WFS_TYPENAME = "CADASTRALPARCELS.PARCELLAIRE_EXPRESS";
const DP2_OFFICIAL_WFS_TIMEOUT_MS = 9000;

function dp2AppendQueryParam(url, key, value) {
  if (!url || !key || value == null || value === "") return url;
  try {
    var u = new URL(url, window.location && window.location.href ? window.location.href : undefined);
    if (!u.searchParams.has(key)) u.searchParams.set(key, String(value));
    return u.toString();
  } catch (_) {
    var sep = String(url).indexOf("?") >= 0 ? "&" : "?";
    return String(url) + sep + encodeURIComponent(key) + "=" + encodeURIComponent(String(value));
  }
}

function dp2ResolveMapTilerStyleUrl() {
  var styleUrl = __snMapTilerStyleUrl();
  var key = __snMapTilerPublicKey();
  if (!styleUrl) return "";
  return key ? dp2AppendQueryParam(styleUrl, "key", key) : styleUrl;
}

async function dp2ApplyMapTilerStyle(map) {
  var styleUrl = dp2ResolveMapTilerStyleUrl();
  if (!styleUrl) {
    throw new Error("VITE_MAPTILER_STYLE_URL (ou __DP2_MAPTILER_STYLE_URL__) manquant.");
  }
  var olmsApply = window.olms && typeof window.olms.apply === "function" ? window.olms.apply : null;
  if (!olmsApply) {
    throw new Error("ol-mapbox-style indisponible (window.olms.apply).");
  }
  await olmsApply(map, styleUrl);
  console.log("[DP2 Map] MapTiler style applied");
}

function dp2CreateIgnPlanFallbackLayer(wmtsGridPM) {
  return new ol.layer.Tile({
    opacity: 1,
    transition: 0,
    preload: 2,
    zIndex: 0,
    source: new ol.source.WMTS({
      url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile",
      layer: "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2",
      matrixSet: "PM",
      format: "image/png",
      style: "normal",
      tileGrid: wmtsGridPM,
      wrapX: false,
      crossOrigin: "anonymous"
    })
  });
}

async function dp2ApplyMapTilerStyleOrFallback(map, wmtsGridPM) {
  try {
    await dp2ApplyMapTilerStyle(map);
    return {
      provider: "maptiler",
      fallbackLayer: null,
      error: null,
    };
  } catch (e) {
    var msg = e && e.message ? String(e.message) : String(e || "Erreur inconnue");
    console.warn("[DP2 Map] MapTiler indisponible, fallback PLAN IGN activé :", msg);
    var fallbackLayer = dp2CreateIgnPlanFallbackLayer(wmtsGridPM);
    map.addLayer(fallbackLayer);
    return {
      provider: "ign-plan-fallback",
      fallbackLayer,
      error: msg,
    };
  }
}

function dp2OfficialWfsParcelLabelText(feature) {
  const p = feature?.getProperties ? feature.getProperties() : {};
  // Afficher le "numéro de parcelle" si un attribut existe.
  // (On teste plusieurs clés pour être robuste selon les schémas WFS.)
  const candidates = [
    p.numero,
    p.NUMERO,
    p.parcelle,
    p.PARCELLE,
    p.id,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s) return s;
  }
  return "";
}

function dp2OfficialCadastreWfsParcelStyle(feature, resolution) {
  const label = dp2OfficialWfsParcelLabelText(feature);
  const pxStrokeWidth =
    resolution == null || !Number.isFinite(resolution) ? 0.85 : resolution < 1 ? 1 : 0.8;

  const base = new ol.style.Style({
    fill: new ol.style.Fill({ color: "rgba(0,0,0,0)" }), // remplissage transparent
    stroke: new ol.style.Stroke({
      color: "#2F80ED", // bleu attendu
      width: pxStrokeWidth, // 0.6 à 1px (objectif : fin)
      lineJoin: "round",
      lineCap: "round",
    }),
  });

  if (!label) return base;

  // Labels petits, gris foncé, discrets
  const showText =
    resolution == null || !Number.isFinite(resolution) ? true : resolution <= 2.2;
  if (!showText) return base;

  return [
    base,
    new ol.style.Style({
      geometry: function (feat) {
        // Réutiliser la même logique de centroïde que le rendu MVT.
        return dp2MvtCentroidPointForLabel(feat);
      },
      text: new ol.style.Text({
        text: label,
        font: dp2MvtParcelLabelFontCSS(resolution),
        fill: new ol.style.Fill({ color: "#374151" }), // gris foncé
        stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.55)", width: 1 }),
        overflow: true,
        textAlign: "center",
        textBaseline: "middle",
      }),
    }),
  ];
}

function dp2DirectMvtTestStyle() {
  return new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: "red",
      width: 2,
    }),
    fill: new ol.style.Fill({
      color: "rgba(255,0,0,0.1)",
    }),
  });
}

async function loadDp2OfficialCadastreWfsForPlan() {
  const pkg = window.DP2_MAP;
  if (!pkg || !pkg.map) return { ok: false, count: 0 };
  if (!pkg.dp2OfficialCadastreWfsSource || !pkg.dp2OfficialCadastreWfsLayer) {
    console.warn("[DP2 WFS] layer/source non initialisée");
    return { ok: false, count: 0 };
  }

  const map = pkg.map;
  const size = map.getSize ? map.getSize() : null;
  const view = map.getView ? map.getView() : null;
  if (!size || !Array.isArray(size) || size[0] <= 0 || size[1] <= 0 || !view) {
    return { ok: false, count: 0 };
  }

  // BBOX basée sur l’emprise actuelle de la vue DP2 (EPSG:3857 côté carte)
  const extent3857 = view.calculateExtent(size);
  const padPct = 0.03;
  const dx = (extent3857[2] - extent3857[0]) * padPct;
  const dy = (extent3857[3] - extent3857[1]) * padPct;
  const padded3857 = [
    extent3857[0] - dx,
    extent3857[1] - dy,
    extent3857[2] + dx,
    extent3857[3] + dy,
  ];

  // IMPORTANT:
  // En WFS 2.0, EPSG:4326 peut impliquer un ordre d'axes lat/lon selon serveur.
  // Pour éviter toute ambiguïté (cause de pertes de features selon zoom), on
  // interroge le WFS directement en EPSG:3857 avec la BBOX de la vue.
  const [minX, minY, maxX, maxY] = padded3857;

  const url = new URL(DP2_OFFICIAL_WFS_BASE_URL);
  url.searchParams.set("SERVICE", "WFS");
  url.searchParams.set("VERSION", "2.0.0");
  url.searchParams.set("REQUEST", "GetFeature");
  url.searchParams.set("TYPENAMES", DP2_OFFICIAL_CADASTRE_WFS_TYPENAME);
  url.searchParams.set("OUTPUTFORMAT", "application/json");
  url.searchParams.set("SRSNAME", "EPSG:3857");
  url.searchParams.set(
    "BBOX",
    `${minX},${minY},${maxX},${maxY}`
  );
  // Paramètre de volume (évite les requêtes infinies)
  url.searchParams.set("COUNT", "20000");

  console.log("[DP2 WFS] loading");
  console.log("[DP2 WFS] loading bbox", {
    bbox3857: padded3857,
    srsName: "EPSG:3857",
    timeoutMs: DP2_OFFICIAL_WFS_TIMEOUT_MS,
  });
  console.log("[DP2 WFS] request url", url.toString());

  const controller = new AbortController();
  const t = setTimeout(() => {
    try { controller.abort(); } catch (_) {}
  }, DP2_OFFICIAL_WFS_TIMEOUT_MS);

  try {
    const resp = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText || ""}`.trim());
    }

    const json = await resp.json();
    // Déterminer la projection d’entrée si WFS la fournit.
    // Fallback aligné sur la requête envoyée.
    let dataProjection = "EPSG:3857";
    const crsName = json?.crs?.properties?.name;
    if (typeof crsName === "string") {
      const m = /EPSG(?::|::)?(\d+)/i.exec(crsName);
      if (m && m[1]) dataProjection = "EPSG:" + m[1];
    }

    const rawFeatureCount = Array.isArray(json?.features) ? json.features.length : 0;
    console.log("[DP2 WFS] response", {
      rawFeatureCount,
      dataProjection,
      countParam: "20000",
    });

    const format = new ol.format.GeoJSON();
    const features = format.readFeatures(json, {
      dataProjection: dataProjection,
      featureProjection: "EPSG:3857",
    });

    pkg.dp2OfficialCadastreWfsSource.clear();
    pkg.dp2OfficialCadastreWfsSource.addFeatures(features);

    // Optionnel : forcer le style côté layer (si besoin)
    if (pkg.dp2OfficialCadastreWfsLayer && pkg.dp2OfficialCadastreWfsLayer.setStyle) {
      pkg.dp2OfficialCadastreWfsLayer.setStyle(dp2OfficialCadastreWfsParcelStyle);
    }

    console.log("[DP2 WFS] loaded " + features.length + " parcels");
    return { ok: true, count: features.length };
  } catch (err) {
    const msg = err && err.name === "AbortError" ? "timeout" : String(err?.message || err);
    console.error("[DP2 WFS] error", { message: msg, error: err });
    return { ok: false, count: 0 };
  } finally {
    clearTimeout(t);
  }
}

function ensureDp2OfficialCadastreWfsLayerAttachedForPdf(map, pkg) {
  if (!map || !pkg || !pkg.dp2OfficialCadastreWfsLayer) return false;
  try {
    const layers = map.getLayers && map.getLayers();
    const arr = layers && typeof layers.getArray === "function" ? layers.getArray() : [];
    if (arr && arr.indexOf(pkg.dp2OfficialCadastreWfsLayer) >= 0) return true;
    map.addLayer(pkg.dp2OfficialCadastreWfsLayer);
    return true;
  } catch (_) {
    return false;
  }
}

function loadImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image base64 non chargée"));
    img.src = dataUrl;
  });
}

async function collectDP2FinalPlanImageWithBaseImageDataUrl(baseDataUrl) {
  const overlayCanvas = document.getElementById("dp2-draw-canvas");
  if (!overlayCanvas || overlayCanvas.width <= 0 || overlayCanvas.height <= 0) return null;
  if (!baseDataUrl || typeof baseDataUrl !== "string") return null;

  if (typeof window.renderDP2FromState === "function") {
    try {
      window.renderDP2FromState();
    } catch (_) {}
  } else if (typeof renderDP2FromState === "function") {
    try {
      renderDP2FromState();
    } catch (_) {}
  }

  const imgEl = await loadImageDataUrl(baseDataUrl);

  const out = document.createElement("canvas");
  const w = imgEl.naturalWidth || overlayCanvas.width;
  const h = imgEl.naturalHeight || overlayCanvas.height;
  out.width = w;
  out.height = h;

  const ctx = out.getContext("2d");
  if (!ctx) return null;

  // 1) base plan DP propre (WFS)
  ctx.drawImage(imgEl, 0, 0, w, h);

  // 2) couches OpenLayers (bâti / annotations vectorielles)
  try {
    const map = window.DP2_MAP?.map;
    const mapEl = map && typeof map.getTargetElement === "function" ? map.getTargetElement() : null;
    if (map && mapEl && mapEl.isConnected) {
      const olCanvases = mapEl.querySelectorAll(".ol-layer canvas");
      olCanvases.forEach(function (c) {
        if (c.width > 0 && c.height > 0) {
          ctx.save();
          const opacity = c.parentNode.style.opacity;
          ctx.globalAlpha = opacity === "" ? 1 : Number(opacity);
          const transform = c.style.transform;
          if (transform) {
            const m = transform.match(/^matrix\\(([^\\(]*)\\)$/);
            if (m) {
              const matrix = m[1].split(",").map(Number);
              ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
            }
          }
          ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, w, h);
          ctx.restore();
        }
      });
    }
  } catch (_) {}

  // 3) canvas édition (mesures, poignées, etc.)
  ctx.drawImage(overlayCanvas, 0, 0, w, h);

  return out.toDataURL("image/png");
}

async function dp2CaptureOfficialWfsBaseImageForPdf() {
  const pkg = window.DP2_MAP;
  if (!pkg?.map) return null;

  const map = pkg.map;
  const mapEl = map.getTargetElement ? map.getTargetElement() : null;
  if (!mapEl) return null;

  const wPx = Math.max(1, Math.round(mapEl.clientWidth));
  const hPx = Math.max(1, Math.round(mapEl.clientHeight));

  // Sauvegarder la visibilité : on ne veut capturer que le fond "parcelles WFS"
  const oldMvtVisible = pkg.mvtTileLayer?.getVisible ? pkg.mvtTileLayer.getVisible() : false;
  const oldWfsVisible = pkg.dp2OfficialCadastreWfsLayer?.getVisible ? pkg.dp2OfficialCadastreWfsLayer.getVisible() : false;
  const oldParcelVectorVisible = pkg.parcelVectorLayer?.getVisible ? pkg.parcelVectorLayer.getVisible() : false;
  const oldBuildingVisible = pkg.dp2BuildingVectorLayer?.getVisible ? pkg.dp2BuildingVectorLayer.getVisible() : false;
  let attachedForPdf = false;

  try {
    attachedForPdf = ensureDp2OfficialCadastreWfsLayerAttachedForPdf(map, pkg);
    if (!attachedForPdf) return null;
    if (pkg.dp2OfficialCadastreWfsLayer?.setVisible) pkg.dp2OfficialCadastreWfsLayer.setVisible(true);
    if (pkg.mvtTileLayer?.setVisible) pkg.mvtTileLayer.setVisible(false);
    if (pkg.parcelVectorLayer?.setVisible) pkg.parcelVectorLayer.setVisible(false);
    if (pkg.dp2BuildingVectorLayer?.setVisible) pkg.dp2BuildingVectorLayer.setVisible(false);

    map.updateSize?.();
    map.renderSync?.();
    await new Promise((r) => requestAnimationFrame(() => r()));

    const canvas = document.createElement("canvas");
    canvas.width = wPx;
    canvas.height = hPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const canvases = mapEl.querySelectorAll(".ol-layer canvas");
    canvases.forEach((c) => {
      if (c.width > 0 && c.height > 0) {
        ctx.save();
        const opacity = c.parentNode.style.opacity;
        ctx.globalAlpha = opacity === "" ? 1 : Number(opacity);
        const transform = c.style.transform;
        if (transform) {
          const m = transform.match(/^matrix\\(([^\\(]*)\\)$/);
          if (m) {
            const matrix = m[1].split(",").map(Number);
            ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
          }
        }
        ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, wPx, hPx);
        ctx.restore();
      }
    });

    return canvas.toDataURL("image/png");
  } finally {
    try { if (pkg.dp2OfficialCadastreWfsLayer?.setVisible) pkg.dp2OfficialCadastreWfsLayer.setVisible(oldWfsVisible); } catch (_) {}
    try { if (pkg.mvtTileLayer?.setVisible) pkg.mvtTileLayer.setVisible(oldMvtVisible); } catch (_) {}
    try { if (pkg.parcelVectorLayer?.setVisible) pkg.parcelVectorLayer.setVisible(oldParcelVectorVisible); } catch (_) {}
    try { if (pkg.dp2BuildingVectorLayer?.setVisible) pkg.dp2BuildingVectorLayer.setVisible(oldBuildingVisible); } catch (_) {}
    try {
      if (attachedForPdf && pkg.dp2OfficialCadastreWfsLayer && map?.removeLayer) {
        map.removeLayer(pkg.dp2OfficialCadastreWfsLayer);
      }
    } catch (_) {}
    try { map.updateSize?.(); map.renderSync?.(); } catch (_) {}
  }
}

function waitMvtTilesIdle(timeoutMs) {
  return new Promise((resolve) => {
    let resolved = false;
    const doResolve = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    const check = () => {
      if (dp2MvtTilesLoadingCount <= 0) {
        // Attendre un rendu avant de résoudre (2x rAF)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => doResolve());
        });
        return;
      }
      setTimeout(check, 50);
    };
    setTimeout(() => doResolve(), timeoutMs);
    check();
  });
}

// --------------------------
// DP2 — SOURCE MVT CADASTRE FRANCE (openmaptiles.data.gouv.fr, Etalab)
// Schéma TileJSON : layers parcelles (numero, section), batiments, sections. minzoom 11–16.
// Si CORS bloque, utiliser le proxy backend : DP_API_BASE + "/api/mvt/cadastre/{z}/{x}/{y}.pbf"
// --------------------------
const DP2_CADASTRE_MVT_URL = "https://openmaptiles.data.gouv.fr/data/cadastre/{z}/{x}/{y}.pbf";

// --------------------------
// DP2 — STYLE MVT CADASTRE (style bureau d’étude, 100 % côté client — pas de cadastre raster IGN violet)
// Bâtiments : non dessinés en MVT (le plan IGN les porte déjà).
// --------------------------
function dp2MvtParcelLabelText(feature) {
  const p = feature.getProperties ? feature.getProperties() : {};
  const n =
    p.numero != null && String(p.numero).trim()
      ? String(p.numero).trim()
      : p.NUMERO != null && String(p.NUMERO).trim()
        ? String(p.NUMERO).trim()
        : p.parcelle != null && String(p.parcelle).trim()
          ? String(p.parcelle).trim()
          : "";
  if (n) return n;
  // fallback : certains tiles encodent le numéro via d'autres clés (id, etc.)
  if (p.id != null && String(p.id).trim()) return String(p.id).trim();
  return "";
}

/** Aligne une parcelle MVT avec DP1_STATE.selectedParcel (évite doublon bleu sous la surcouche dorée). */
function dp2MvtFeatureMatchesSelectedParcel(feature) {
  const sel = window.DP1_STATE?.selectedParcel;
  if (!sel) return false;
  const fe = feature.getProperties ? feature.getProperties() : {};
  const fSec = String(fe.section != null ? fe.section : fe.SECTION != null ? fe.SECTION : "")
    .trim()
    .toUpperCase();
  const fNum = String(
    fe.numero != null ? fe.numero : fe.NUMERO != null ? fe.NUMERO : fe.parcelle != null ? fe.parcelle : ""
  ).trim();
  const sSec = String(sel.section != null ? sel.section : "")
    .trim()
    .toUpperCase();
  const sNum = String(sel.numero != null ? sel.numero : "").trim();
  if (fSec && sSec && fNum && sNum) {
    return fSec === sSec && fNum === sNum;
  }
  const parcelField = sel.parcel != null ? String(sel.parcel).trim() : "";
  const mvtLabel = dp2MvtParcelLabelText(feature);
  if (parcelField && mvtLabel) {
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    return norm(parcelField) === norm(mvtLabel);
  }
  return false;
}

/** Aire absolue (anneau fermé, coordonnées projetées). */
function dp2PolygonRingAbsArea(ring) {
  if (!ring || ring.length < 3) return 0;
  let n = ring.length;
  if (ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) n--;
  if (n < 3) return 0;
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    twice += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return Math.abs(twice / 2);
}

/** Centroïde 2D d’un anneau polygonal (formule classique, anneau extérieur). */
function dp2PolygonRingCentroidCoords(ring) {
  if (!ring || ring.length < 3) return null;
  let n = ring.length;
  if (ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) n--;
  if (n < 3) return null;
  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const cross = xi * yj - xj * yi;
    twice += cross;
    cx += (xi + xj) * cross;
    cy += (yi + yj) * cross;
  }
  if (Math.abs(twice) < 1e-30) return null;
  const factor = 1 / (3 * twice);
  return [cx * factor, cy * factor];
}

/** Point centroïde pour géométrie parcelle (Polygon / MultiPolygon). */
function dp2OlGeometryCentroidPoint(geom) {
  if (!geom || !geom.getType) return null;
  const typ = geom.getType();
  if (typ === "Polygon") {
    const coords = geom.getCoordinates();
    if (!coords || !coords[0]) return null;
    const c = dp2PolygonRingCentroidCoords(coords[0]);
    return c ? new ol.geom.Point(c) : null;
  }
  if (typ === "MultiPolygon") {
    const mp = geom.getCoordinates();
    if (!mp || !mp.length) return null;
    let bestA = -1;
    let best = null;
    for (let i = 0; i < mp.length; i++) {
      const outer = mp[i] && mp[i][0];
      if (!outer) continue;
      const c = dp2PolygonRingCentroidCoords(outer);
      if (!c) continue;
      const area = dp2PolygonRingAbsArea(outer);
      if (area > bestA) {
        bestA = area;
        best = c;
      }
    }
    return best ? new ol.geom.Point(best) : null;
  }
  return null;
}

function dp2MvtParcelLabelFontCSS(resolution) {
  // Libellé discret pour export PDF DP2 : petit, lisible, sans surcharge.
  let px = 9;
  if (resolution != null && Number.isFinite(resolution)) {
    if (resolution < 0.3) px = 10;
    else if (resolution < 1.5) px = 9;
    else px = 8;
  }
  return px + "px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
}

/** Libellé parcelle principale DP2 (plan cadastral propre) — 14–16px, graisse 600. */
function dp2ParcelPrimaryLabelFontCSS(resolution) {
  // Label principal de la parcelle sélectionnée : discret + gris foncé.
  let px = 10;
  if (resolution != null && Number.isFinite(resolution)) {
    if (resolution < 0.3) px = 11;
    else if (resolution > 2.5) px = 9;
  }
  return px + "px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
}

function dp2MvtCentroidPointForLabel(feature) {
  const g = feature.getGeometry && feature.getGeometry();
  return dp2OlGeometryCentroidPoint(g);
}

function styleCadastreMVT(feature, resolution) {
  const layer = feature.get("layer");
  const type = feature.get("type");
  const kind = feature.get("kind");
  const nature = feature.get("nature");

  const isParcelle =
    layer === "parcelles" ||
    type === "parcelle" ||
    kind === "parcel" ||
    nature === "parcelle";
  const isBatiment =
    layer === "batiments" || type === "building" || kind === "building" || nature === "batiment";
  // Pour DP2 : on ne dessine pas les labels/segments "sections" (parasites visuels).
  const isSection = layer === "sections";

  const pxStrokeWidth = (() => {
    // Exigence : épaisseur 0.5 à 1px.
    if (resolution == null || !Number.isFinite(resolution)) return 0.8;
    return resolution < 1 ? 1 : 0.75;
  })();

  if (isSection) return null;

  if (isBatiment) {
    return new ol.style.Style({
      fill: new ol.style.Fill({ color: "rgba(229, 231, 235, 0.55)" }), // gris très clair
      stroke: new ol.style.Stroke({
        color: "rgba(209, 213, 219, 0.95)",
        width: 0.6,
        lineJoin: "round",
      }),
    });
  }

  if (isParcelle) {
    // Déduplication : la parcelle sélectionnée est gérée par la surcouche vectorielle DP1 (en haut).
    if (dp2MvtFeatureMatchesSelectedParcel(feature)) return null;

    const label = dp2MvtParcelLabelText(feature);

    const base = new ol.style.Style({
      fill: new ol.style.Fill({ color: "rgba(0, 0, 0, 0)" }), // remplissage transparent
      stroke: new ol.style.Stroke({
        color: "#2F80ED", // bleu attendu Solteo
        width: pxStrokeWidth,
        lineJoin: "round",
        lineCap: "round",
      }),
    });

    // Label uniquement sur zoom "administratif" (évite l'encombrement).
    // resolution décroît avec le zoom : seuil à ajuster si besoin.
    const showText =
      label && (resolution == null || !Number.isFinite(resolution) ? true : resolution <= 2.2);

    if (!showText) return base;

    return [
      base,
      new ol.style.Style({
        geometry: function (feat) {
          return dp2MvtCentroidPointForLabel(feat);
        },
        text: new ol.style.Text({
          text: label,
          font: dp2MvtParcelLabelFontCSS(resolution),
          fill: new ol.style.Fill({ color: "#374151" }),
          // halo ultra léger : améliore la lisibilité sans "surnommer" les labels
          stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.55)", width: 1 }),
          overflow: true,
          textAlign: "center",
          textBaseline: "middle",
        }),
      }),
    ];
  }

  // Rien d'autre : masque routes secondaires, ombres et labels parasites.
  return null;
}

// Attente tuiles WMTS (fond plan IGN DP2) — même principe que DP1 waitTilesIdle.
async function dp2WaitWmtsSourcesIdle(map, wmtsSources, timeoutMs) {
  const sources = (wmtsSources || []).filter(Boolean);
  if (!map || !sources.length) return;
  let pending = 0;
  let resolved = false;
  const cleanupFns = [];
  function finish(resolve) {
    if (resolved) return;
    resolved = true;
    cleanupFns.forEach((fn) => {
      try {
        fn();
      } catch (_) {}
    });
    resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(resolve), timeoutMs != null ? timeoutMs : 2800);
    sources.forEach((src) => {
      const onStart = function () {
        pending++;
      };
      const onEnd = function () {
        pending = Math.max(0, pending - 1);
        if (pending === 0) {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              clearTimeout(timer);
              finish(resolve);
            })
          );
        }
      };
      src.on("tileloadstart", onStart);
      src.on("tileloadend", onEnd);
      src.on("tileloaderror", onEnd);
      cleanupFns.push(() => src.un("tileloadstart", onStart));
      cleanupFns.push(() => src.un("tileloadend", onEnd));
      cleanupFns.push(() => src.un("tileloaderror", onEnd));
    });
    try {
      map.renderSync();
    } catch (_) {}
    requestAnimationFrame(() => {
      if (pending === 0) {
        clearTimeout(timer);
        finish(resolve);
      }
    });
  });
}

function dp2GetWmtsLayerId(source) {
  if (!source || typeof source.getLayer !== "function") return "";
  try {
    return String(source.getLayer() || "");
  } catch (_) {
    return "";
  }
}

/** DP2 : retire le cadastre parcelles raster IGN (CADASTRALPARCELS) si présent. Fond attendu : PLAN IGN V2 ; parcelle active = vectoriel. */
function dp2SanitizeDp2BaseLayers(map) {
  if (!map || !map.getLayers) return;
  map
    .getLayers()
    .getArray()
    .slice()
    .forEach((layer) => {
      const src = layer.getSource && layer.getSource();
      if (!src) return;
      const lid = dp2GetWmtsLayerId(src);
      let urlStr = "";
      if (typeof src.getUrls === "function") {
        const u = src.getUrls();
        urlStr = u && u[0] != null ? String(u[0]) : "";
      } else if (typeof src.getUrl === "function") {
        urlStr = String(src.getUrl() || "");
      }
      const badCadUrl = urlStr.indexOf("CADASTRALPARCELS") >= 0;
      const badCadLayer = lid.indexOf("CADASTRALPARCELS") >= 0;
      if (badCadUrl || badCadLayer) {
        map.removeLayer(layer);
        console.warn("[DP2] Couche IGN retirée (cadastre raster CADASTRALPARCELS — doublon avec fond plan IGN DP2)");
      }
    });
}

function dp2LogDp2LayerAudit(map) {
  if (!map || !map.getLayers) return;
  try {
    const parts = [];
    map.getLayers().forEach((lyr, i) => {
      const s = lyr.getSource && lyr.getSource();
      const lid = dp2GetWmtsLayerId(s);
      parts.push("[" + i + "] " + (lid || (lyr.constructor && lyr.constructor.name) || "layer"));
    });
    console.info("[DP2] Audit couches carte :", parts.join(" ; "));
  } catch (_) {}
}

// Forcer un premier rendu utile des couches WMTS à l'ouverture des modals DP2/DP4 (évite écran gris jusqu'au micro zoom).
function forceFirstPaintWMTS(map, wmtsSource, wmtsResolutions) {
  try {
    if (!map || !map.getView) return;
    const v = map.getView();
    if (!v) return;

    // 1) resize + render sync (cas modal)
    try { map.updateSize(); } catch (_) {}
    try { map.renderSync(); } catch (_) {}

    // 2) Jiggle resolution (équivalent micro zoom/dézoom, SANS changer le cadrage final)
    const resList = Array.isArray(wmtsResolutions) ? wmtsResolutions : null;
    const cur = v.getResolution ? v.getResolution() : null;
    if (resList && cur) {
      let idx = resList.indexOf(cur);
      if (idx < 0) {
        // si cur n'est pas exactement dans la liste, trouver le plus proche
        let bestI = 0, bestD = Math.abs(resList[0] - cur);
        for (let i = 1; i < resList.length; i++) {
          const d = Math.abs(resList[i] - cur);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        idx = bestI;
      }
      const altIdx = (idx > 0) ? (idx - 1) : Math.min(1, resList.length - 1);
      const alt = resList[altIdx];

      if (alt && alt !== cur && v.setResolution) {
        v.setResolution(alt);
        try { map.renderSync(); } catch (_) {}
        v.setResolution(cur);
        try { map.renderSync(); } catch (_) {}
      }
    }

    // 3) Dernier safety render après un tick
    requestAnimationFrame(() => {
      try { map.updateSize(); } catch (_) {}
      try { map.renderSync(); } catch (_) {}
    });

    setTimeout(() => {
      try { map.updateSize(); } catch (_) {}
      try { map.renderSync(); } catch (_) {}
    }, 150);

  } catch (_) {}
}

// --------------------------
