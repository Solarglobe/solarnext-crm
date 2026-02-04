/**
 * PHASE 3.1 — Viewer 3D (Three.js, orbit manuel : rotation + zoom).
 * Affiche le modèle maison : murs extrudés + pans de toit. Rendu sobre, pas de textures.
 * Pas de dépendance OrbitControls : rotation à la souris, zoom à la molette.
 */
(function (global) {
  "use strict";

  function initPhase3Viewer(containerEl, houseModel) {
    if (!containerEl || !houseModel) return null;
    var THREE = global.THREE;
    if (!THREE) {
      console.warn("PHASE3: THREE not found. Load Three.js before phase3Viewer.");
      return null;
    }

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    var camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    var initW = containerEl.clientWidth || 0;
    var initH = containerEl.clientHeight || 0;
    if (initW > 0 && initH > 0) renderer.setSize(initW, initH);
    if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerEl.appendChild(renderer.domElement);

    var target = new THREE.Vector3(0, 0, 0);
    var spherical = { radius: 15, phi: 0.6, theta: 0.8 };
    var isDragging = false;
    var prevMouse = { x: 0, y: 0 };
    function updateCameraPosition() {
      var r = spherical.radius;
      camera.position.x = target.x + r * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      camera.position.y = target.y + r * Math.cos(spherical.phi);
      camera.position.z = target.z + r * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      camera.lookAt(target);
    }
    function onPointerDown(e) {
      if (e.button !== 0) return;
      isDragging = true;
      prevMouse.x = e.clientX;
      prevMouse.y = e.clientY;
    }
    function onPointerMove(e) {
      if (!isDragging) return;
      var dx = (e.clientX - prevMouse.x) * 0.01;
      var dy = (e.clientY - prevMouse.y) * 0.01;
      prevMouse.x = e.clientX;
      prevMouse.y = e.clientY;
      spherical.theta -= dx;
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + dy));
      updateCameraPosition();
    }
    function onPointerUp() { isDragging = false; }
    function onWheel(e) {
      e.preventDefault();
      spherical.radius = Math.max(1, Math.min(200, spherical.radius * (e.deltaY > 0 ? 1.1 : 0.9)));
      updateCameraPosition();
    }
    renderer.domElement.addEventListener("mousedown", onPointerDown);
    global.addEventListener("mousemove", onPointerMove);
    global.addEventListener("mouseup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

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

    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

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
    }
    var resizeObs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (resizeObs) resizeObs.observe(containerEl);
    else global.addEventListener("resize", onResize);

    function dispose() {
      renderer.domElement.removeEventListener("mousedown", onPointerDown);
      global.removeEventListener("mousemove", onPointerMove);
      global.removeEventListener("mouseup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      if (resizeObs && containerEl) resizeObs.unobserve(containerEl);
      else global.removeEventListener("resize", onResize);
      for (var i = 0; i < allMeshes.length; i++) {
        if (allMeshes[i].geometry) allMeshes[i].geometry.dispose();
        if (allMeshes[i].material) allMeshes[i].material.dispose();
      }
      wallMaterial.dispose();
      roofMaterial.dispose();
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    }

    function setVisible(visible) {
      renderer.domElement.style.display = visible ? "" : "none";
      if (visible) internalResize();
    }

    return { dispose: dispose, setVisible: setVisible };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initPhase3Viewer: initPhase3Viewer };
  } else {
    global.Phase3Viewer = { initPhase3Viewer: initPhase3Viewer };
  }
})(typeof window !== "undefined" ? window : globalThis);
