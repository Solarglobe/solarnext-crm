export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE mail_attachments
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

    CREATE OR REPLACE FUNCTION sg_mail_attachments_set_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_mail_attachments_updated_at ON mail_attachments;
    CREATE TRIGGER trg_mail_attachments_updated_at
    BEFORE UPDATE ON mail_attachments
    FOR EACH ROW EXECUTE FUNCTION sg_mail_attachments_set_updated_at();
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_mail_attachments_updated_at ON mail_attachments;
    DROP FUNCTION IF EXISTS sg_mail_attachments_set_updated_at();
    ALTER TABLE mail_attachments DROP COLUMN IF EXISTS updated_at;
  `);
};
