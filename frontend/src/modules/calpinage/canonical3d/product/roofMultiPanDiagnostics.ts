import type { InterPanRelationReport } from "../builder/interPanTypes";
import type { RoofModel3D } from "../types/model";
import type {
  SolarSceneRoofMultiPanDiagnosticItem,
  SolarSceneRoofMultiPanDiagnostics,
} from "../types/solarScene3d";

const Z_DIVERGENCE_WARN_M = 0.03;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function relationCodes(r: InterPanRelationReport): string[] {
  return [...new Set(r.diagnostics.map((d) => d.code))].sort();
}

function itemFromRelation(
  r: InterPanRelationReport,
  kind: SolarSceneRoofMultiPanDiagnosticItem["kind"],
  severity: SolarSceneRoofMultiPanDiagnosticItem["severity"],
  messageFr: string,
): SolarSceneRoofMultiPanDiagnosticItem {
  return {
    kind,
    severity,
    edgeId: r.edgeId,
    panIds: [r.planePatchIdA, r.planePatchIdB],
    messageFr,
    angleBetweenNormalsDeg: round1(r.angleBetweenNormalsDeg),
    dihedralProfileDeg: round1(r.dihedralProfileDeg),
    ...(typeof r.structuralHeightDeltaM === "number" && Number.isFinite(r.structuralHeightDeltaM)
      ? { structuralHeightDeltaM: Math.round(r.structuralHeightDeltaM * 1000) / 1000 }
      : {}),
    codes: relationCodes(r),
  };
}

export function buildRoofMultiPanDiagnostics(args: {
  readonly model: RoofModel3D;
  readonly interPanReports: readonly InterPanRelationReport[];
}): SolarSceneRoofMultiPanDiagnostics {
  const items: SolarSceneRoofMultiPanDiagnosticItem[] = [];

  for (const r of args.interPanReports) {
    const codes = relationCodes(r);
    if (codes.includes("INTERPAN_NON_MANIFOLD_EDGE")) {
      items.push(itemFromRelation(r, "non_manifold", "error", "Plus de deux pans partagent la même arête : jonction non-manifold à reprendre."));
      continue;
    }
    if (typeof r.structuralHeightDeltaM === "number" && r.structuralHeightDeltaM > Z_DIVERGENCE_WARN_M) {
      items.push(
        itemFromRelation(
          r,
          "z_divergence",
          "warning",
          `Z divergents sur ligne structurelle (${r.structuralHeightDeltaM.toFixed(2)} m) : harmoniser les hauteurs des extrémités.`,
        ),
      );
    }
    if (codes.some((c) => c.includes("ASYMMETRY") || c.includes("CONFLICT"))) {
      items.push(itemFromRelation(r, "edge_conflict", "warning", "Conflit détecté sur arête partagée : vérifier collage et hauteurs des deux pans."));
    }
    if (r.continuityGrade === "weak") {
      items.push(itemFromRelation(r, "weak_join", "warning", "Jonction faible entre pans : le collage géométrique doit être contrôlé avant pose PV."));
    }
    if (r.continuityGrade === "ambiguous") {
      items.push(itemFromRelation(r, "suspicious_join", "warning", "Jonction ambiguë : angle ou rôle structurel suspect entre les deux pans."));
    }
    if (r.structuralRole === "topology_only" && r.continuityGrade !== "weak" && r.continuityGrade !== "ambiguous") {
      items.push(itemFromRelation(r, "unstructured_join", "info", "Arête commune sans faîtage/trait : ajouter une ligne structurelle si cette jonction doit piloter la toiture."));
    }
  }

  const sharedEdgeCount = args.model.roofEdges.filter((e) => e.incidentPlanePatchIds.length >= 2).length;
  const conflictCount = items.filter((i) => i.severity === "error" || i.kind === "edge_conflict").length;
  const weakJoinCount = items.filter((i) => i.kind === "weak_join").length;
  const zDivergenceCount = items.filter((i) => i.kind === "z_divergence").length;
  const suspiciousJoinCount = items.filter((i) => i.kind === "suspicious_join").length;
  const nonManifoldCount = items.filter((i) => i.kind === "non_manifold").length;
  const blockingCount = conflictCount + weakJoinCount + zDivergenceCount + suspiciousJoinCount + nonManifoldCount;
  const okForPvLayout = blockingCount === 0;
  const summaryFr =
    args.interPanReports.length === 0
      ? "Toiture mono-pan ou aucune arête partagée détectée."
      : okForPvLayout
        ? `Multi-pans OK : ${args.interPanReports.length} jonction(s) analysée(s).`
        : `Multi-pans à vérifier : ${blockingCount} alerte(s) sur ${args.interPanReports.length} jonction(s).`;

  return {
    relationCount: args.interPanReports.length,
    sharedEdgeCount,
    conflictCount,
    weakJoinCount,
    zDivergenceCount,
    suspiciousJoinCount,
    nonManifoldCount,
    okForPvLayout,
    items,
    summaryFr,
  };
}
