/**
 * Propagation déterministe des positions après drag d’extrémité (Phase 2).
 * Uniquement attaches explicites : type "trait" (id + pointIndex), "contour" (id + pointIndex),
 * et "roof_contour_edge" (contourId + segmentIndex + t).
 * Pas d’heuristique spatiale — deux points superposés sans attach ne sont pas liés.
 */

/**
 * @param {unknown} t
 * @returns {boolean}
 */
function isChienAssisTrait(t) {
  return !!(t && t.roofRole === "chienAssis");
}

/**
 * @param {unknown} r
 * @returns {boolean}
 */
function isChienAssisRidge(r) {
  return !!(r && r.roofRole === "chienAssis");
}

/**
 * Met à jour le sommet canonique d’un trait et synchronise toutes les extrémités
 * (traits + faîtages) qui déclarent le même attach explicite.
 * Cascade récursive (avec garde anti-boucle _visited) pour couvrir les chaînes
 * multi-niveau : T0 ← T1 ← T2 (où T1 alias T0 et T2 alias T1).
 *
 * @param {Array} traits
 * @param {Array} ridges
 * @param {string} traitId
 * @param {0|1} pointIndex
 * @param {number} x
 * @param {number} y
 * @param {Object} [_visited]  objet interne de garde anti-récursion (ne pas passer en usage normal)
 */
export function propagateExplicitTraitJunction(traits, ridges, traitId, pointIndex, x, y, _visited) {
  if (typeof traitId !== "string" || (pointIndex !== 0 && pointIndex !== 1)) return;
  /* Garde anti-récursion infinie */
  if (!_visited) _visited = Object.create(null);
  var _key = traitId + ":" + pointIndex;
  if (_visited[_key]) return;
  _visited[_key] = true;

  var t = (traits || []).find(function (u) {
    return u && u.id === traitId && !isChienAssisTrait(u);
  });
  if (!t || !t.a || !t.b) return;
  var slot = pointIndex === 0 ? t.a : t.b;
  slot.x = x;
  slot.y = y;

  /* Collect les ids de traits dont l’extrémité est un alias de ce sommet,
   * pour cascader la propagation à leurs propres alias. */
  var _cascadeIds = [];

  (traits || []).forEach(function (tr) {
    if (!tr || isChienAssisTrait(tr)) return;
    var attA = tr.a && tr.a.attach;
    if (attA && attA.type === "trait" && attA.id === traitId && attA.pointIndex === pointIndex) {
      tr.a.x = x; tr.a.y = y;
      _cascadeIds.push({ traitId: tr.id, pointIndex: 0 });
    }
    var attB = tr.b && tr.b.attach;
    if (attB && attB.type === "trait" && attB.id === traitId && attB.pointIndex === pointIndex) {
      tr.b.x = x; tr.b.y = y;
      _cascadeIds.push({ traitId: tr.id, pointIndex: 1 });
    }
  });
  (ridges || []).forEach(function (r) {
    if (!r || isChienAssisRidge(r)) return;
    var attA = r.a && r.a.attach;
    if (attA && attA.type === "trait" && attA.id === traitId && attA.pointIndex === pointIndex) { r.a.x = x; r.a.y = y; }
    var attB = r.b && r.b.attach;
    if (attB && attB.type === "trait" && attB.id === traitId && attB.pointIndex === pointIndex) { r.b.x = x; r.b.y = y; }
  });

  /* Cascade aux traits mis à jour (pour couvrir la chaîne d’aliases) */
  _cascadeIds.forEach(function (j) {
    propagateExplicitTraitJunction(traits, ridges, j.traitId, j.pointIndex, x, y, _visited);
  });
}

/**
 * Met à jour le sommet de contour canonique et synchronise les extrémités qui y sont attachées.
 * Cascade ensuite via propagateExplicitTraitJunction pour chaque extrémité de trait mise à jour,
 * afin de couvrir les aliases de niveau 2 (ex. : T2.attach → T1.attach → contour vertex).
 *
 * @param {Array} contours
 * @param {Array} traits
 * @param {Array} ridges
 * @param {string} contourId
 * @param {number} pointIndex
 * @param {number} x
 * @param {number} y
 */
