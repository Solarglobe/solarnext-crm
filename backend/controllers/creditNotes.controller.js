/**
 * Avoirs — émission, snapshot documentaire, PDF figé.
 */

import { pool } from "../config/db.js";
import * as creditNotesService from "../services/creditNotes.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

export async function issueCreditNote(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const row = await creditNotesService.issueCreditNote(org, req.params.id);
    res.json(row);
  } catch (e) {
    const code = e.statusCode || 400;
    res.status(code).json({ error: e.message });
  }
}

export async function getDocumentSnapshot(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const snap = await creditNotesService.getCreditNoteDocumentSnapshot(req.params.id, org);
    if (snap === null) {
      const row = await pool.query(
        `SELECT id FROM credit_notes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
        [req.params.id, org]
      );
      if (row.rows.length === 0) return res.status(404).json({ error: "Avoir non trouvé" });
      return res.status(404).json({ error: "Aucun snapshot documentaire figé pour cet avoir" });
    }
    res.json({ snapshot: snap });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function generatePdf(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const data = await creditNotesService.generateCreditNotePdfRecord(req.params.id, org, userId(req));
    res.status(201).json(data);
  } catch (e) {
    const code = e.statusCode === 404 ? 404 : e.statusCode === 400 ? 400 : 500;
    res.status(code).json({ error: e.message });
  }
}
