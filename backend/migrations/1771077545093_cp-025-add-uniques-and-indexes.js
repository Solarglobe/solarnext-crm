/**
 * CP-025
 * Add missing uniqueness + index (non-destructive)
 * - UNIQUE (organization_id, client_number) on clients
 * - UNIQUE (organization_id, study_number) on studies (only if column exists)
 * - INDEX on invoices.quote_id (only if column exists)
 *
 * Safety:
 * - If duplicates exist, migration must FAIL with a clear error message.
 */

export async function up(pgm) {
  // 1) clients: UNIQUE (organization_id, client_number)
  // Guard: fail if duplicates exist
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM clients
        WHERE client_number IS NOT NULL
        GROUP BY organization_id, client_number
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION 'CP-025 FAILED: duplicates found in clients (organization_id, client_number). Fix duplicates before adding UNIQUE constraint.';
      END IF;
    END $$;
  `);

  // Add constraint only if not exists
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'clients_unique_client_number_per_org'
      ) THEN
        ALTER TABLE clients
          ADD CONSTRAINT clients_unique_client_number_per_org
          UNIQUE (organization_id, client_number);
      END IF;
    END $$;
  `);

  // 2) studies: UNIQUE (organization_id, study_number)
  // Only if column study_number exists
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'studies'
          AND column_name = 'study_number'
      ) THEN

        IF EXISTS (
          SELECT 1
          FROM studies
          WHERE study_number IS NOT NULL
          GROUP BY organization_id, study_number
          HAVING COUNT(*) > 1
        ) THEN
          RAISE EXCEPTION 'CP-025 FAILED: duplicates found in studies (organization_id, study_number). Fix duplicates before adding UNIQUE constraint.';
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'studies_unique_study_number_per_org'
        ) THEN
          ALTER TABLE studies
            ADD CONSTRAINT studies_unique_study_number_per_org
            UNIQUE (organization_id, study_number);
        END IF;

      END IF;
    END $$;
  `);

  // 3) invoices: missing index on quote_id
  // Only if column exists (it should) and index not already present
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'invoices'
          AND column_name = 'quote_id'
      ) THEN

        IF NOT EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'invoices'
            AND indexname = 'invoices_quote_id_index'
        ) THEN
          CREATE INDEX invoices_quote_id_index ON invoices (quote_id);
        END IF;

      END IF;
    END $$;
  `);
}

export async function down(pgm) {
  // Down must be safe and reversible

  // Drop invoices.quote_id index if exists
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'invoices'
          AND indexname = 'invoices_quote_id_index'
      ) THEN
        DROP INDEX invoices_quote_id_index;
      END IF;
    END $$;
  `);

  // Drop studies constraint if exists
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'studies_unique_study_number_per_org'
      ) THEN
        ALTER TABLE studies
          DROP CONSTRAINT studies_unique_study_number_per_org;
      END IF;
    END $$;
  `);

  // Drop clients constraint if exists
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'clients_unique_client_number_per_org'
      ) THEN
        ALTER TABLE clients
          DROP CONSTRAINT clients_unique_client_number_per_org;
      END IF;
    END $$;
  `);
}
