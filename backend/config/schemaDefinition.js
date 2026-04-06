/**
 * Schéma DB attendu par le backend (colonnes critiques).
 * Utilisé par schemaGuard pour bloquer le démarrage si migrations non appliquées.
 */

export const EXPECTED_SCHEMA = {
  entity_documents: [
    "id",
    "organization_id",
    "entity_type",
    "entity_id",
    "file_name",
    "file_size",
    "mime_type",
    "storage_key",
    "url",
    "uploaded_by",
    "created_at",
    "archived_at",
    "archived_by",
    "document_type",
    "metadata_json",
    "document_category",
    "source_type",
    "is_client_visible",
    "display_name",
    "description",
  ],

  leads: [
    "id",
    "organization_id",
    "consumption_csv_path",
    "energy_profile",
    "consumption_mode",
    "consumption_annual_kwh",
    "consumption_annual_calculated_kwh",
    "created_at",
  ],

  lead_meters: [
    "id",
    "organization_id",
    "lead_id",
    "name",
    "is_default",
    "consumption_mode",
    "created_at",
  ],
};
