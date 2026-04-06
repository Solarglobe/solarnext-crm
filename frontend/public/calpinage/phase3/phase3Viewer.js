/**
 * PHASE 3.1 — Viewer 3D (Three.js, orbit manuel : rotation + zoom).
 *
 * ─── STATUT : LEGACY (GELÉ) — SolarNext stratégie 3D officielle ───
 * Ne pas ajouter de fonctionnalités ici. Corrections bloquantes uniquement si nécessaire.
 * Viewer officiel : SolarScene3DViewer (canonical3d), basé sur SolarScene3D / géométrie explicite.
 * La 3D canonique ne dépend pas du rendu legacy ; CALPINAGE_STATE → géométrie canonique → SolarScene3DViewer.
 * Plan de convergence (gel, cible, étapes) : docs/architecture/3d-convergence-plan.md
 *
 * Affiche le modèle maison : murs extrudés + pans de toit. Rendu sobre, pas de textures.
 * Panneaux PV optionnels : quads 2.5D (plan horizontal Y), dimensions catalogue + axes projection —
 * pas le polygone 2D projeté comme surface physique sur pente.
 * Pas de dépendance OrbitControls : rotation à la souris / pointeur, zoom à la molette.
 * Rendu à la demande (pas de boucle RAF continue) ; Pointer Events + capture pour interaction fiable.
 */
