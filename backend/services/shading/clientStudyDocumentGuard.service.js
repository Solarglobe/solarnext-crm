import { pool } from '../../config/db.js';
import { assertClientStudyExportable } from '../../../shared/shading/clientStudyExport.js';
import { assertStudyCalculationCurrent } from '../studyCalculationFreshness.service.js';
import { getNormalizedShadingFromGeometry } from '../calpinage/calpinageShadingLegacyAdapter.js';

/** Receipt bound to this generated PDF; never infer old document validity from a later recalculation. */
export function buildStudyPdfExportReceipt(snapshot) {
  assertClientStudyExportable(snapshot);
  const shading = snapshot.shading ?? snapshot.scenario_result?.shading;
  return { input_fingerprint: snapshot.input_fingerprint, shading: { assessment: shading.assessment, near: shading.near, far: shading.far, combined: shading.combined } };
}

export async function assertStudyPdfDocumentDeliverable(doc, organizationId, db = pool) {
  if (!['study_pdf', 'study_proposal'].includes(doc.document_type)) return;
  let metadata = doc.metadata_json ?? {};
  let versionId = doc.entity_type === 'study_version' ? doc.entity_id : metadata.study_version_id;
  if (!metadata.shading_export_receipt && metadata.source_study_version_document_id) {
    const source = (await db.query('SELECT entity_id, metadata_json FROM entity_documents WHERE id=$1 AND organization_id=$2', [metadata.source_study_version_document_id, organizationId])).rows[0];
    metadata = source?.metadata_json ?? {}; versionId = source?.entity_id ?? versionId;
  }
  assertClientStudyExportable(metadata.shading_export_receipt);
  const row = (await db.query('SELECT v.study_id, v.data_json, c.geometry_json FROM study_versions v LEFT JOIN calpinage_data c ON c.study_version_id=v.id AND c.organization_id=v.organization_id WHERE v.id=$1 AND v.organization_id=$2', [versionId, organizationId])).rows[0];
  assertClientStudyExportable({ ...row?.data_json, shading: getNormalizedShadingFromGeometry(row?.geometry_json).shading });
  await assertStudyCalculationCurrent({ studyId: row.study_id, versionId, organizationId, db, snapshot: metadata.shading_export_receipt });
}