export function propagateExplicitContourJunction(contours, traits, ridges, contourId, pointIndex, x, y) {
  if (typeof contourId !== "string" || typeof pointIndex !== "number" || pointIndex < 0) return;
  var c = (contours || []).find(function (u) {
    return u && u.id === contourId && u.roofRole !== "chienAssis";
  });
  if (!c || !c.points || !c.points[pointIndex]) return;
  var pt = c.points[pointIndex];
  pt.x = x;
  pt.y = y;

  /* Collect les extrémités de TRAIT mises à jour, pour cascader vers leurs aliases. */
  var _cascadeIds = [];

  (traits || []).forEach(function (tr) {
    if (!tr || isChienAssisTrait(tr)) return;
    var attA = tr.a && tr.a.attach;
    if (attA && attA.type === "contour" && attA.id === contourId && attA.pointIndex === pointIndex) {
      tr.a.x = x; tr.a.y = y;
      _cascadeIds.push({ traitId: tr.id, pointIndex: 0 });
    }
    var attB = tr.b && tr.b.attach;
    if (attB && attB.type === "contour" && attB.id === contourId && attB.pointIndex === pointIndex) {
      tr.b.x = x; tr.b.y = y;
      _cascadeIds.push({ traitId: tr.id, pointIndex: 1 });
    }
  });
  (ridges || []).forEach(function (r) {
    if (!r || isChienAssisRidge(r)) return;
    var attA = r.a && r.a.attach;
    if (attA && attA.type === "contour" && attA.id === contourId && attA.pointIndex === pointIndex) { r.a.x = x; r.a.y = y; }
    var attB = r.b && r.b.attach;
    if (attB && attB.type === "contour" && attB.id === contourId && attB.pointIndex === pointIndex) { r.b.x = x; r.b.y = y; }
  });

  /* Cascade : pour chaque trait mis à jour, propager à ses aliases éventuels */
  var _visited = Object.create(null);
  _cascadeIds.forEach(function (j) {
    propagateExplicitTraitJunction(traits, ridges, j.traitId, j.pointIndex, x, y, _visited);
  });
}

/**
 * Synchronise les x,y stockés des extrémités avec attach "roof_contour_edge"
 * après modification d’un contour (déplacement de sommet, snap au pointerup).
 * N’affecte que les extrémités référençant le contour identifié par contourId.
 * Sans effet sur les entités chienAssis.
 *
 * @param {Array} contours CALPINAGE_STATE.contours
 * @param {Array} traits   CALPINAGE_STATE.traits
 * @param {Array} ridges   CALPINAGE_STATE.ridges
 * @param {string} contourId id du contour modifié
 */
export function propagateRoofContourEdgeJunctionAfterContourEdit(contours, traits, ridges, contourId) {
  if (typeof contourId !== "string") return;
  var c = (contours || []).find(function (x) { return x && x.id === contourId; });
  if (!c || !c.points || c.points.length < 2) return;

  function syncEp(ep) {
    if (!ep || typeof ep !== "object") return;
    var att = ep.attach;
    if (!att || att.type !== "roof_contour_edge" || att.contourId !== contourId) return;
    var i = att.segmentIndex;
    var n = c.points.length;
    if (typeof i !== "number" || i < 0 || i >= n) return;
    var a = c.points[i];
    var b = c.points[(i + 1) % n];
    if (!a || !b || typeof a.x !== "number" || typeof b.x !== "number") return;
    var t = typeof att.t === "number" && Number.isFinite(att.t) ? att.t : 0.5;
    t = Math.max(0, Math.min(1, t));
    ep.x = a.x + t * (b.x - a.x);
    ep.y = a.y + t * (b.y - a.y);
  }

  (traits || []).forEach(function (tr) {
    if (!tr || isChienAssisTrait(tr)) return;
    syncEp(tr.a);
    syncEp(tr.b);
  });
  (ridges || []).forEach(function (r) {
    if (!r || isChienAssisRidge(r)) return;
    syncEp(r.a);
    syncEp(r.b);
  });
}

/**
 * Corrige les attaches de traits/faîtages suite à la suppression du sommet `deletedIndex`
 * du contour identifié par `contourId`.
 *
 * Règles appliquées :
 *  - attach.type === "contour" && attach.id === contourId && attach.pointIndex === deletedIndex
 *    → attach mis à null (endpoint orphelin, x/y figés)
 *  - attach.type === "contour" && attach.id === contourId && attach.pointIndex > deletedIndex
 *    → attach.pointIndex décrémenté de 1
 *  - attach.type === "roof_contour_edge" && attach.contourId === contourId
 *    → si segmentIndex === deletedIndex ou deletedIndex-1 (segment disparu) → attach = null
 *    → si segmentIndex > deletedIndex → segmentIndex décrémenté de 1
 *
 * @param {Array} contours @param {Array} traits @param {Array} ridges
 * @param {string} contourId @param {number} deletedIndex
 */
export function fixContourVertexDeleteAttaches(contours, traits, ridges, contourId, deletedIndex) {
  if (typeof contourId !== "string" || typeof deletedIndex !== "number") return;
  function fixEp(ep) {
    if (!ep || typeof ep !== "object") return;
    var att = ep.attach;
    if (!att || typeof att !== "object") return;
    if (att.type === "contour" && att.id === contourId) {
      if (att.pointIndex === deletedIndex) {
        ep.attach = null;
      } else if (typeof att.pointIndex === "number" && att.pointIndex > deletedIndex) {
        att.pointIndex -= 1;
      }
      return;
    }
    if (att.type === "roof_contour_edge" && att.contourId === contourId) {
      var si = att.segmentIndex;
      if (typeof si === "number") {
        /* Le segment [deletedIndex-1, deletedIndex] et [deletedIndex, deletedIndex+1] disparaissent. */
        if (si === deletedIndex || si === deletedIndex - 1) {
          ep.attach = null;
        } else if (si > deletedIndex) {
          att.segmentIndex -= 1;
        }
      }
    }
  }
  (traits || []).forEach(function (tr) {
    if (!tr || isChienAssisTrait(tr)) return;
    fixEp(tr.a);
    fixEp(tr.b);
  });
  (ridges || []).forEach(function (r) {
    if (!r || isChienAssisRidge(r)) return;
    fixEp(r.a);
    fixEp(r.b);
  });
}

