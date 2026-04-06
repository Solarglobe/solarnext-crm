import { CalpinageProject } from "./types";

export function migrateCalpinage(
  data: unknown
): CalpinageProject {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid Calpinage payload: not an object");
  }

  const v = (data as any)?.meta?.version;

  if (v === "v1") {
    return data as CalpinageProject;
  }

  throw new Error(
    `Unsupported Calpinage version: ${v ?? "undefined"}`
  );
}
