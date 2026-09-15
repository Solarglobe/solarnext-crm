import { pool } from '../../config/db.js';
import { assertClientStudyExportable, getStudyShadingState, studyArchiveWarning } from '../../../shared/shading/clientStudyExport.js';
import { getStudyCalculationFreshness } from '../studyCalculationFreshness.service.js';

/** Generation receipt describes this PDF, including deliberate exclusion of local shading. */
export function buildStudyPdfExportReceipt(snapshot) {
  assertClientStudyExportable(snapshot);
  const state = getStudyShadingState(snapshot);
  const shading = snapshot.shading ?? snapshot.scenario_result?.shading;
  return { version: 'study-document-v2', input_fingerprint: snapshot.input_fingerprint, ...state,
    shading: state.shadingIncluded ? { assessment: shading.assessment, near: shading.near, far: shading.far, combined: shading.combined } : null };
}

/** Read-only currentness classification. Archived PDFs retain their original bytes and metadata. */
export async function getStudyPdfDocumentState(doc, organizationId, db = pool) {
  return readStudyPdfDocumentState(doc, organizationId, db, getStudyCalculationFreshness);
}

/** A list shares reads only for this response, and never floods the connection pool. */
export async function getStudyPdfDocumentStates(docs, organizationId, db = pool) {
  const queries = new Map();
  const freshness = new Map();
  const reader = {
    query(text, values) {
      // The large input capture is already deduplicated by version below. Do not
      // retain another copy of its geometry/profile for the lifetime of the list.
      if (text.includes('v.data_json - ARRAY')) return db.query(text, values);
      const key = JSON.stringify([text, values]);
      if (!queries.has(key)) queries.set(key, Promise.resolve().then(() => db.query(text, values)));
      return queries.get(key);
    },
  };
  const readFreshness = (params) => {
    const key = JSON.stringify([params.organizationId, params.studyId, params.versionId]);
    if (!freshness.has(key)) {
      freshness.set(key, getStudyCalculationFreshness(params).then((state) => ({
        needs_recompute: state.needs_recompute,
        current_input_fingerprint: state.current_input_fingerprint,
      })));
    }
    return freshness.get(key);
  };
  const states = new Array(docs.length);
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(2, docs.length) }, async () => {
    while (next < docs.length && !failure) {
      const index = next++;
      try {
        states[index] = await readStudyPdfDocumentState(docs[index], organizationId, reader, readFreshness);
      } catch (error) {
        failure ??= error;
      }
    }
  }));
  if (failure) throw failure;
  return states;
}

async function readStudyPdfDocumentState(doc, organizationId, db, readFreshness) {
  if (!['study_pdf', 'study_proposal'].includes(doc.document_type)) return {};
  let metadata = doc.metadata_json ?? {};
  let versionId = doc.entity_type === 'study_version' ? doc.entity_id : metadata.study_version_id;
  if (!metadata.shading_export_receipt && metadata.source_study_version_document_id) {
    const source = (await db.query('SELECT entity_id, metadata_json FROM entity_documents WHERE id=$1 AND organization_id=$2', [metadata.source_study_version_document_id, organizationId])).rows[0];
    metadata = source?.metadata_json ?? {}; versionId = source?.entity_id ?? versionId;
  }
  const receipt = metadata.shading_export_receipt;
  let documentCurrent = false;
  let documentVerification = 'historical_unverified';
  if (receipt?.version === 'study-document-v2' && receipt.input_fingerprint && versionId) {
    const row = (await db.query('SELECT v.study_id, v.version_number, s.current_version FROM study_versions v JOIN studies s ON s.id=v.study_id AND s.organization_id=v.organization_id WHERE v.id=$1 AND v.organization_id=$2', [versionId, organizationId])).rows[0];
    if (row) {
      try {
        const freshness = await readFreshness({ studyId: row.study_id, versionId, organizationId, db });
        documentCurrent = row.version_number === row.current_version && !freshness.needs_recompute && receipt.input_fingerprint === freshness.current_input_fingerprint;
        documentVerification = documentCurrent ? (receipt.shadingIncluded ? 'current_with_shading' : 'current_without_shading') : 'archived_inputs_changed';
      } catch (error) {
        if (error.status !== 404 && error.status !== 409) throw error;
        documentVerification = 'archived_inputs_unavailable';
      }
    }
  }
  return { documentCurrent, documentArchived: !documentCurrent, documentVerification,
    documentWarning: documentCurrent ? null : studyArchiveWarning(doc.created_at),
    shadingIncluded: receipt?.shadingIncluded === true, shadingApplied: receipt?.shadingApplied === true };
}

/** Delivery is independent of calculation validity; callers enforce auth, org, scope, storage and integrity. */
export async function assertStudyPdfDocumentDeliverable(doc, organizationId, db = pool) {
  if (doc.organization_id && doc.organization_id !== organizationId) throw Object.assign(new Error('Organisation invalide'), { status: 403 });
  return getStudyPdfDocumentState(doc, organizationId, db);
}
