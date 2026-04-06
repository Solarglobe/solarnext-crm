(function () {
  function computeHorizonFarLoss(sunSamples, horizonMask) {
    if (!sunSamples || !horizonMask) return 0;

    var azimuthStepDeg = horizonMask.azimuthStepDeg;
    var elevations = horizonMask.elevations;

    if (!azimuthStepDeg || !Array.isArray(elevations)) return 0;

    var blocked = 0;
    var total = 0;

    var N = elevations.length;
    if (N < 1) return 0;

    for (var i = 0; i < sunSamples.length; i++) {
      var s = sunSamples[i];
      if (!s || typeof s.elevationDeg !== "number" || typeof s.azimuthDeg !== "number") continue;
      if (s.elevationDeg <= 0) continue;

      total++;

      var a = ((s.azimuthDeg % 360) + 360) % 360;
      var indexFloat = a / azimuthStepDeg;
      var i0 = Math.floor(indexFloat) % N;
      if (i0 < 0) i0 += N;
      var i1 = (i0 + 1) % N;
      var t = indexFloat - Math.floor(indexFloat);
      var e0 = typeof elevations[i0] === "number" && Number.isFinite(elevations[i0]) ? elevations[i0] : 0;
      var e1 = typeof elevations[i1] === "number" && Number.isFinite(elevations[i1]) ? elevations[i1] : 0;
      var horizonElevation = e0 + t * (e1 - e0);
      if (!Number.isFinite(horizonElevation)) horizonElevation = 0;
      horizonElevation = Math.max(-5, Math.min(90, horizonElevation));

      if (s.elevationDeg < horizonElevation) blocked++;
    }

    if (total === 0) return 0;
    return blocked / total;
  }

  window.computeHorizonFarLoss = computeHorizonFarLoss;
})();
