/**
 * CP-FINANCIAL-POLE — Schéma financier (devis commercial, factures, paiements, avoirs, relances, séquences)
 * - Snapshots issuer/recipient
 * - Statuts normalisés (UPPERCASE)
 * - Numérotation document_sequences (QUOTE | INVOICE | CREDIT_NOTE)
 * - Triggers : total_paid (paiements RECORDED), total_credited + amount_due
 * Non destructif : backfill données existantes, pas de suppression de tables.
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  // -------------------------------------------------------------------------
  // 1) document_sequences
  // -------------------------------------------------------------------------
  pgm.createTable("document_sequences", {
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    document_kind: { type: "varchar(20)", notNull: true },
    year: { type: "integer", notNull: true },
    last_value: { type: "integer", notNull: true, default: 0 },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  addConstraintIdempotent(
    pgm,
    "document_sequences",
    "document_sequences_org_kind_year_unique",
    "UNIQUE (organization_id, document_kind, year)"
  );
  addConstraintIdempotent(
    pgm,
    "document_sequences",
    "document_sequences_kind_check",
    "CHECK (document_kind IN ('QUOTE','INVOICE','CREDIT_NOTE'))"
  );
  addConstraintIdempotent(
    pgm,
    "document_sequences",
    "document_sequences_year_check",
    "CHECK (year >= 2000 AND year <= 2100)"
  );
  pgm.createIndex("document_sequences", ["organization_id"], {
    name: "idx_document_sequences_org",
  });

  // -------------------------------------------------------------------------
  // 2) quotes — colonnes + contraintes (CHECK status après backfill SQL)
  // -------------------------------------------------------------------------
  pgm.addColumn("quotes", {
    currency: {
      type: "varchar(3)",
      notNull: true,
      default: "EUR",
    },
    discount_ht: {
      type: "numeric",
      notNull: true,
      default: 0,
    },
    sent_at: { type: "timestamptz" },
    accepted_at: { type: "timestamptz" },
    rejected_at: { type: "timestamptz" },
    cancelled_at: { type: "timestamptz" },
    issuer_snapshot: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'{}'::jsonb`),
    },
    recipient_snapshot: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'{}'::jsonb`),
    },
  });

  // -------------------------------------------------------------------------
  // 3) invoices — colonnes financières + snapshots
  // -------------------------------------------------------------------------
  pgm.addColumn("invoices", {
    currency: {
      type: "varchar(3)",
      notNull: true,
      default: "EUR",
    },
    issue_date: { type: "date" },
    paid_at: { type: "timestamptz" },
    total_credited: {
      type: "numeric",
      notNull: true,
      default: 0,
    },
    amount_due: {
      type: "numeric",
      notNull: true,
      default: 0,
    },
    issuer_snapshot: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'{}'::jsonb`),
    },
    recipient_snapshot: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'{}'::jsonb`),
    },
    source_quote_snapshot: {
      type: "jsonb",
      notNull: false,
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // -------------------------------------------------------------------------
  // 4) quote_lines — remise + updated_at (snapshot_json déjà géré par CP-QUOTE-005)
  // -------------------------------------------------------------------------
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'quote_lines' AND column_name = 'discount_ht'
      ) THEN
        ALTER TABLE quote_lines ADD COLUMN discount_ht numeric NOT NULL DEFAULT 0;
      END IF;
    END $$;
  `);
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'quote_lines' AND column_name = 'updated_at'
      ) THEN
        ALTER TABLE quote_lines ADD COLUMN updated_at timestamptz DEFAULT now();
      END IF;
    END $$;
  `);

  // -------------------------------------------------------------------------
  // 5) invoice_lines — label, discount, snapshot, updated_at
  // -------------------------------------------------------------------------
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invoice_lines' AND column_name = 'label'
      ) THEN
        ALTER TABLE invoice_lines ADD COLUMN label varchar(255);
      END IF;
    END $$;
  `);
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invoice_lines' AND column_name = 'discount_ht'
      ) THEN
        ALTER TABLE invoice_lines ADD COLUMN discount_ht numeric NOT NULL DEFAULT 0;
      END IF;
    END $$;
  `);
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invoice_lines' AND column_name = 'snapshot_json'
      ) THEN
        ALTER TABLE invoice_lines ADD COLUMN snapshot_json jsonb;
      END IF;
    END $$;
  `);
  pgm.sql(`
    UPDATE invoice_lines SET snapshot_json = '{}'::jsonb WHERE snapshot_json IS NULL;
  `);
  pgm.sql(`
    ALTER TABLE invoice_lines ALTER COLUMN snapshot_json SET NOT NULL;
    ALTER TABLE invoice_lines ALTER COLUMN snapshot_json SET DEFAULT '{}'::jsonb;
  `);
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invoice_lines' AND column_name = 'updated_at'
      ) THEN
        ALTER TABLE invoice_lines ADD COLUMN updated_at timestamptz DEFAULT now();
      END IF;
    END $$;
  `);

  // -------------------------------------------------------------------------
  // 6) payments — statut + annulation
  // -------------------------------------------------------------------------
  pgm.addColumn("payments", {
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "RECORDED",
    },
    cancelled_at: { type: "timestamptz" },
    cancelled_by: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // -------------------------------------------------------------------------
  // 7) Backfill statuts + montants (quotes, invoices, payments)
  // -------------------------------------------------------------------------
  pgm.sql(`
    UPDATE quotes SET status = CASE lower(trim(status))
      WHEN 'draft' THEN 'DRAFT'
      WHEN 'sent' THEN 'SENT'
      WHEN 'signed' THEN 'ACCEPTED'
      WHEN 'cancelled' THEN 'CANCELLED'
      ELSE upper(trim(status))
    END;
  `);
  pgm.sql(`
    UPDATE quotes SET status = 'DRAFT' WHERE status IS NULL OR status = '';
  `);

  pgm.sql(`
    UPDATE invoices SET status = CASE lower(trim(status))
      WHEN 'draft' THEN 'DRAFT'
      WHEN 'cancelled' THEN 'CANCELLED'
      ELSE upper(trim(status))
    END;
  `);
  pgm.sql(`
    UPDATE invoices SET status = 'DRAFT' WHERE status IS NULL OR status = '';
  `);
  pgm.sql(`
    UPDATE invoices SET
      issue_date = COALESCE(issue_date, created_at::date),
      total_credited = 0
    WHERE total_credited IS NULL;
  `);
  pgm.sql(`
    UPDATE invoices i
    SET status = 'PAID'
    WHERE i.total_ttc > 0 AND i.total_paid >= i.total_ttc AND i.status = 'DRAFT';
  `);
  pgm.sql(`
    UPDATE invoices i
    SET status = 'PARTIALLY_PAID'
    WHERE i.total_ttc > 0 AND i.total_paid > 0 AND i.total_paid < i.total_ttc AND i.status = 'DRAFT';
  `);
  pgm.sql(`
    UPDATE invoices i
    SET status = 'ISSUED'
    WHERE i.total_ttc > 0 AND i.total_paid = 0 AND i.status = 'DRAFT';
  `);
  pgm.sql(`
    UPDATE invoices i
    SET amount_due = GREATEST(0, round((i.total_ttc - i.total_paid - i.total_credited)::numeric, 2));
  `);
  pgm.sql(`
    UPDATE invoices SET paid_at = created_at
    WHERE status = 'PAID' AND paid_at IS NULL;
  `);

  pgm.sql(`UPDATE payments SET status = 'RECORDED' WHERE status IS NULL;`);

  pgm.sql(`
    UPDATE quotes SET status = 'DRAFT'
    WHERE status NOT IN (
      'DRAFT','READY_TO_SEND','SENT','ACCEPTED','REJECTED','EXPIRED','CANCELLED'
    );
  `);
  pgm.sql(`
    UPDATE invoices SET status = 'DRAFT'
    WHERE status NOT IN ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','CANCELLED');
  `);
  /* Devis « envoyé » sans client : rétrogradation brouillon (intégrité métier) */
  pgm.sql(`
    UPDATE quotes SET status = 'DRAFT', sent_at = NULL
    WHERE client_id IS NULL
      AND status IN ('READY_TO_SEND','SENT','ACCEPTED','REJECTED','EXPIRED');
  `);

  pgm.sql(`ALTER TABLE quotes ALTER COLUMN status SET DEFAULT 'DRAFT';`);
  pgm.sql(`ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'DRAFT';`);

  // -------------------------------------------------------------------------
  // 8) Contraintes CHECK statuts + quotes (client requis si envoyé+)
  // -------------------------------------------------------------------------
  pgm.sql(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_client_or_lead_check;`);
  addConstraintIdempotent(
    pgm,
    "quotes",
    "quotes_client_or_lead_check",
    "CHECK (client_id IS NOT NULL OR lead_id IS NOT NULL)"
  );
  addConstraintIdempotent(
    pgm,
    "quotes",
    "quotes_sent_requires_client_check",
    `CHECK (
      NOT (
        status IN ('READY_TO_SEND','SENT','ACCEPTED','REJECTED','EXPIRED')
        AND client_id IS NULL
      )
    )`
  );
  addConstraintIdempotent(
    pgm,
    "quotes",
    "quotes_status_check",
    `CHECK (
      status IN (
        'DRAFT','READY_TO_SEND','SENT','ACCEPTED','REJECTED','EXPIRED','CANCELLED'
      )
    )`
  );

  addConstraintIdempotent(
    pgm,
    "invoices",
    "invoices_status_check",
    `CHECK (
      status IN ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','CANCELLED')
    )`
  );
  addConstraintIdempotent(
    pgm,
    "invoices",
    "invoices_amounts_non_negative_check",
    `CHECK (
      total_ht >= 0 AND total_vat >= 0 AND total_ttc >= 0
      AND total_paid >= 0 AND total_credited >= 0 AND amount_due >= 0
    )`
  );

  addConstraintIdempotent(
    pgm,
    "payments",
    "payments_status_check",
    "CHECK (status IN ('RECORDED','CANCELLED'))"
  );
  addConstraintIdempotent(
    pgm,
    "payments",
    "payments_amount_positive_check",
    "CHECK (amount > 0)"
  );

  // -------------------------------------------------------------------------
  // 9) credit_notes + credit_note_lines
  // -------------------------------------------------------------------------
  pgm.createTable("credit_notes", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    client_id: {
      type: "uuid",
      notNull: true,
      references: "clients",
      onDelete: "RESTRICT",
    },
    invoice_id: {
      type: "uuid",
      notNull: true,
      references: "invoices",
      onDelete: "RESTRICT",
    },
    credit_note_number: { type: "varchar(100)", notNull: true },
    status: { type: "varchar(20)", notNull: true, default: "DRAFT" },
    currency: { type: "varchar(3)", notNull: true, default: "EUR" },
    issue_date: { type: "date" },
    total_ht: { type: "numeric", notNull: true, default: 0 },
    total_vat: { type: "numeric", notNull: true, default: 0 },
    total_ttc: { type: "numeric", notNull: true, default: 0 },
    reason_code: { type: "varchar(50)" },
    reason_text: { type: "text" },
    issuer_snapshot: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'{}'::jsonb`),
    },
    recipient_snapshot: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'{}'::jsonb`),
    },
    source_invoice_snapshot: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'{}'::jsonb`),
    },
    metadata_json: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'{}'::jsonb`),
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    archived_at: { type: "timestamptz" },
    archived_by: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
  });
  addConstraintIdempotent(
    pgm,
    "credit_notes",
    "credit_notes_unique_number_per_org",
    "UNIQUE (organization_id, credit_note_number)"
  );
  addConstraintIdempotent(
    pgm,
    "credit_notes",
    "credit_notes_status_check",
    "CHECK (status IN ('DRAFT','ISSUED','CANCELLED'))"
  );
  addConstraintIdempotent(
    pgm,
    "credit_notes",
    "credit_notes_totals_non_negative_check",
    "CHECK (total_ht >= 0 AND total_vat >= 0 AND total_ttc >= 0)"
  );
  pgm.createIndex("credit_notes", ["organization_id"]);
  pgm.createIndex("credit_notes", ["client_id"]);
  pgm.createIndex("credit_notes", ["invoice_id"]);
  pgm.createIndex("credit_notes", ["status"]);
  pgm.createIndex("credit_notes", ["archived_at"]);

  pgm.createTable("credit_note_lines", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    credit_note_id: {
      type: "uuid",
      notNull: true,
      references: "credit_notes",
      onDelete: "CASCADE",
    },
    position: { type: "integer", notNull: true },
    label: { type: "varchar(255)" },
    description: { type: "text" },
    quantity: { type: "numeric", notNull: true, default: 1 },
    unit_price_ht: { type: "numeric", notNull: true },
    discount_ht: { type: "numeric", notNull: true, default: 0 },
    vat_rate: { type: "numeric", notNull: true },
    total_line_ht: { type: "numeric", notNull: true },
    total_line_vat: { type: "numeric", notNull: true },
    total_line_ttc: { type: "numeric", notNull: true },
    snapshot_json: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'{}'::jsonb`),
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  addConstraintIdempotent(
    pgm,
    "credit_note_lines",
    "credit_note_lines_position_unique",
    "UNIQUE (credit_note_id, position)"
  );
  addConstraintIdempotent(
    pgm,
    "credit_note_lines",
    "credit_note_lines_qty_non_negative_check",
    "CHECK (quantity >= 0)"
  );
  addConstraintIdempotent(
    pgm,
    "credit_note_lines",
    "credit_note_lines_amounts_non_negative_check",
    `CHECK (
      total_line_ht >= 0 AND total_line_vat >= 0 AND total_line_ttc >= 0
    )`
  );
  pgm.createIndex("credit_note_lines", ["organization_id"]);
  pgm.createIndex("credit_note_lines", ["credit_note_id"]);

  // -------------------------------------------------------------------------
  // 10) invoice_reminders
  // -------------------------------------------------------------------------
  pgm.createTable("invoice_reminders", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    invoice_id: {
      type: "uuid",
      notNull: true,
      references: "invoices",
      onDelete: "CASCADE",
    },
    reminded_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    channel: { type: "varchar(30)", notNull: true, default: "OTHER" },
    note: { type: "text" },
    next_action_at: { type: "timestamptz" },
    created_by: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  addConstraintIdempotent(
    pgm,
    "invoice_reminders",
    "invoice_reminders_channel_check",
    "CHECK (channel IN ('PHONE','EMAIL','LETTER','OTHER'))"
  );
  pgm.createIndex("invoice_reminders", ["organization_id"]);
  pgm.createIndex("invoice_reminders", ["invoice_id"]);
  pgm.createIndex("invoice_reminders", ["next_action_at"]);

  // -------------------------------------------------------------------------
  // 11) Triggers financiers factures (paiements + avoirs)
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_recompute_invoice_total_paid(p_invoice_id uuid)
    RETURNS void AS $$
    DECLARE
      tp numeric;
      tc numeric;
      ttc numeric;
    BEGIN
      SELECT COALESCE(SUM(p.amount), 0) INTO tp
      FROM payments p
      WHERE p.invoice_id = p_invoice_id
        AND (p.status IS NULL OR p.status = 'RECORDED');

      SELECT COALESCE(SUM(cn.total_ttc), 0) INTO tc
      FROM credit_notes cn
      WHERE cn.invoice_id = p_invoice_id
        AND cn.status = 'ISSUED'
        AND cn.archived_at IS NULL;

      SELECT i.total_ttc INTO ttc FROM invoices i WHERE i.id = p_invoice_id;

      UPDATE invoices i
      SET
        total_paid = tp,
        total_credited = tc,
        amount_due = GREATEST(0, round((COALESCE(ttc, 0) - tp - tc)::numeric, 2)),
        updated_at = now()
      WHERE i.id = p_invoice_id;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_credit_notes_sync_invoice_totals()
    RETURNS trigger AS $$
    DECLARE
      inv uuid;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        inv := NEW.invoice_id;
      ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
          PERFORM sg_recompute_invoice_total_paid(OLD.invoice_id);
        END IF;
        inv := NEW.invoice_id;
      ELSIF TG_OP = 'DELETE' THEN
        inv := OLD.invoice_id;
      END IF;
      IF inv IS NOT NULL THEN
        PERFORM sg_recompute_invoice_total_paid(inv);
      END IF;
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS credit_notes_sync_invoice_totals ON credit_notes;
    CREATE TRIGGER credit_notes_sync_invoice_totals
    AFTER INSERT OR UPDATE OR DELETE ON credit_notes
    FOR EACH ROW
    EXECUTE FUNCTION sg_credit_notes_sync_invoice_totals();
  `);

  pgm.sql(`
    UPDATE invoices i SET amount_due = GREATEST(0, round((i.total_ttc - i.total_paid - i.total_credited)::numeric, 2));
  `);

  // -------------------------------------------------------------------------
  // 12) Indexes complémentaires (recherches CRM)
  // -------------------------------------------------------------------------
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_quotes_sent_at ON quotes (sent_at);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_quotes_accepted_at ON quotes (accepted_at);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices (issue_date);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoices_due_date_fin ON invoices (due_date);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoices_amount_due ON invoices (amount_due);`);

  // -------------------------------------------------------------------------
  // 13) entity_documents — types PDF financiers
  // -------------------------------------------------------------------------
  pgm.sql(`ALTER TABLE entity_documents DROP CONSTRAINT IF EXISTS entity_documents_document_type_check;`);
  addConstraintIdempotent(
    pgm,
    "entity_documents",
    "entity_documents_document_type_check",
    `CHECK (
      document_type IS NULL
      OR document_type IN (
        'consumption_csv',
        'lead_attachment',
        'study_attachment',
        'study_pdf',
        'organization_pdf_cover',
        'quote_pdf',
        'invoice_pdf',
        'credit_note_pdf'
      )
    )`
  );
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`ALTER TABLE entity_documents DROP CONSTRAINT IF EXISTS entity_documents_document_type_check;`);
  addConstraintIdempotent(
    pgm,
    "entity_documents",
    "entity_documents_document_type_check",
    `CHECK (
      document_type IS NULL
      OR document_type IN (
        'consumption_csv',
        'lead_attachment',
        'study_attachment',
        'study_pdf',
        'organization_pdf_cover'
      )
    )`
  );

  pgm.sql(`DROP TRIGGER IF EXISTS credit_notes_sync_invoice_totals ON credit_notes;`);
  pgm.sql(`DROP FUNCTION IF EXISTS sg_credit_notes_sync_invoice_totals();`);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_recompute_invoice_total_paid(p_invoice_id uuid)
    RETURNS void AS $$
    BEGIN
      UPDATE invoices i
      SET total_paid = COALESCE((
        SELECT SUM(p.amount)
        FROM payments p
        WHERE p.invoice_id = p_invoice_id
      ), 0)
      WHERE i.id = p_invoice_id;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.dropTable("invoice_reminders", { ifExists: true });
  pgm.dropTable("credit_note_lines", { ifExists: true });
  pgm.dropTable("credit_notes", { ifExists: true });
  pgm.dropTable("document_sequences", { ifExists: true });

  pgm.sql(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_positive_check;`);
  pgm.sql(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;`);
  pgm.dropColumn("payments", "updated_at", { ifExists: true });
  pgm.dropColumn("payments", "cancelled_by", { ifExists: true });
  pgm.dropColumn("payments", "cancelled_at", { ifExists: true });
  pgm.dropColumn("payments", "status", { ifExists: true });

  pgm.sql(`ALTER TABLE invoice_lines DROP COLUMN IF EXISTS updated_at;`);
  pgm.sql(`ALTER TABLE invoice_lines DROP COLUMN IF EXISTS snapshot_json;`);
  pgm.sql(`ALTER TABLE invoice_lines DROP COLUMN IF EXISTS discount_ht;`);
  pgm.sql(`ALTER TABLE invoice_lines DROP COLUMN IF EXISTS label;`);

  pgm.sql(`ALTER TABLE quote_lines DROP COLUMN IF EXISTS updated_at;`);
  pgm.sql(`ALTER TABLE quote_lines DROP COLUMN IF EXISTS discount_ht;`);

  pgm.sql(`ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_amounts_non_negative_check;`);
  pgm.sql(`ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;`);
  pgm.dropColumn("invoices", "updated_at", { ifExists: true });
  pgm.dropColumn("invoices", "source_quote_snapshot", { ifExists: true });
  pgm.dropColumn("invoices", "recipient_snapshot", { ifExists: true });
  pgm.dropColumn("invoices", "issuer_snapshot", { ifExists: true });
  pgm.dropColumn("invoices", "amount_due", { ifExists: true });
  pgm.dropColumn("invoices", "total_credited", { ifExists: true });
  pgm.dropColumn("invoices", "paid_at", { ifExists: true });
  pgm.dropColumn("invoices", "issue_date", { ifExists: true });
  pgm.dropColumn("invoices", "currency", { ifExists: true });

  pgm.sql(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;`);
  pgm.sql(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_sent_requires_client_check;`);
  pgm.sql(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_client_or_lead_check;`);
  addConstraintIdempotent(
    pgm,
    "quotes",
    "quotes_client_or_lead_check",
    "CHECK (client_id IS NOT NULL OR lead_id IS NOT NULL)"
  );

  pgm.dropColumn("quotes", "recipient_snapshot", { ifExists: true });
  pgm.dropColumn("quotes", "issuer_snapshot", { ifExists: true });
  pgm.dropColumn("quotes", "cancelled_at", { ifExists: true });
  pgm.dropColumn("quotes", "rejected_at", { ifExists: true });
  pgm.dropColumn("quotes", "accepted_at", { ifExists: true });
  pgm.dropColumn("quotes", "sent_at", { ifExists: true });
  pgm.dropColumn("quotes", "discount_ht", { ifExists: true });
  pgm.dropColumn("quotes", "currency", { ifExists: true });

  pgm.sql(`DROP INDEX IF EXISTS idx_invoices_amount_due;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_invoices_due_date_fin;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_invoices_issue_date;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_quotes_accepted_at;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_quotes_sent_at;`);

  pgm.sql(`ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'draft';`);
  pgm.sql(`ALTER TABLE quotes ALTER COLUMN status SET DEFAULT 'draft';`);
};
