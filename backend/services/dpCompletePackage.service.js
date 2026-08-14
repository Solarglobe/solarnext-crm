import fs from "fs/promises";
import { PDFDocument } from "pdf-lib";
import { pool } from "../config/db.js";
import { getAbsolutePath } from "./localStorage.service.js";

export const DP_COMPLETE_REQUIRED_PIECES = Object.freeze([
  { key: "mandat", label: "Mandat signé" },
  { key: "cerfa", label: "CERFA" },
  { key: "dp1", label: "DP1 - Plan de situation" },
  { key: "dp2", label: "DP2 - Plan de masse" },
  { key: "dp3", label: "DP3 - Plan de coupe" },
  { key: "dp4", label: "DP4 - Façades et toitures" },
  { key: "dp6", label: "DP6 - Insertion paysagère" },
  { key: "dp7", label: "DP7 - Photo proche" },
  { key: "dp8", label: "DP8 - Photo lointaine" },
]);

const REQUIRED_BY_KEY = new Map(DP_COMPLETE_REQUIRED_PIECES.map((piece) => [piece.key, piece]));

function makeMissingPiecesError(missingPieces) {
  const err = new Error(
    "Dossier DP complet impossible : générez d'abord toutes les pièces obligatoires."
  );
  err.statusCode = 400;
  err.code = "DP_COMPLETE_MISSING_PIECES";
  err.missingPieces = missingPieces;
  return err;
}

function makeInvalidPdfError(source, cause) {
  const err = new Error(`PDF DP illisible pour ${source.label || source.pieceKey || source.fileName}.`);
  err.statusCode = 400;
  err.code = "DP_COMPLETE_INVALID_SOURCE_PDF";
  err.source = {
    documentId: source.id,
    fileName: source.fileName,
    piece: source.pieceKey,
  };
  err.cause = cause;
  return err;
}

/**
 * @returns {Promise<Array<{ id:string, pieceKey:string, label:string, fileName:string, storageKey:string, optional:boolean }>>}
 */
export async function listLeadDpCompletePdfSources(organizationId, leadId) {
  const requiredKeys = DP_COMPLETE_REQUIRED_PIECES.map((piece) => piece.key);
  const required = await pool.query(
    `WITH dp_docs AS (
       SELECT
         ed.id,
         ed.file_name,
         ed.storage_key,
         ed.created_at,
         COALESCE(
           NULLIF(LOWER(ed.metadata_json->>'dp_piece'), ''),
           CASE
             WHEN LOWER(ed.file_name) LIKE 'cerfa%' THEN 'cerfa'
             WHEN LOWER(ed.file_name) LIKE 'mandat%' THEN 'mandat'
             WHEN LOWER(ed.file_name) LIKE 'dp1%' THEN 'dp1'
             WHEN LOWER(ed.file_name) LIKE 'dp2%' THEN 'dp2'
             WHEN LOWER(ed.file_name) LIKE 'dp3%' THEN 'dp3'
             WHEN LOWER(ed.file_name) LIKE 'dp4%' THEN 'dp4'
             WHEN LOWER(ed.file_name) LIKE 'dp6%' THEN 'dp6'
             WHEN LOWER(ed.file_name) LIKE 'dp7%' THEN 'dp7'
             WHEN LOWER(ed.file_name) LIKE 'dp8%' THEN 'dp8'
             ELSE NULL
           END
         ) AS piece_key
       FROM entity_documents ed
       WHERE ed.organization_id = $1
         AND ed.entity_type = 'lead'
         AND ed.entity_id = $2
         AND ed.document_type = 'dp_pdf'
         AND ed.storage_key IS NOT NULL
         AND (ed.archived_at IS NULL)
         AND (ed.mime_type = 'application/pdf' OR LOWER(ed.file_name) LIKE '%.pdf')
     )
     SELECT DISTINCT ON (piece_key)
       id, file_name, storage_key, piece_key
     FROM dp_docs
     WHERE piece_key = ANY($3::text[])
     ORDER BY piece_key, created_at DESC`,
    [organizationId, leadId, requiredKeys]
  );

  const byPiece = new Map(required.rows.map((row) => [row.piece_key, row]));
  const orderedRequired = DP_COMPLETE_REQUIRED_PIECES
    .map((piece) => {
      const row = byPiece.get(piece.key);
      if (!row) return null;
      return {
        id: row.id,
        pieceKey: piece.key,
        label: piece.label,
        fileName: row.file_name,
        storageKey: row.storage_key,
        optional: false,
      };
    })
    .filter(Boolean);

  const receipts = await pool.query(
    `SELECT id, file_name, storage_key
     FROM entity_documents
     WHERE organization_id = $1
       AND entity_type = 'lead'
       AND entity_id = $2
       AND document_category = 'DP_MAIRIE'
       AND storage_key IS NOT NULL
       AND (archived_at IS NULL)
       AND (mime_type = 'application/pdf' OR LOWER(file_name) LIKE '%.pdf')
       AND (
         file_name ILIKE '%recepiss%'
         OR file_name ILIKE '%récépiss%'
         OR display_name ILIKE '%recepiss%'
         OR display_name ILIKE '%récépiss%'
         OR description ILIKE '%recepiss%'
         OR description ILIKE '%récépiss%'
       )
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, leadId]
  );

  const optionalReceipts = receipts.rows.map((row) => ({
    id: row.id,
    pieceKey: "recepisse",
    label: "Récépissé mairie",
    fileName: row.file_name,
    storageKey: row.storage_key,
    optional: true,
  }));

  return [...orderedRequired, ...optionalReceipts];
}

export function getMissingDpCompletePieces(sources) {
  const present = new Set((Array.isArray(sources) ? sources : []).map((source) => source.pieceKey));
  return DP_COMPLETE_REQUIRED_PIECES
    .filter((piece) => !present.has(piece.key))
    .map((piece) => ({ key: piece.key, label: piece.label }));
}

export async function assembleLeadDpCompletePdf({ organizationId, leadId }) {
  const sources = await listLeadDpCompletePdfSources(organizationId, leadId);
  const missingPieces = getMissingDpCompletePieces(sources);
  if (missingPieces.length > 0) {
    throw makeMissingPiecesError(missingPieces);
  }

  const output = await PDFDocument.create();
  output.setTitle("Dossier déclaration préalable complet");
  output.setSubject("Dossier DP complet mairie");
  output.setProducer("Solarnext CRM");
  output.setCreator("Solarnext CRM");

  for (const source of sources) {
    let bytes;
    try {
      bytes = await fs.readFile(getAbsolutePath(source.storageKey));
    } catch (cause) {
      throw makeInvalidPdfError(source, cause);
    }

    let input;
    try {
      input = await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (cause) {
      throw makeInvalidPdfError(source, cause);
    }

    const pageIndexes = input.getPageIndices();
    const copiedPages = await output.copyPages(input, pageIndexes);
    copiedPages.forEach((page) => output.addPage(page));
  }

  if (output.getPageCount() === 0) {
    throw makeMissingPiecesError(DP_COMPLETE_REQUIRED_PIECES.map((piece) => ({
      key: piece.key,
      label: piece.label,
    })));
  }

  const pdfBytes = await output.save();
  return Buffer.from(pdfBytes);
}

export function resolveDpCompletePieceLabel(pieceKey) {
  return REQUIRED_BY_KEY.get(pieceKey)?.label || pieceKey;
}
