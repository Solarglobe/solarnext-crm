import { serializeInstallerError } from "./installers.errors.js";
import * as repo from "./installers.repository.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userContext = (req) => ({ userId: req.user?.userId ?? req.user?.id });

function handleError(res, error) {
  const serialized = serializeInstallerError(error);
  return res.status(serialized.status).json(serialized.body);
}

export async function list(req, res) {
  try {
    const rows = await repo.listInstallers({
      organizationId: orgId(req),
      active: req.query.active,
      q: req.query.q,
      zoneType: req.query.zone_type || req.query.zoneType,
      zoneCode: req.query.zone_code || req.query.department || req.query.postal_code,
    });
    res.json({ data: rows });
  } catch (error) {
    handleError(res, error);
  }
}

export async function get(req, res) {
  try {
    const data = await repo.getInstallerComplete({ organizationId: orgId(req), installerId: req.params.id });
    res.json(data);
  } catch (error) {
    handleError(res, error);
  }
}

export async function create(req, res) {
  try {
    const data = await repo.createInstaller({ organizationId: orgId(req), payload: req.body || {}, context: userContext(req) });
    res.status(201).json(data);
  } catch (error) {
    handleError(res, error);
  }
}

export async function patch(req, res) {
  try {
    const data = await repo.patchInstaller({ organizationId: orgId(req), installerId: req.params.id, payload: req.body || {} });
    res.json(data);
  } catch (error) {
    handleError(res, error);
  }
}

export async function replaceZones(req, res) {
  try {
    const data = await repo.replaceInstallerZones({
      organizationId: orgId(req),
      installerId: req.params.id,
      zones: req.body?.zones || req.body || [],
    });
    res.json({ data });
  } catch (error) {
    handleError(res, error);
  }
}

export async function listTariffVersions(req, res) {
  try {
    const data = await repo.listTariffVersions({ organizationId: orgId(req), installerId: req.params.id });
    res.json({ data });
  } catch (error) {
    handleError(res, error);
  }
}

export async function getTariffVersion(req, res) {
  try {
    const data = await repo.getTariffVersionComplete({
      organizationId: orgId(req),
      installerId: req.params.id,
      tariffVersionId: req.params.versionId,
    });
    res.json(data);
  } catch (error) {
    handleError(res, error);
  }
}

export async function createTariffVersion(req, res) {
  try {
    const data = await repo.createTariffVersion({
      organizationId: orgId(req),
      installerId: req.params.id,
      payload: req.body || {},
      context: userContext(req),
    });
    res.status(201).json(data);
  } catch (error) {
    handleError(res, error);
  }
}

export async function activateTariffVersion(req, res) {
  try {
    const data = await repo.activateTariffVersion({
      organizationId: orgId(req),
      installerId: req.params.id,
      tariffVersionId: req.params.versionId,
    });
    res.json(data);
  } catch (error) {
    handleError(res, error);
  }
}

export async function replaceCatalog(req, res) {
  try {
    const data = await repo.replaceTariffCatalog({
      organizationId: orgId(req),
      installerId: req.params.id,
      tariffVersionId: req.params.versionId,
      payload: req.body || {},
    });
    res.json(data);
  } catch (error) {
    handleError(res, error);
  }
}

export async function compute(req, res) {
  try {
    const data = await repo.computeInstallationCost({
      organizationId: orgId(req),
      installerId: req.params.id,
      payload: req.body || {},
      context: userContext(req),
    });
    res.json(data);
  } catch (error) {
    handleError(res, error);
  }
}
