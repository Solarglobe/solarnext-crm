/**
 * CP-AUTO-CONVERT-ARCHIVE-08 — Admin Archives
 * CP-ARCHIVE-EXPORT-09 — Export CSV
 * GET /api/admin/archives — liste des leads archivés
 * GET /api/admin/archives/export — export CSV des archives
 * POST /api/admin/archives/:id/restore — restaure un lead archivé
 *
 * Permissions : user.manage ou structure.manage
 */

import { pool } from "../config/db.js";
import { restoreEntity } from "../services/archive.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

/**
 * Échappe une valeur pour CSV (virgules, guillemets, retours à la ligne)
 */
function escapeCsvValue(val) {
  if (val == null || val === "") return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * GET /api/admin/archives/export
 * Exporte tous les leads archivés en CSV (UTF-8).
 */
export async function exportCsv(req, res) {
  try {
    const org = orgId(req);

    const result = await pool.query(
      `SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.status, l.archived_reason, l.archived_at,
              ps.name as last_stage_name
       FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       WHERE l.organization_id = $1 AND l.archived = true
       ORDER BY l.archived_at DESC`,
      [org]
    );

    const headers = [
      "id",
      "first_name",
      "last_name",
      "email",
      "phone",
      "status",
      "last_stage_name",
      "archived_reason",
      "archived_at",
    ];
    const rows = [headers.join(",")];

    for (const r of result.rows) {
      const row = [
        escapeCsvValue(r.id),
        escapeCsvValue(r.first_name),
        escapeCsvValue(r.last_name),
        escapeCsvValue(r.email),
        escapeCsvValue(r.phone),
        escapeCsvValue(r.status),
        escapeCsvValue(r.last_stage_name),
        escapeCsvValue(r.archived_reason),
        escapeCsvValue(r.archived_at ? new Date(r.archived_at).toISOString() : null),
      ];
      rows.push(row.join(","));
    }

    const csv = "\uFEFF" + rows.join("\r\n"); // BOM UTF-8 pour Excel
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="archives-export.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/admin/archives
 * Liste les leads archivés de l'organisation.
 */
export async function list(req, res) {
  try {
    const org = orgId(req);

    const result = await pool.query(
      `SELECT l.id, l.full_name, l.email, l.phone, l.status, l.archived_at, l.archived_by, l.archived_reason,
              ps.name as stage_name, u.email as archived_by_email
       FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       LEFT JOIN users u ON u.id = l.archived_by
       WHERE l.organization_id = $1 AND l.archived_at IS NOT NULL
       ORDER BY l.archived_at DESC`,
      [org]
    );

    const items = result.rows.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      email: r.email,
      phone: r.phone,
      status: r.status,
      archived_at: r.archived_at,
      archived_by: r.archived_by,
      archived_by_email: r.archived_by_email,
      archived_reason: r.archived_reason,
      stage_name: r.stage_name,
    }));

    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/admin/archives/:id/restore
 * Restaure un lead archivé.
 */
export async function restore(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;

    const restored = await restoreEntity("leads", id, org);
    if (!restored) {
      return res.status(404).json({ error: "Lead archivé non trouvé" });
    }

    const updated = await pool.query(
      `SELECT l.*, ps.name as stage_name
       FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       WHERE l.id = $1 AND l.organization_id = $2`,
      [id, org]
    );

    res.json(updated.rows[0] || restored);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
