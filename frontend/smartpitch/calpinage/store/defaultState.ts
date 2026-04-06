import { CalpinageProject } from "./types";

export function createDefaultCalpinageState(): CalpinageProject {
  const now = new Date().toISOString();

  return {
    meta: {
      version: "v1",
      createdAt: now,
      updatedAt: now,
      leadId: null,
      projectId: null,
    },
    roof: {
      image: "",
    },
    planes: [],
    keepouts: [],
    pv: {
      module: "",
      layout: [],
    },
    obstaclesRoof: [],
    obstaclesFar: [],
  };
}
