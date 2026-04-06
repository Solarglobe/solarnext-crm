/**
 * Calpinage migrations
 * Versioning handler
 */

export function migrateCalpinage(data) {
  if (!data || typeof data !== "object") {
    const err = new Error("Invalid Calpinage payload: not an object");
    err.statusCode = 400;
    throw err;
  }

  const version = data?.meta?.version;

  if (version === "v1") {
    return data;
  }

  const err = new Error(
    `Unsupported Calpinage version: ${version ?? "undefined"}`
  );
  err.statusCode = 400;
  throw err;
}
