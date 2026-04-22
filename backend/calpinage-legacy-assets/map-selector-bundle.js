/**
 * Bundle exécutable pour l’étape 5.1 : carte Google Satellite + capture viewport.
 * Utilisé par calpinage.html. Clé API : à renseigner dans le <script> Google Maps (key=__GOOGLE_API_KEY__).
 */
(function (global) {
  "use strict";
  if (typeof window !== "undefined" && window.__CALPINAGE_DEBUG__) {
    console.log("[LeadMarker] bundle loaded from: calpinage/map-selector-bundle.js build:", new Date().toISOString());
  }

  var DEFAULT_CENTER = { lat: 48.8566, lng: 2.3522 };
  var DEFAULT_ZOOM = 19;
  var MIN_ZOOM = 5;
  var MAX_ZOOM = 21;

  var roofState = {
    map: null,
    image: null,
    scale: null,
    calibration: null,
    roof: { north: null },
  };

  function computeMetersPerPixelImage(params) {
    var samplePx = params.samplePx != null ? params.samplePx : 200;
    var rect = params.containerEl.getBoundingClientRect();
    var cssW = rect.width;
    var cssH = rect.height;
    var ratioX = params.imageWidthPx / cssW;
    var proj = params.overlay.getProjection();
    if (!proj || typeof proj.fromContainerPixelToLatLng !== "function") {
      throw new Error("Projection Google indisponible (OverlayView).");
    }
    var cx = cssW / 2;
    var cy = cssH / 2;
    var p1 = new google.maps.Point(cx - samplePx / 2, cy);
    var p2 = new google.maps.Point(cx + samplePx / 2, cy);
    var ll1 = proj.fromContainerPixelToLatLng(p1);
    var ll2 = proj.fromContainerPixelToLatLng(p2);
    if (!ll1 || !ll2) {
      throw new Error("Projection Google : fromContainerPixelToLatLng a retourné null.");
    }
    var meters = google.maps.geometry.spherical.computeDistanceBetween(ll1, ll2);
    var metersPerCssPx = meters / samplePx;
    var metersPerImagePx = metersPerCssPx / ratioX;
    return {
      metersPerPixelImage: metersPerImagePx,
      sampleMeters: meters,
      samplePx: samplePx,
    };
  }

  var MIN_PIXEL_DISTANCE = 5;

  function getPixelDistance(A, B) {
    return Math.hypot(B.x - A.x, B.y - A.y);
  }

  /** Si la calibration touche `CALPINAGE_STATE.roof`, resync du contrat monde (module CRM). */
  function trySyncCanonical3DWorldContractAfterRoofRefMutation(roofStateRef) {
    if (typeof global === "undefined") return;
    var w = global;
    var syncFn = w.__CALPINAGE_SYNC_CANONICAL3D_WORLD_CONTRACT__;
    if (typeof syncFn !== "function") return;
    var roof = w.CALPINAGE_STATE && w.CALPINAGE_STATE.roof;
    if (roof && roofStateRef === roof) syncFn();
  }

  function validateAndApplyCalibration(roofStateRef, A, B, meters) {
    if (meters <= 0) {
      return { ok: false, error: "La distance réelle doit être strictement positive (m)." };
    }
    var pixelDistance = getPixelDistance(A, B);
    if (pixelDistance < MIN_PIXEL_DISTANCE) {
      return { ok: false, error: "Les deux points sont trop proches. Choisissez une plus grande distance sur l'image." };
    }
    var metersPerPixel = meters / pixelDistance;
    roofStateRef.scale = { metersPerPixel: metersPerPixel };
    roofStateRef.calibration = { A: { x: A.x, y: A.y }, B: { x: B.x, y: B.y }, meters: meters };
    trySyncCanonical3DWorldContractAfterRoofRefMutation(roofStateRef);
    return { ok: true };
  }

  function getMetersFromPixels(roofStateRef, A, B) {
    if (!roofStateRef.scale) return null;
    var pixelDistance = getPixelDistance(A, B);
    return pixelDistance * roofStateRef.scale.metersPerPixel;
  }

  function getHeading(map) {
    if (typeof map.getHeading === "function") {
      return map.getHeading() || 0;
    }
    return 0;
  }

  /**
   * Normalise l'image capturée (flip vertical) pour corriger l'inversion
   * due aux transforms internes de Google Maps lors de la capture html2canvas.
   */
  function normalizeCapturedImage(sourceCanvas) {
    var w = sourceCanvas.width;
    var h = sourceCanvas.height;

    var fixedCanvas = document.createElement("canvas");
    fixedCanvas.width = w;
    fixedCanvas.height = h;

    var ctx = fixedCanvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");

    ctx.translate(0, h);
    ctx.scale(1, -1);

    ctx.drawImage(sourceCanvas, 0, 0, w, h);

    return {
      dataUrl: fixedCanvas.toDataURL("image/png"),
      width: w,
      height: h,
    };
  }

  function createPixelProjectionOverlay() {
    function PixelProjectionOverlay() {}
    PixelProjectionOverlay.prototype = new google.maps.OverlayView();
    PixelProjectionOverlay.prototype.onAdd = function () {};
    PixelProjectionOverlay.prototype.draw = function () {};
    PixelProjectionOverlay.prototype.onRemove = function () {};
    return new PixelProjectionOverlay();
  }

  /**
   * Google Map Provider — Interface MapProvider.
   * Heading : nord = 0°, sens horaire. Init/destroy propres, aucun listener après destroy.
   */
  function initGoogleMap(container) {
    if (typeof google === "undefined" || !google.maps) {
      throw new Error("Google Maps API non chargée. Vérifiez le script et la clé API.");
    }
    var mapInstance = new google.maps.Map(container, {
      center: DEFAULT_CENTER,
      zoom: 19,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      mapTypeId: "hybrid", // satellite + labels (noms de rues)
      tilt: 0,
      heading: 0,

      gestureHandling: "greedy",

      mapTypeControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: google.maps.ControlPosition.TOP_RIGHT,
        mapTypeIds: ["roadmap", "satellite", "hybrid"],
      },

      rotateControl: false,
      scaleControl: true,
      streetViewControl: false,
      fullscreenControl: false,
    });

    if (typeof mapInstance.setTilt === "function") mapInstance.setTilt(0);
    if (typeof mapInstance.setHeading === "function") mapInstance.setHeading(0);

    /** Repère bâtiment (phase 1 uniquement) — retiré avant capture html2canvas. */
    var buildingConfirmationMarker = null;

    var projectionOverlay = createPixelProjectionOverlay();
    projectionOverlay.setMap(mapInstance);

    var listeners = [];
    function addListener(eventName, fn) {
      if (typeof mapInstance.addListener === "function") {
        var h = mapInstance.addListener(eventName, fn);
        listeners.push(h);
      }
    }
    var eventHandlers = { dragstart: [], heading_changed: [], center_changed: [], zoom_changed: [] };
    addListener("dragstart", function () { eventHandlers.dragstart.forEach(function (cb) { cb(); }); });
    addListener("heading_changed", function () {
      if (typeof global !== "undefined") global.googleMapBearing = getHeading(mapInstance) || 0;
      eventHandlers.heading_changed.forEach(function (cb) { cb(); });
    });
    addListener("center_changed", function () { eventHandlers.center_changed.forEach(function (cb) { cb(); }); });
    addListener("zoom_changed", function () { eventHandlers.zoom_changed.forEach(function (cb) { cb(); }); });

    if (typeof global !== "undefined") global.googleMapBearing = getHeading(mapInstance) || 0;

    var api = {
      getCenter: function () {
        if (!mapInstance) return { lat: DEFAULT_CENTER.lat, lon: DEFAULT_CENTER.lng };
        var c = mapInstance.getCenter();
        return { lat: c ? c.lat() : DEFAULT_CENTER.lat, lon: c ? c.lng() : DEFAULT_CENTER.lng };
      },
      getZoom: function () { return mapInstance ? (mapInstance.getZoom() || DEFAULT_ZOOM) : DEFAULT_ZOOM; },
      getHeading: function () { return mapInstance ? (getHeading(mapInstance) || 0) : 0; },
      setHeading: function (deg) {
        if (mapInstance && typeof mapInstance.setHeading === "function") mapInstance.setHeading(deg);
      },
      projectLatLonToPixel: function (lat, lon) {
        if (!mapInstance || !projectionOverlay) {
          throw new Error("projectLatLonToPixel: carte ou overlay non initialisé.");
        }
        var proj = projectionOverlay.getProjection();
        if (!proj || typeof proj.fromLatLngToContainerPixel !== "function") {
          throw new Error("Projection Google non prête (OverlayView.getProjection). Attendez projectionReady ou réessayez.");
        }
        var pt = proj.fromLatLngToContainerPixel(new google.maps.LatLng(lat, lon));
        if (!pt || (typeof pt.x !== "number" || typeof pt.y !== "number") || (Number.isNaN(pt.x) || Number.isNaN(pt.y))) {
          throw new Error("Projection Google a retourné des coordonnées invalides (NaN). Projection non prête.");
        }
        return { x: pt.x, y: pt.y };
      },
      projectPixelToLatLon: function (x, y) {
        if (!mapInstance || !projectionOverlay) {
          throw new Error("projectPixelToLatLon: carte ou overlay non initialisé.");
        }
        var proj = projectionOverlay.getProjection();
        if (!proj || typeof proj.fromContainerPixelToLatLng !== "function") {
          throw new Error("Projection Google non prête (OverlayView.getProjection). Attendez projectionReady ou réessayez.");
        }
        var ll = proj.fromContainerPixelToLatLng(new google.maps.Point(x, y));
        if (!ll || typeof ll.lat !== "function" || typeof ll.lng !== "function") {
          throw new Error("Projection Google a retourné null pour fromContainerPixelToLatLng. Projection non prête.");
        }
        return { lat: ll.lat(), lon: ll.lng() };
      },
      on: function (event, handler) {
        if (eventHandlers[event] && typeof handler === "function") eventHandlers[event].push(handler);
      },
      off: function (event, handler) {
        if (eventHandlers[event]) { var i = eventHandlers[event].indexOf(handler); if (i >= 0) eventHandlers[event].splice(i, 1); }
      },
      getState: function () {
        if (!mapInstance) {
          return { centerLatLng: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, bearing: 0 };
        }
        var center = mapInstance.getCenter();
        var lat = center ? center.lat() : DEFAULT_CENTER.lat;
        var lng = center ? center.lng() : DEFAULT_CENTER.lng;
        return {
          centerLatLng: { lat: lat, lng: lng },
          zoom: mapInstance.getZoom() || DEFAULT_ZOOM,
          bearing: getHeading(mapInstance),
        };
      },
      getHeading: function () { return getHeading(mapInstance); },
      waitForProjectionReady: function () {
        return new Promise(function (resolve, reject) {
          var attempts = 0;
          var maxAttempts = 100;
          function check() {
            if (!mapInstance || !projectionOverlay) {
              reject(new Error("Carte ou overlay non initialisé."));
              return;
            }
            var proj = projectionOverlay.getProjection();
            if (proj && typeof proj.fromLatLngToContainerPixel === "function") {
              resolve();
              return;
            }
            attempts++;
            if (attempts >= maxAttempts) {
              reject(new Error("Projection Google non prête après " + maxAttempts + " tentatives."));
              return;
            }
            setTimeout(check, 50);
          }
          check();
        });
      },
      setView: function (center, zoom) {
        if (!mapInstance) return;
        var z = typeof zoom === "number" ? zoom : DEFAULT_ZOOM;
        var lat = Array.isArray(center) ? center[0] : (center && center.lat);
        var lng = Array.isArray(center) ? center[1] : (center && (center.lon != null ? center.lon : center.lng));
        if (typeof lat === "number" && typeof lng === "number") {
          mapInstance.setCenter({ lat: lat, lng: lng });
          mapInstance.setZoom(z);
        }
      },
      flyTo: function (center, zoom, options) {
        if (!mapInstance) return;
        var z = typeof zoom === "number" ? zoom : DEFAULT_ZOOM;
        var lat = Array.isArray(center) ? center[0] : (center && center.lat);
        var lng = Array.isArray(center) ? center[1] : (center && (center.lon != null ? center.lon : center.lng));
        if (typeof lat === "number" && typeof lng === "number") {
          mapInstance.panTo({ lat: lat, lng: lng });
          mapInstance.setZoom(z);
        }
      },
      onDragStart: function (cb) {
        if (typeof cb === "function") api.on("dragstart", cb);
      },
      resize: function () {
        if (mapInstance && typeof google !== "undefined" && google.maps && google.maps.event) {
          google.maps.event.trigger(mapInstance, "resize");
        }
      },
      setBuildingConfirmationMarker: function (lat, lng, options) {
        options = options || {};
        if (!mapInstance || typeof google === "undefined" || !google.maps) return;
        if (buildingConfirmationMarker && typeof buildingConfirmationMarker.setMap === "function") {
          buildingConfirmationMarker.setMap(null);
        }
        buildingConfirmationMarker = new google.maps.Marker({
          position: { lat: lat, lng: lng },
          map: mapInstance,
          draggable: options.draggable !== false,
          title: options.title || "Bâtiment à étudier — glisser pour ajuster",
          zIndex: 99999,
        });
        if (typeof buildingConfirmationMarker.addListener === "function" && typeof options.onDragEnd === "function") {
          buildingConfirmationMarker.addListener("dragend", function () {
            var p = buildingConfirmationMarker.getPosition();
            if (p) options.onDragEnd(p.lat(), p.lng());
          });
        }
      },
      getBuildingConfirmationPosition: function () {
        if (!buildingConfirmationMarker || typeof buildingConfirmationMarker.getPosition !== "function") return null;
        var p = buildingConfirmationMarker.getPosition();
        if (!p) return null;
        return { lat: p.lat(), lng: p.lng() };
      },
      removeBuildingConfirmationMarker: function () {
        if (buildingConfirmationMarker && typeof buildingConfirmationMarker.setMap === "function") {
          buildingConfirmationMarker.setMap(null);
        }
        buildingConfirmationMarker = null;
      },
      destroy: function () {
        if (!mapInstance) return;
        if (buildingConfirmationMarker && typeof buildingConfirmationMarker.setMap === "function") {
          buildingConfirmationMarker.setMap(null);
        }
        buildingConfirmationMarker = null;
        listeners.forEach(function (h) { if (h && typeof h.remove === "function") h.remove(); });
        listeners.length = 0;
        eventHandlers.dragstart.length = 0;
        eventHandlers.heading_changed.length = 0;
        eventHandlers.center_changed.length = 0;
        eventHandlers.zoom_changed.length = 0;
        if (projectionOverlay && typeof projectionOverlay.setMap === "function") projectionOverlay.setMap(null);
        container.innerHTML = "";
        mapInstance = null;
        projectionOverlay = null;
        if (typeof global !== "undefined") global.calpinageMap = null;
      },
      capture: function () {
        if (!container || !mapInstance) throw new Error("Carte non initialisée");
        if (!projectionOverlay) throw new Error("Overlay de projection non initialisé.");
        var html2canvasFn = (typeof global !== "undefined" && global.html2canvas) || (typeof window !== "undefined" && window.html2canvas);
        if (typeof html2canvasFn !== "function") {
          throw new Error("html2canvas non chargé. Ajoutez le script html2canvas pour la capture.");
        }
        var rect = container.getBoundingClientRect();
        var captureOpts = { useCORS: true, allowTaint: true, logging: false, scale: 1, backgroundColor: null };
        return html2canvasFn(container, captureOpts).then(function (rawCanvas) {
          var fixed = normalizeCapturedImage(rawCanvas);
          var scaleInfo = computeMetersPerPixelImage({
            map: mapInstance,
            overlay: projectionOverlay,
            containerEl: container,
            imageWidthPx: fixed.width,
            imageHeightPx: fixed.height,
            samplePx: 200,
          });
          return {
            image: {
              dataUrl: fixed.dataUrl,
              width: fixed.width,
              height: fixed.height,
              cssWidth: rect.width,
              cssHeight: rect.height,
            },
            scale: scaleInfo,
          };
        });
      },
    };
    if (typeof global !== "undefined") global.calpinageMap = api;
    return api;
  }

  function renderMapSourceSelector(options) {
    var container = options.container;
    var onCapture = options.onCapture;

    var wrap = document.createElement("div");
    wrap.className = "map-source-selector";

    var label = document.createElement("label");
    label.textContent = "Source carte";
    label.setAttribute("for", "calpinage-map-source");
    wrap.appendChild(label);

    var select = document.createElement("select");
    select.id = "calpinage-map-source";
    select.setAttribute("aria-label", "Source de la carte");
    var opt = document.createElement("option");
    opt.value = "google-satellite";
    opt.textContent = "Google Satellite";
    select.appendChild(opt);
    wrap.appendChild(select);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-capture-roof";
    btn.textContent = "Capturer la vue";
    btn.title = "Cadrez la carte (zoom, orientation, centre), puis capturez. Échelle et Nord automatiques.";
    btn.addEventListener("click", function () {
      var p = onCapture();
      if (p && typeof p.then === "function") {
        p.then(function () {}).catch(function (err) {
          console.error("[MapSourceSelector] onCapture", err);
        });
      }
    });
    wrap.appendChild(btn);

    container.appendChild(wrap);
  }

  function renderCalibrationPanel(options) {
    var container = options.container;
    var onActivateCalibration = options.onActivateCalibration;
    var onValidateCalibration = options.onValidateCalibration;

    var active = false;
    var hasAB = false;
    var errorMsg = null;

    var wrap = document.createElement("div");
    wrap.className = "calibration-panel";

    var btnActivate = document.createElement("button");
    btnActivate.type = "button";
    btnActivate.className = "btn-activate-calibration";
    btnActivate.textContent = "Activer calibration";
    wrap.appendChild(btnActivate);

    var instruction = document.createElement("p");
    instruction.className = "calibration-instruction";
    instruction.textContent = "Cliquez deux points dont vous connaissez la distance réelle.";
    instruction.style.marginTop = "10px";
    instruction.style.marginBottom = "10px";
    instruction.style.fontSize = "13px";
    instruction.style.color = "var(--muted, #6b7280)";
    wrap.appendChild(instruction);

    var labelDist = document.createElement("label");
    labelDist.textContent = "Distance réelle (m)";
    labelDist.setAttribute("for", "calpinage-distance-meters");
    labelDist.style.display = "block";
    labelDist.style.marginBottom = "4px";
    labelDist.style.fontSize = "13px";
    wrap.appendChild(labelDist);

    var inputMeters = document.createElement("input");
    inputMeters.id = "calpinage-distance-meters";
    inputMeters.type = "number";
    inputMeters.step = "0.01";
    inputMeters.min = "0.01";
    inputMeters.placeholder = "ex. 5.00";
    inputMeters.style.width = "100%";
    inputMeters.style.padding = "8px";
    inputMeters.style.marginBottom = "10px";
    wrap.appendChild(inputMeters);

    var errorEl = document.createElement("p");
    errorEl.className = "calibration-error";
    errorEl.style.color = "#b91c1c";
    errorEl.style.fontSize = "12px";
    errorEl.style.marginBottom = "8px";
    errorEl.style.minHeight = "18px";
    wrap.appendChild(errorEl);

    var btnValidate = document.createElement("button");
    btnValidate.type = "button";
    btnValidate.className = "btn-validate-calibration";
    btnValidate.textContent = "Valider la calibration";
    wrap.appendChild(btnValidate);

    function updateUI() {
      instruction.style.display = active ? "block" : "none";
      labelDist.style.display = active ? "block" : "none";
      inputMeters.style.display = active ? "block" : "none";
      btnValidate.style.display = active ? "block" : "none";
      errorEl.textContent = errorMsg || "";
      errorEl.style.display = errorMsg ? "block" : "none";
      btnValidate.disabled = !hasAB || !inputMeters.value || Number(inputMeters.value) <= 0;
    }

    btnActivate.addEventListener("click", function () {
      errorMsg = null;
      updateUI();
      onActivateCalibration();
    });

    btnValidate.addEventListener("click", function () {
      var raw = inputMeters.value.trim();
      var meters = parseFloat(raw);
      if (Number.isNaN(meters) || meters <= 0) {
        setError("Saisissez une distance réelle strictement positive (m).");
        return;
      }
      errorMsg = null;
      updateUI();
      onValidateCalibration(meters);
    });

    inputMeters.addEventListener("input", function () {
      errorMsg = null;
      updateUI();
    });

    function setCalibrationActive(activeVal) {
      active = activeVal;
      updateUI();
    }

    function setPointsAB(has) {
      hasAB = has;
      updateUI();
    }

    function setError(msg) {
      errorMsg = msg;
      updateUI();
    }

    updateUI();
    container.appendChild(wrap);

    return {
      setCalibrationActive: setCalibrationActive,
      setPointsAB: setPointsAB,
      setError: setError,
    };
  }

  /**
   * Ortho/IGN/Leaflet Map Provider — Interface MapProvider.
   * Heading toujours 0 (Leaflet ne supporte pas la rotation). Init/destroy propres.
   */
  function initGeoportailMap(container) {
    if (typeof L === "undefined" || !L.map) {
      throw new Error("Leaflet non chargé. Vérifiez le script Leaflet.");
    }
    var GP_CENTER = { lat: 48.8566, lng: 2.3522 };
    var GP_ZOOM = 19;
    var leafletMap = L.map(container, { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }).setView([GP_CENTER.lat, GP_CENTER.lng], GP_ZOOM);
    L.tileLayer(
      "https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal",
      { minZoom: 0, maxZoom: 21, tileSize: 256, attribution: "© IGN-F/Géoportail" }
    ).addTo(leafletMap);

    var buildingConfirmationMarker = null;

    var eventHandlers = { dragstart: [], heading_changed: [], center_changed: [], zoom_changed: [] };
    leafletMap.on("dragstart", function () { eventHandlers.dragstart.forEach(function (cb) { cb(); }); });
    leafletMap.on("moveend", function () {
      eventHandlers.center_changed.forEach(function (cb) { cb(); });
      eventHandlers.heading_changed.forEach(function (cb) { cb(); });
    });
    leafletMap.on("zoomend", function () {
      eventHandlers.zoom_changed.forEach(function (cb) { cb(); });
      eventHandlers.heading_changed.forEach(function (cb) { cb(); });
    });

    var api = {
      getCenter: function () {
        if (!leafletMap) return { lat: GP_CENTER.lat, lon: GP_CENTER.lng };
        var c = leafletMap.getCenter();
        return { lat: c.lat, lon: c.lng };
      },
      getZoom: function () {
        return leafletMap ? leafletMap.getZoom() : GP_ZOOM;
      },
      getHeading: function () { return 0; },
      setHeading: function () { /* Leaflet ne supporte pas la rotation */ },
      waitForProjectionReady: function () { return Promise.resolve(); },
      projectLatLonToPixel: function (lat, lon) {
        if (!leafletMap) return { x: 0, y: 0 };
        var pt = leafletMap.latLngToContainerPoint(L.latLng(lat, lon));
        return { x: pt.x, y: pt.y };
      },
      projectPixelToLatLon: function (x, y) {
        if (!leafletMap) return { lat: GP_CENTER.lat, lon: GP_CENTER.lng };
        var ll = leafletMap.containerPointToLatLng(L.point(x, y));
        return { lat: ll.lat, lon: ll.lng };
      },
      on: function (event, handler) {
        if (eventHandlers[event] && typeof handler === "function") eventHandlers[event].push(handler);
      },
      off: function (event, handler) {
        if (eventHandlers[event]) { var i = eventHandlers[event].indexOf(handler); if (i >= 0) eventHandlers[event].splice(i, 1); }
      },
      getState: function () {
        var c = api.getCenter();
        return { centerLatLng: { lat: c.lat, lng: c.lon }, zoom: api.getZoom(), bearing: 0 };
      },
      onDragStart: function (cb) {
        if (typeof cb === "function") api.on("dragstart", cb);
      },
      setView: function (center, zoom) {
        if (!leafletMap) return;
        var z = typeof zoom === "number" ? zoom : GP_ZOOM;
        var lat = Array.isArray(center) ? center[0] : (center && center.lat);
        var lng = Array.isArray(center) ? center[1] : (center && (center.lon != null ? center.lon : center.lng));
        if (typeof lat === "number" && typeof lng === "number") leafletMap.setView([lat, lng], z);
      },
      flyTo: function (center, zoom, options) {
        if (!leafletMap) return;
        var z = typeof zoom === "number" ? zoom : GP_ZOOM;
        var lat = Array.isArray(center) ? center[0] : (center && center.lat);
        var lng = Array.isArray(center) ? center[1] : (center && (center.lon != null ? center.lon : center.lng));
        if (typeof lat === "number" && typeof lng === "number") {
          var dur = (options && typeof options.duration === "number") ? options.duration : 0.8;
          leafletMap.flyTo([lat, lng], z, { duration: dur });
        }
      },
      invalidateSize: function () {
        if (leafletMap && typeof leafletMap.invalidateSize === "function") leafletMap.invalidateSize();
      },
      resize: function () {
        if (leafletMap && typeof leafletMap.invalidateSize === "function") leafletMap.invalidateSize();
      },
      setBuildingConfirmationMarker: function (lat, lng, options) {
        options = options || {};
        if (!leafletMap || typeof L === "undefined") return;
        if (buildingConfirmationMarker) {
          try { leafletMap.removeLayer(buildingConfirmationMarker); } catch (_) {}
          buildingConfirmationMarker = null;
        }
        buildingConfirmationMarker = L.marker([lat, lng], {
          draggable: options.draggable !== false,
          title: options.title || "Bâtiment à étudier — glisser pour ajuster",
        }).addTo(leafletMap);
        if (typeof buildingConfirmationMarker.setZIndexOffset === "function") {
          buildingConfirmationMarker.setZIndexOffset(10000);
        }
        if (options.onDragEnd) {
          buildingConfirmationMarker.on("dragend", function () {
            var ll = buildingConfirmationMarker.getLatLng();
            options.onDragEnd(ll.lat, ll.lng);
          });
        }
      },
      getBuildingConfirmationPosition: function () {
        if (!buildingConfirmationMarker) return null;
        var ll = buildingConfirmationMarker.getLatLng();
        return { lat: ll.lat, lng: ll.lng };
      },
      removeBuildingConfirmationMarker: function () {
        if (buildingConfirmationMarker && leafletMap) {
          try { leafletMap.removeLayer(buildingConfirmationMarker); } catch (_) {}
        }
        buildingConfirmationMarker = null;
      },
      destroy: function () {
        if (!leafletMap) return;
        if (buildingConfirmationMarker) {
          try { leafletMap.removeLayer(buildingConfirmationMarker); } catch (_) {}
          buildingConfirmationMarker = null;
        }
        eventHandlers.dragstart.length = 0;
        eventHandlers.heading_changed.length = 0;
        eventHandlers.center_changed.length = 0;
        eventHandlers.zoom_changed.length = 0;
        leafletMap.off();
        leafletMap.remove();
        leafletMap = null;
        if (container && container.innerHTML !== undefined) {
          container.innerHTML = "";
        }
        if (typeof global !== "undefined") global.calpinageMap = null;
      },
      capture: function () {
        if (!container || !leafletMap) throw new Error("Carte non initialisée");
        var html2canvasFn = (typeof global !== "undefined" && global.html2canvas) || (typeof window !== "undefined" && window.html2canvas);
        if (typeof html2canvasFn !== "function") {
          throw new Error("html2canvas non chargé. Ajoutez le script html2canvas pour la capture.");
        }
        var rect = container.getBoundingClientRect();
        var captureOpts = { useCORS: true, allowTaint: true, logging: false, scale: 1, backgroundColor: null };
        return html2canvasFn(container, captureOpts).then(function (rawCanvas) {
          var fixed = normalizeCapturedImage(rawCanvas);
          var c = leafletMap.getCenter();
          var z = leafletMap.getZoom();
          var INITIAL_RES = 156543.03392;
          var mpp = (INITIAL_RES * Math.cos((c.lat * Math.PI) / 180)) / Math.pow(2, z);
          return {
            image: {
              dataUrl: fixed.dataUrl,
              width: fixed.width,
              height: fixed.height,
              cssWidth: rect.width,
              cssHeight: rect.height,
            },
            scale: { metersPerPixelImage: mpp, sampleMeters: 200 * mpp, samplePx: 200 },
          };
        });
      },
    };
    if (typeof global !== "undefined") global.calpinageMap = api;
    return api;
  }

  if (typeof global !== "undefined") global.initGeoportailMap = initGeoportailMap;

  /**
   * Crée un MapProvider selon la source. Interface unique, pas de if/else côté calpinage.
   * @param {"google-satellite"|"geoportail-ortho"} source
   * @param {HTMLElement} container
   * @returns {MapProvider}
   */
  function createMapProvider(source, container) {
    if (source === "geoportail-ortho") return initGeoportailMap(container);
    return initGoogleMap(container);
  }

  global.CalpinageMap = {
    roofState: roofState,
    createMapProvider: createMapProvider,
    initGoogleMap: initGoogleMap,
    initGeoportailMap: initGeoportailMap,
    renderMapSourceSelector: renderMapSourceSelector,
    renderCalibrationPanel: renderCalibrationPanel,
    validateAndApplyCalibration: validateAndApplyCalibration,
    getPixelDistance: getPixelDistance,
    getMetersFromPixels: getMetersFromPixels,
  };
})(typeof window !== "undefined" ? window : this);