/**
 * Corrige toutes les attaches de traits/faîtages après insertion d’un nouveau sommet
 * dans un contour (edge-split). Les index de points et de segments situés après le
 * point d’insertion sont incrémentés ; le segment splitté voit ses attaches
 * roof_contour_edge redistribuées selon le paramètre t du nouveau sommet.
 *
 * @param {Array} contours @param {Array} traits @param {Array} ridges
 * @param {string} contourId   ID du contour modifié
 * @param {number} insertIndex index du nouveau point dans points[] après splice (= segmentIndex + 1)
 * @param {number} t_insert    paramètre t du nouveau sommet sur le segment original [0..1]
 */
export function fixContourVertexInsertAttaches(contours, traits, ridges, contourId, insertIndex, t_insert) {
  if (typeof contourId !== "string" || typeof insertIndex !== "number") return;
  var iSeg = insertIndex - 1; /* index du segment original splitté */
  function fixEp(ep) {
    if (!ep || typeof ep !== "object") return;
    var att = ep.attach;
    if (!att || typeof att !== "object") return;
    if (att.type === "contour" && att.id === contourId) {
      /* Les points d’index >= insertIndex sont décalés d’un rang */
      if (typeof att.pointIndex === "number" && att.pointIndex >= insertIndex) {
        att.pointIndex += 1;
      }
      return;
    }
    if (att.type === "roof_contour_edge" && att.contourId === contourId) {
      var si = att.segmentIndex;
      if (typeof si !== "number") return;
      if (si === iSeg) {
        /* Redistribuer t sur le segment original splitté */
        var t_old = att.t;
        if (typeof t_old === "number" && t_insert > 0 && t_insert < 1) {
          if (t_old > t_insert) {
            /* Endpoint tombe dans la seconde moitié → nouveau segment iSeg+1 */
            att.segmentIndex = insertIndex;
            att.t = (t_old - t_insert) / (1 - t_insert);
          } else {
            /* Endpoint reste sur iSeg ; t rescalé sur la première moitié */
            att.t = t_old / t_insert;
          }
        }
        /* Si t_insert dégénéré (0 ou 1), laisser tel quel — cas extrême théorique */
      } else if (si >= insertIndex) {
        att.segmentIndex += 1;
      }
    }
  }
  (traits || []).forEach(function (tr) {
    if (!tr || isChienAssisTrait(tr)) return;
    fixEp(tr.a);
    fixEp(tr.b);
  });
  (ridges || []).forEach(function (r) {
    if (!r || isChienAssisRidge(r)) return;
    fixEp(r.a);
    fixEp(r.b);
  });
}

/**
 * Après commit drag : applique la propagation selon l’attach courant de l’extrémité.
 * Règle asymétrique documentée :
 * - attach "trait" ou "contour" → synchronisation des copies d’extrémités qui référencent le même sommet logique
 * - sinon (sommet « propriétaire » d’un trait) → propagation sur (ownerTraitId, ownerPointIndex) pour les alias uniquement
 * - sinon (ridge sans attach trait/contour) → pas de propagation
 *
 * @param {{ contours?: Array; traits?: Array; ridges?: Array }} state
 * @param {{ x: number; y: number; attach?: unknown | null }} ep endpoint modifié (déjà mis à jour x,y,attach)
 * @param {{ kind: "trait" | "ridge"; traitId?: string; traitPointIndex?: 0|1 }} [owner] requis si kind==="trait" et attach non trait/contour
 */
export function propagateLinkedEndpointsAfterDrag(state, ep, owner) {
  if (!ep || typeof ep.x !== "number" || typeof ep.y !== "number") return;
  var x = ep.x;
  var y = ep.y;
  var att = ep.attach;
  var contours = state.contours || [];
  var traits = state.traits || [];
  var ridges = state.ridges || [];

  if (att && typeof att === "object" && att.type === "contour" && att.id != null && typeof att.pointIndex === "number") {
    propagateExplicitContourJunction(contours, traits, ridges, att.id, att.pointIndex, x, y);
    return;
  }
  if (att && typeof att === "object" && att.type === "trait" && att.id != null && (att.pointIndex === 0 || att.pointIndex === 1)) {
    propagateExplicitTraitJunction(traits, ridges, att.id, att.pointIndex, x, y);
    return;
  }
  if (owner && owner.kind === "trait" && owner.traitId != null && (owner.traitPointIndex === 0 || owner.traitPointIndex === 1)) {
    propagateExplicitTraitJunction(traits, ridges, owner.traitId, owner.traitPointIndex, x, y);
  }
}
