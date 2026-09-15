-- REVIEW ONLY. Exact statements used by the one-off service. No standalone execution.
-- Preconditions and receipt/fsync are implemented in JS; every mismatch must stop.
-- Apply: BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE; dry run: READ ONLY.
-- SET LOCAL search_path TO pg_catalog, public; statement_timeout 15s; lock_timeout 1s.

-- identity
SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port, current_setting('server_version_num')::int AS version;

-- lock
SELECT migration_name, checksum, checksum_normalized FROM public.migration_checksums WHERE migration_name=$1 FOR UPDATE NOWAIT;

-- applied
SELECT COALESCE(json_agg(to_jsonb(m) ORDER BY id),'[]') AS rows FROM public.pgmigrations m;

-- checksums
SELECT COALESCE(json_agg(to_jsonb(m) ORDER BY migration_name),'[]') AS rows FROM public.migration_checksums m;

-- data
WITH expected AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(slug text,name text,sort_order integer)),
    expected_rows AS (SELECT o.id AS organization_id,e.* FROM public.organizations o CROSS JOIN expected e)
    SELECT
    (SELECT count(*)::int FROM expected_rows e LEFT JOIN public.lead_sources s ON s.organization_id=e.organization_id AND s.slug=e.slug WHERE s.id IS NULL OR s.name IS DISTINCT FROM e.name OR s.sort_order IS DISTINCT FROM e.sort_order) AS missing_or_changed,
    (SELECT count(*)::int FROM public.lead_sources s LEFT JOIN expected_rows e ON s.organization_id=e.organization_id AND s.slug=e.slug WHERE e.slug IS NULL OR s.id IS NULL OR s.created_at IS NULL) AS unexpected,
    (SELECT count(*)::int FROM (SELECT organization_id,slug FROM public.lead_sources GROUP BY organization_id,slug HAVING count(*)<>1) d) AS duplicates,
    (SELECT count(*)::int FROM public.leads l LEFT JOIN public.lead_sources s ON s.id=l.source_id WHERE s.id IS NULL OR l.organization_id IS DISTINCT FROM s.organization_id) AS bad_references,
    (SELECT count(*)::int FROM public.lead_sources) AS sources;

-- safety
SELECT c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
    (SELECT count(*)::int FROM pg_rewrite r WHERE r.ev_class=c.oid) AS rules,
    CASE WHEN c.relname IN ('pgmigrations','migration_checksums') THEN (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) ELSE 0 END AS metadata_triggers
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('lead_sources','leads','organizations','pgmigrations','migration_checksums') ORDER BY c.relname;

-- update
UPDATE public.migration_checksums SET checksum=$2, checksum_normalized=$3
    WHERE migration_name=$1 AND checksum=$4 AND checksum_normalized=$5
    RETURNING migration_name, checksum, checksum_normalized;

-- columns
SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_value,a.attgenerated AS generated,a.attidentity AS identity FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.lead_sources'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum;

-- constraints
SELECT c.conrelid::regclass::text AS relation,c.conname AS name,pg_get_constraintdef(c.oid) AS definition,c.convalidated AS validated,c.condeferrable AS deferrable,c.condeferred AS deferred FROM pg_constraint c WHERE c.conrelid='public.lead_sources'::regclass OR c.confrelid='public.lead_sources'::regclass ORDER BY relation,name;

-- indexes
SELECT c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,i.indisready AS ready,i.indisunique AS is_unique,i.indimmediate AS immediate FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.lead_sources'::regclass ORDER BY c.relname;

-- triggers
SELECT t.tgrelid::regclass::text AS relation,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition,t.tgenabled AS enabled FROM pg_trigger t WHERE NOT t.tgisinternal AND (t.tgrelid='public.lead_sources'::regclass OR t.tgname='trg_fill_lead_source_id') ORDER BY relation,name;

-- functions
SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('sg_fill_lead_source_id','sg_fill_lead_source_defaults','sg_slugify_lead_source_name') ORDER BY p.proname;

-- column_reference
SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null FROM pg_attribute a WHERE a.attrelid='public.leads'::regclass AND a.attname IN ('source_id','organization_id') ORDER BY a.attname;

-- metadata_triggers
SELECT t.tgname AS name FROM pg_trigger t WHERE t.tgrelid='public.migration_checksums'::regclass AND NOT t.tgisinternal ORDER BY t.tgname;

-- metadata_columns
SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid IN ('public.migration_checksums'::regclass,'public.pgmigrations'::regclass) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum;

-- metadata_constraints
SELECT c.conrelid::regclass::text AS relation,c.conname,pg_get_constraintdef(c.oid) AS definition,c.convalidated,c.condeferrable,c.condeferred FROM pg_constraint c WHERE c.conrelid IN ('public.migration_checksums'::regclass,'public.pgmigrations'::regclass) OR c.confrelid IN ('public.migration_checksums'::regclass,'public.pgmigrations'::regclass) ORDER BY relation,conname;

-- metadata_indexes
SELECT i.indrelid::regclass::text AS relation,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid,i.indisready,i.indisunique FROM pg_index i WHERE i.indrelid IN ('public.migration_checksums'::regclass,'public.pgmigrations'::regclass) ORDER BY relation,definition;

-- Apply COMMIT only after whole postcheck; otherwise ROLLBACK.