(function (global) {
  "use strict";

  /** Avertissement dev unique : viewer legacy gelé (Phase 1 dépréciation). */
  function warnLegacyViewerOnce() {
    try {
      if (typeof console === "undefined" || !console.warn) return;
      var g = global;
      if (g.__PHASE3_VIEWER_LEGACY_WARNED__) return;
      var devish = g.__CALPINAGE_3D_DEBUG__ === true;
      if (!devish && g.location && typeof g.location.hostname === "string") {
        var hn = g.location.hostname;
        devish = hn === "localhost" || hn === "127.0.0.1" || hn === "[::1]";
      }
      if (!devish) return;
      g.__PHASE3_VIEWER_LEGACY_WARNED__ = true;
      console.warn(
        "[CALPINAGE][3D][LEGACY] phase3Viewer.js est gelé. Nouvelles features 3D → SolarScene3DViewer (canonical3d). " +
          "Voir src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx"
      );
    } catch (_e) {}
  }

  /**
   * @param {HTMLElement} containerEl
   * @param {{ walls?: unknown[], roofMeshes?: unknown[] }} houseModel
   * @param {{
   *   originPx?: { x: number, y: number },
   *   metersPerPixel?: number,
   *   getWorldHeightAtImagePx?: function(number, number): number,
   *   placedPanels?: Array<{
   *     panelId: string,
   *     panId: string,
   *     centerPx: { x: number, y: number },
   *     orientation: string,
   *     slopeAxisImage: { x: number, y: number },
   *     perpAxisImage: { x: number, y: number },
   *     widthM: number,
   *     heightM: number,
   *     blockRotationDeg: number,
   *     localRotationDeg: number
   *   }>
   * }} [viewerOptions]
   */
  function initPhase3Viewer(containerEl, houseModel, viewerOptions) {
    if (!containerEl || !houseModel) return null;
    viewerOptions = viewerOptions || {};
    var THREE = global.THREE;
    if (!THREE) {
      console.warn("PHASE3: THREE not found. Load Three.js before phase3Viewer.");
      return null;
    }

    warnLegacyViewerOnce();

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    var camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    var initW = containerEl.clientWidth || 0;
    var initH = containerEl.clientHeight || 0;
    if (initW > 0 && initH > 0) renderer.setSize(initW, initH);
    if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;
    var canvasEl = renderer.domElement;
    canvasEl.style.touchAction = "none";
    containerEl.appendChild(canvasEl);

    var target = new THREE.Vector3(0, 0, 0);
    var spherical = { radius: 15, phi: 0.6, theta: 0.8 };
    var isDragging = false;
    var activePointerId = null;
    var prevPointer = { x: 0, y: 0 };

    function updateCameraPosition() {
      var r = spherical.radius;
      camera.position.x = target.x + r * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      camera.position.y = target.y + r * Math.cos(spherical.phi);
      camera.position.z = target.z + r * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      camera.lookAt(target);
    }

    var renderRafId = null;

    function cancelPendingRender() {
      if (renderRafId != null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(renderRafId);
        renderRafId = null;
      }
    }

    function tryRenderFrame() {
      if (typeof document !== "undefined" && document.hidden) return;
      if (canvasEl.style.display === "none") return;
      var cw = containerEl.clientWidth || 0;
      var ch = containerEl.clientHeight || 0;
      if (cw < 2 || ch < 2) return;
      renderer.render(scene, camera);
    }

    /** Au plus une frame GPU planifiée ; les appels multiples dans la même frame sont fusionnés. */
    function requestRender() {
      if (renderRafId != null) return;
      renderRafId = requestAnimationFrame(function () {
        renderRafId = null;
        tryRenderFrame();
      });
    }

    function onPointerDown(e) {
      if (!e.isPrimary) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      isDragging = true;
      activePointerId = e.pointerId;
      prevPointer.x = e.clientX;
      prevPointer.y = e.clientY;
      try {
        canvasEl.setPointerCapture(e.pointerId);
      } catch (err) {}
    }

    function onPointerMove(e) {
      if (!isDragging || e.pointerId !== activePointerId) return;
      var dx = (e.clientX - prevPointer.x) * 0.01;
      var dy = (e.clientY - prevPointer.y) * 0.01;
      prevPointer.x = e.clientX;
      prevPointer.y = e.clientY;
      spherical.theta -= dx;
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + dy));
      updateCameraPosition();
      requestRender();
    }

    function clearDrag() {
      isDragging = false;
      activePointerId = null;
    }

    function onPointerUp(e) {
      if (activePointerId != null && e.pointerId !== activePointerId) return;
      try {
        if (canvasEl.hasPointerCapture && canvasEl.hasPointerCapture(e.pointerId)) {
          canvasEl.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}
      clearDrag();
      requestRender();
    }

    function onPointerCancel(e) {
      if (activePointerId != null && e.pointerId !== activePointerId) return;
      clearDrag();
      requestRender();
    }

    function onLostPointerCapture(e) {
      if (activePointerId != null && e.pointerId === activePointerId) clearDrag();
      requestRender();
    }

    function onWheel(e) {
      e.preventDefault();
      spherical.radius = Math.max(1, Math.min(200, spherical.radius * (e.deltaY > 0 ? 1.1 : 0.9)));
      updateCameraPosition();
      requestRender();
    }

    canvasEl.addEventListener("pointerdown", onPointerDown);
    canvasEl.addEventListener("pointermove", onPointerMove);
    canvasEl.addEventListener("pointerup", onPointerUp);
    canvasEl.addEventListener("pointercancel", onPointerCancel);
    canvasEl.addEventListener("lostpointercapture", onLostPointerCapture);
    canvasEl.addEventListener("wheel", onWheel, { passive: false });

    var ambient = new THREE.AmbientLight(0x404040, 1);
    scene.add(ambient);
    var dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 20, 10);
    scene.add(dir);

    var grid = new THREE.GridHelper(20, 20, 0x333333, 0x222222);
    grid.visible = false;
    scene.add(grid);

    var wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide
    });
    var roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide
    });

    var originPx = viewerOptions.originPx || { x: 0, y: 0 };
    var mpp =
      typeof viewerOptions.metersPerPixel === "number" && viewerOptions.metersPerPixel > 0
        ? viewerOptions.metersPerPixel
        : 1;
    var getWorldHeightAtImagePx =
      typeof viewerOptions.getWorldHeightAtImagePx === "function"
        ? viewerOptions.getWorldHeightAtImagePx
        : function () {
            return 0;
          };
    var placedPanels = Array.isArray(viewerOptions.placedPanels) ? viewerOptions.placedPanels : [];

    /** Aligné houseModelV2 (LEGACY). Repère ≠ canonique ENU Z-up — voir docs/architecture/3d-world-convention.md et canonical3d/core/worldConvention.ts */
    function imagePxToWorldXZ(px, py) {
      return {
        x: (px - originPx.x) * mpp,
        z: (py - originPx.y) * mpp
      };
    }

    /** Offset vertical léger pour limiter le z-fighting avec les roofMeshes 2.5D (pas une épaisseur module). */
    var PV_QUAD_Y_EPS_M = 0.025;

    var pvPanelMaterial =
      placedPanels.length > 0
        ? new THREE.MeshStandardMaterial({
            color: 0x2c5282,
            roughness: 0.78,
            metalness: 0.06,
            side: THREE.DoubleSide
          })
        : null;

    var allMeshes = [];

    if (houseModel.walls && houseModel.walls.length > 0) {
      for (var w = 0; w < houseModel.walls.length; w++) {
        var wall = houseModel.walls[w];
        if (wall.type === "extruded" && wall.contour && wall.contour.length >= 3 && typeof wall.height === "number") {
          var shape = new THREE.Shape();
          shape.moveTo(wall.contour[0].x, wall.contour[0].y);
          for (var c = 1; c < wall.contour.length; c++) {
            shape.lineTo(wall.contour[c].x, wall.contour[c].y);
          }
          shape.closePath();
          var extrudeSettings = { depth: wall.height, bevelEnabled: false };
          var geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
          var mesh = new THREE.Mesh(geom, wallMaterial);
          mesh.rotation.x = -Math.PI / 2;
          if (typeof wall.baseZ === "number") mesh.position.y = wall.baseZ;
          scene.add(mesh);
          allMeshes.push(mesh);
        }
      }
    }

    if (houseModel.roofMeshes && houseModel.roofMeshes.length > 0) {
      for (var r = 0; r < houseModel.roofMeshes.length; r++) {
        var roof = houseModel.roofMeshes[r];
        var verts = roof.vertices;
        var inds = roof.indices;
        if (verts && verts.length >= 9 && inds && inds.length >= 3) {
          var bufGeom = new THREE.BufferGeometry();
          var threeVerts = [];
          for (var vi = 0; vi < verts.length; vi += 3) {
            threeVerts.push(verts[vi], verts[vi + 2], verts[vi + 1]);
          }
          bufGeom.setAttribute("position", new THREE.Float32BufferAttribute(threeVerts, 3));
          bufGeom.setIndex(inds);
          bufGeom.computeVertexNormals();
          var roofMesh = new THREE.Mesh(bufGeom, roofMaterial);
          scene.add(roofMesh);
          allMeshes.push(roofMesh);
        }
      }
    }

    /* Panneaux PV posés : quads horizontaux (2.5D honnête), dims catalogue + axes image→monde — pas polygonPx comme surface physique. */
    if (placedPanels.length > 0 && pvPanelMaterial) {
      for (var pi = 0; pi < placedPanels.length; pi++) {
        var spec = placedPanels[pi];
        if (!spec || !spec.centerPx || !spec.slopeAxisImage || !spec.perpAxisImage) continue;
        var wM = spec.widthM;
        var hM = spec.heightM;
        if (!Number.isFinite(wM) || !Number.isFinite(hM) || wM <= 0 || hM <= 0) continue;
        var orientStr = (spec.orientation && String(spec.orientation).toUpperCase()) || "PORTRAIT";
        var isPaysage = orientStr === "PAYSAGE" || orientStr === "LANDSCAPE";
        var halfAlong = isPaysage ? wM / 2 : hM / 2;
        var halfPerp = isPaysage ? hM / 2 : wM / 2;

        var su = spec.slopeAxisImage;
        var sv = spec.perpAxisImage;
        var lenSu = Math.hypot(su.x, su.y) || 1;
        var lenSv = Math.hypot(sv.x, sv.y) || 1;
        var u3x = su.x / lenSu;
        var u3z = su.y / lenSu;
        var v3x = sv.x / lenSv;
        var v3z = sv.y / lenSv;

        var xz = imagePxToWorldXZ(spec.centerPx.x, spec.centerPx.y);
        var alt = getWorldHeightAtImagePx(spec.centerPx.x, spec.centerPx.y);
        if (!Number.isFinite(alt)) alt = 0;
        alt += PV_QUAD_Y_EPS_M;

        var cx = xz.x;
        var cy = alt;
        var cz = xz.z;

        var positions = new Float32Array([
          cx - u3x * halfAlong - v3x * halfPerp,
          cy,
          cz - u3z * halfAlong - v3z * halfPerp,
          cx + u3x * halfAlong - v3x * halfPerp,
          cy,
          cz + u3z * halfAlong - v3z * halfPerp,
          cx + u3x * halfAlong + v3x * halfPerp,
          cy,
          cz + u3z * halfAlong + v3z * halfPerp,
          cx - u3x * halfAlong + v3x * halfPerp,
          cy,
          cz - u3z * halfAlong + v3z * halfPerp
        ]);
        var normals = new Float32Array(12);
        for (var nvi = 0; nvi < 4; nvi++) {
          normals[nvi * 3] = 0;
          normals[nvi * 3 + 1] = 1;
          normals[nvi * 3 + 2] = 0;
        }
        var pGeom = new THREE.BufferGeometry();
        pGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        pGeom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
        pGeom.setIndex([0, 1, 2, 0, 2, 3]);
        var pMesh = new THREE.Mesh(pGeom, pvPanelMaterial);
        pMesh.userData = {
          phase3PvPanel: true,
          panelId: spec.panelId,
          panId: spec.panId,
          widthM: wM,
          heightM: hM,
          centerPx: spec.centerPx,
          orientation: spec.orientation,
          blockRotationDeg: spec.blockRotationDeg,
          localRotationDeg: spec.localRotationDeg
        };
        scene.add(pMesh);
        allMeshes.push(pMesh);
      }
    }

    scene.updateMatrixWorld(true);
    var box = new THREE.Box3();
    for (var m = 0; m < allMeshes.length; m++) {
      allMeshes[m].geometry.computeBoundingBox();
      box.union(allMeshes[m].geometry.boundingBox.clone().applyMatrix4(allMeshes[m].matrixWorld));
    }
    if (box.isEmpty()) {
      box.setFromCenterAndSize(new THREE.Vector3(0, 0, 3), new THREE.Vector3(10, 10, 6));
    }
    var size = new THREE.Vector3();
    var center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    var maxDim = Math.max(size.x, size.y, size.z, 1);
    camera.position.copy(center).add(new THREE.Vector3(maxDim * 0.8, maxDim * 0.8, maxDim * 1.2));
    camera.lookAt(center);
    target.copy(center);
    var offset = new THREE.Vector3().subVectors(camera.position, center);
    spherical.radius = offset.length();
    spherical.phi = Math.acos(THREE.MathUtils.clamp(offset.y / spherical.radius, -1, 1));
    spherical.theta = Math.atan2(offset.z, offset.x);

    function onPhase3DocumentVisibility() {
      if (typeof document !== "undefined" && document.hidden) {
        cancelPendingRender();
        return;
      }
      internalResize();
      requestRender();
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onPhase3DocumentVisibility);
    }

    function internalResize() {
      var w = containerEl.clientWidth || 0;
      var h = containerEl.clientHeight || 0;
      if (w <= 0 || h <= 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function onResize() {
      if (!containerEl.parentNode) return;
      internalResize();
      requestRender();
    }

    var resizeObs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (resizeObs) resizeObs.observe(containerEl);
    else global.addEventListener("resize", onResize);

    function dispose() {
      cancelPendingRender();
      if (activePointerId != null) {
        try {
          if (canvasEl.hasPointerCapture && canvasEl.hasPointerCapture(activePointerId)) {
            canvasEl.releasePointerCapture(activePointerId);
          }
        } catch (err) {}
      }
      clearDrag();

      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onPhase3DocumentVisibility);
      }
      canvasEl.removeEventListener("pointerdown", onPointerDown);
      canvasEl.removeEventListener("pointermove", onPointerMove);
      canvasEl.removeEventListener("pointerup", onPointerUp);
      canvasEl.removeEventListener("pointercancel", onPointerCancel);
      canvasEl.removeEventListener("lostpointercapture", onLostPointerCapture);
      canvasEl.removeEventListener("wheel", onWheel);
      if (resizeObs && containerEl) resizeObs.unobserve(containerEl);
      else global.removeEventListener("resize", onResize);
      for (var i = 0; i < allMeshes.length; i++) {
        if (allMeshes[i].geometry) allMeshes[i].geometry.dispose();
        if (allMeshes[i].material) allMeshes[i].material.dispose();
      }
      wallMaterial.dispose();
      roofMaterial.dispose();
      if (pvPanelMaterial) pvPanelMaterial.dispose();
      renderer.dispose();
      if (canvasEl && canvasEl.parentNode) {
        canvasEl.parentNode.removeChild(canvasEl);
      }
    }

    function setVisible(visible) {
      canvasEl.style.display = visible ? "" : "none";
      if (visible) {
        internalResize();
        requestRender();
      } else {
        cancelPendingRender();
      }
    }

    requestRender();

    return {
      dispose: dispose,
      setVisible: setVisible,
      requestRender: requestRender,
      resize: function () {
        internalResize();
        requestRender();
      }
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initPhase3Viewer: initPhase3Viewer };
  } else {
    global.Phase3Viewer = { initPhase3Viewer: initPhase3Viewer };
  }
})(typeof window !== "undefined" ? window : globalThis);
