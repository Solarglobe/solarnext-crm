--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: entity_document_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.entity_document_category AS ENUM (
    'QUOTE',
    'INVOICE',
    'COMMERCIAL_PROPOSAL',
    'DP_MAIRIE',
    'ADMINISTRATIVE',
    'OTHER',
    'DP'
);


--
-- Name: entity_document_source_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.entity_document_source_type AS ENUM (
    'SYSTEM_GENERATED',
    'MANUAL_UPLOAD'
);


--
-- Name: mail_folder_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mail_folder_type AS ENUM (
    'INBOX',
    'SENT',
    'DRAFT',
    'TRASH',
    'CUSTOM'
);


--
-- Name: mail_message_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mail_message_direction AS ENUM (
    'INBOUND',
    'OUTBOUND'
);


--
-- Name: mail_message_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mail_message_status AS ENUM (
    'RECEIVED',
    'SENT',
    'FAILED',
    'DRAFT',
    'QUEUED',
    'SENDING'
);


--
-- Name: mail_outbox_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mail_outbox_status AS ENUM (
    'queued',
    'sending',
    'sent',
    'retrying',
    'failed',
    'cancelled'
);


--
-- Name: mail_participant_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mail_participant_type AS ENUM (
    'FROM',
    'TO',
    'CC',
    'BCC'
);


--
-- Name: quote_catalog_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quote_catalog_category AS ENUM (
    'PANEL',
    'INVERTER',
    'MOUNTING',
    'CABLE',
    'INSTALL',
    'SERVICE',
    'BATTERY_PHYSICAL',
    'BATTERY_VIRTUAL',
    'DISCOUNT',
    'OTHER',
    'PACK',
    'PROTECTION_BOX'
);


--
-- Name: quote_catalog_pricing_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quote_catalog_pricing_mode AS ENUM (
    'FIXED',
    'UNIT',
    'PERCENT_TOTAL'
);


--
-- Name: quote_text_template_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quote_text_template_kind AS ENUM (
    'commercial_notes',
    'technical_details',
    'payment_terms'
);


--
-- Name: cp_admin_struct_02_check_user_agency_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cp_admin_struct_02_check_user_agency_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      u_org uuid;
      a_org uuid;
    BEGIN
      SELECT organization_id INTO u_org FROM users WHERE id = NEW.user_id;
      SELECT organization_id INTO a_org FROM agencies WHERE id = NEW.agency_id;
      IF u_org IS NULL OR a_org IS NULL OR u_org != a_org THEN
        RAISE EXCEPTION 'user_agency: user et agency doivent appartenir ├á la m├¬me organisation (cross-org interdit)';
      END IF;
      NEW.organization_id := u_org;
      RETURN NEW;
    END;
    $$;


--
-- Name: cp_admin_struct_02_check_user_team_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cp_admin_struct_02_check_user_team_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      u_org uuid;
      t_org uuid;
    BEGIN
      SELECT organization_id INTO u_org FROM users WHERE id = NEW.user_id;
      SELECT organization_id INTO t_org FROM teams WHERE id = NEW.team_id;
      IF u_org IS NULL OR t_org IS NULL OR u_org != t_org THEN
        RAISE EXCEPTION 'user_team: user et team doivent appartenir ├á la m├¬me organisation (cross-org interdit)';
      END IF;
      NEW.organization_id := u_org;
      RETURN NEW;
    END;
    $$;


--
-- Name: mail_messages_rebuild_search_vector(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mail_messages_rebuild_search_vector(p_msg_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
      subj text;
      btxt text;
      pemails text;
    BEGIN
      SELECT m.subject, m.body_text INTO subj, btxt
      FROM mail_messages m WHERE m.id = p_msg_id;
      IF NOT FOUND THEN
        RETURN;
      END IF;
      SELECT COALESCE(string_agg(lower(mp.email) || ' ' || COALESCE(lower(trim(mp.name)), ''), ' '), '')
      INTO pemails
      FROM mail_participants mp
      WHERE mp.mail_message_id = p_msg_id;

      UPDATE mail_messages
      SET search_vector = to_tsvector(
        'simple',
        coalesce(subj, '') || ' ' ||
        coalesce(btxt, '') || ' ' ||
        coalesce(pemails, '')
      )
      WHERE id = p_msg_id;
    END;
    $$;


--
-- Name: mail_messages_search_vector_biu(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mail_messages_search_vector_biu() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      pemails text;
    BEGIN
      SELECT COALESCE(string_agg(lower(mp.email) || ' ' || COALESCE(lower(trim(mp.name)), ''), ' '), '')
      INTO pemails
      FROM mail_participants mp
      WHERE mp.mail_message_id = NEW.id;

      NEW.search_vector := to_tsvector(
        'simple',
        coalesce(NEW.subject, '') || ' ' ||
        coalesce(NEW.body_text, '') || ' ' ||
        coalesce(pemails, '')
      );
      RETURN NEW;
    END;
    $$;


--
-- Name: mail_participants_refresh_message_tsv(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mail_participants_refresh_message_tsv() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      mid uuid;
    BEGIN
      mid := COALESCE(NEW.mail_message_id, OLD.mail_message_id);
      IF mid IS NOT NULL THEN
        PERFORM mail_messages_rebuild_search_vector(mid);
      END IF;
      RETURN NULL;
    END;
    $$;


--
-- Name: prevent_audit_logs_modification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_audit_logs_modification() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'audit_logs table is immutable';
    END;
    $$;


--
-- Name: sg_credit_notes_sync_invoice_totals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_credit_notes_sync_invoice_totals() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
    $$;


--
-- Name: sg_mail_account_permissions_validate_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_mail_account_permissions_validate_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE acc_org uuid; u_org uuid;
    BEGIN
      SELECT organization_id INTO acc_org FROM mail_accounts WHERE id = NEW.mail_account_id;
      IF acc_org IS NULL THEN RAISE EXCEPTION 'mail_account_permissions: mail_account_id invalide'; END IF;
      IF acc_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_account_permissions: organization_id ne correspond pas au compte mail';
      END IF;

      SELECT organization_id INTO u_org FROM users WHERE id = NEW.user_id;
      IF u_org IS NULL THEN RAISE EXCEPTION 'mail_account_permissions: user_id invalide'; END IF;
      IF u_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_account_permissions: user hors organisation';
      END IF;

      RETURN NEW;
    END;
    $$;


--
-- Name: sg_mail_attachments_validate_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_mail_attachments_validate_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE m_org uuid;
    BEGIN
      SELECT organization_id INTO m_org FROM mail_messages WHERE id = NEW.mail_message_id;
      IF m_org IS NULL THEN RAISE EXCEPTION 'mail_attachments: mail_message_id invalide'; END IF;
      IF m_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_attachments: organization_id ne correspond pas au message';
      END IF;
      RETURN NEW;
    END;
    $$;


--
-- Name: sg_mail_folders_validate_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_mail_folders_validate_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE acc_org uuid;
    BEGIN
      SELECT organization_id INTO acc_org FROM mail_accounts WHERE id = NEW.mail_account_id;
      IF acc_org IS NULL THEN RAISE EXCEPTION 'mail_folders: mail_account_id invalide'; END IF;
      IF acc_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_folders: organization_id ne correspond pas au compte mail';
      END IF;
      RETURN NEW;
    END;
    $$;


--
-- Name: sg_mail_messages_validate_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_mail_messages_validate_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE t_org uuid; a_org uuid;
    BEGIN
      SELECT organization_id INTO t_org FROM mail_threads WHERE id = NEW.mail_thread_id;
      IF t_org IS NULL THEN RAISE EXCEPTION 'mail_messages: mail_thread_id invalide'; END IF;
      IF t_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_messages: organization_id ne correspond pas au fil';
      END IF;

      SELECT organization_id INTO a_org FROM mail_accounts WHERE id = NEW.mail_account_id;
      IF a_org IS NULL THEN RAISE EXCEPTION 'mail_messages: mail_account_id invalide'; END IF;
      IF a_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_messages: organization_id ne correspond pas au compte mail';
      END IF;

      IF NEW.folder_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM mail_folders f
          WHERE f.id = NEW.folder_id
            AND f.organization_id = NEW.organization_id
            AND f.mail_account_id = NEW.mail_account_id
        ) THEN
          RAISE EXCEPTION 'mail_messages: dossier incoh├®rent avec compte ou organisation';
        END IF;
      END IF;

      IF NEW.client_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM clients c
          WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id
        ) THEN
          RAISE EXCEPTION 'mail_messages: client_id incoh├®rent avec l''organisation';
        END IF;
      END IF;

      IF NEW.lead_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM leads l
          WHERE l.id = NEW.lead_id AND l.organization_id = NEW.organization_id
        ) THEN
          RAISE EXCEPTION 'mail_messages: lead_id incoh├®rent avec l''organisation';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$;


--
-- Name: sg_mail_participants_set_email_normalized(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_mail_participants_set_email_normalized() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.email IS NOT NULL THEN
        NEW.email_normalized := LOWER(TRIM(NEW.email));
      ELSE
        NEW.email_normalized := NULL;
      END IF;
      RETURN NEW;
    END;
    $$;


--
-- Name: sg_mail_participants_validate_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_mail_participants_validate_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE m_org uuid;
    BEGIN
      SELECT organization_id INTO m_org FROM mail_messages WHERE id = NEW.mail_message_id;
      IF m_org IS NULL THEN RAISE EXCEPTION 'mail_participants: mail_message_id invalide'; END IF;
      IF m_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_participants: organization_id ne correspond pas au message';
      END IF;
      RETURN NEW;
    END;
    $$;


--
-- Name: sg_mail_signatures_validate_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_mail_signatures_validate_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE ma_org uuid; u_org uuid;
    BEGIN
      IF NEW.mail_account_id IS NOT NULL THEN
        SELECT organization_id INTO ma_org FROM mail_accounts WHERE id = NEW.mail_account_id;
        IF ma_org IS NULL THEN RAISE EXCEPTION 'mail_signatures: mail_account_id invalide'; END IF;
        IF ma_org <> NEW.organization_id THEN
          RAISE EXCEPTION 'mail_signatures: organization_id ne correspond pas au compte mail';
        END IF;
      END IF;

      IF NEW.user_id IS NOT NULL THEN
        SELECT organization_id INTO u_org FROM users WHERE id = NEW.user_id;
        IF u_org IS NULL THEN RAISE EXCEPTION 'mail_signatures: user_id invalide'; END IF;
        IF u_org <> NEW.organization_id THEN
          RAISE EXCEPTION 'mail_signatures: organization_id ne correspond pas ├á l''utilisateur';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$;


--
-- Name: sg_mail_templates_validate_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_mail_templates_validate_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE u_org uuid;
    BEGIN
      IF NEW.user_id IS NOT NULL THEN
        SELECT organization_id INTO u_org FROM users WHERE id = NEW.user_id;
        IF u_org IS NULL THEN RAISE EXCEPTION 'mail_templates: user_id invalide'; END IF;
        IF u_org <> NEW.organization_id THEN
          RAISE EXCEPTION 'mail_templates: organization_id ne correspond pas ├á l''utilisateur';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;


--
-- Name: sg_mail_thread_notes_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_mail_thread_notes_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$;


--
-- Name: sg_mail_tracking_events_validate_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_mail_tracking_events_validate_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE m_org uuid;
    BEGIN
      SELECT organization_id INTO m_org FROM mail_messages WHERE id = NEW.mail_message_id;
      IF m_org IS NULL THEN RAISE EXCEPTION 'mail_tracking_events: mail_message_id invalide'; END IF;
      IF m_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_tracking_events: organization_id incoh├®rent';
      END IF;
      RETURN NEW;
    END;
    $$;


--
-- Name: sg_organizations_after_insert_seed_pipeline(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_organizations_after_insert_seed_pipeline() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM sg_seed_default_pipeline_for_org(NEW.id);
      RETURN NEW;
    END;
    $$;


--
-- Name: sg_organizations_after_insert_seed_rbac(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_organizations_after_insert_seed_rbac() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM sg_seed_rbac_roles_for_org(NEW.id);
      RETURN NEW;
    END;
    $$;


--
-- Name: sg_payments_sync_total_paid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_payments_sync_total_paid() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        PERFORM sg_recompute_invoice_total_paid(NEW.invoice_id);
        RETURN NEW;
      ELSIF TG_OP = 'UPDATE' THEN
        -- if invoice_id changed, recompute both
        IF NEW.invoice_id <> OLD.invoice_id THEN
          PERFORM sg_recompute_invoice_total_paid(OLD.invoice_id);
        END IF;
        PERFORM sg_recompute_invoice_total_paid(NEW.invoice_id);
        RETURN NEW;
      ELSIF TG_OP = 'DELETE' THEN
        PERFORM sg_recompute_invoice_total_paid(OLD.invoice_id);
        RETURN OLD;
      END IF;

      RETURN NULL;
    END;
    $$;


--
-- Name: sg_recompute_invoice_total_paid(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_recompute_invoice_total_paid(p_invoice_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
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
    $$;


--
-- Name: sg_seed_default_pipeline_for_org(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_seed_default_pipeline_for_org(p_org_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      -- only seed if organization has zero stages
      IF EXISTS (SELECT 1 FROM pipeline_stages WHERE organization_id = p_org_id) THEN
        RETURN;
      END IF;

      INSERT INTO pipeline_stages (id, organization_id, name, position, is_closed)
      VALUES
        (gen_random_uuid(), p_org_id, 'Nouveau Lead', 1, false),
        (gen_random_uuid(), p_org_id, 'Contact├®', 2, false),
        (gen_random_uuid(), p_org_id, 'RDV Planifi├®', 3, false),
        (gen_random_uuid(), p_org_id, 'Offre Envoy├®e', 4, false),
        (gen_random_uuid(), p_org_id, 'Sign├®', 5, false),
        (gen_random_uuid(), p_org_id, 'Perdu', 6, true);
    END;
    $$;


--
-- Name: sg_seed_rbac_roles_for_org(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_seed_rbac_roles_for_org(p_org_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
      sys_rec RECORD;
      org_role_id uuid;
    BEGIN
      FOR sys_rec IN SELECT id, code, name FROM rbac_roles WHERE organization_id IS NULL
      LOOP
        INSERT INTO rbac_roles (organization_id, code, name, is_system)
        VALUES (p_org_id, sys_rec.code, sys_rec.name, false)
        ON CONFLICT ((COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)), code) DO NOTHING;

        SELECT id INTO org_role_id FROM rbac_roles WHERE organization_id = p_org_id AND code = sys_rec.code LIMIT 1;

        INSERT INTO rbac_role_permissions (role_id, permission_id)
        SELECT org_role_id, permission_id FROM rbac_role_permissions WHERE role_id = sys_rec.id
        ON CONFLICT (role_id, permission_id) DO NOTHING;
      END LOOP;
    END;
    $$;


--
-- Name: sg_validate_lead_stage_history_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_validate_lead_stage_history_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      lead_org uuid;
      to_org uuid;
      from_org uuid;
    BEGIN
      SELECT l.organization_id INTO lead_org
      FROM leads l
      WHERE l.id = NEW.lead_id;

      IF lead_org IS NULL THEN
        RAISE EXCEPTION 'Invalid lead_id: %', NEW.lead_id;
      END IF;

      -- to_stage must exist and match lead org
      SELECT organization_id INTO to_org
      FROM pipeline_stages
      WHERE id = NEW.to_stage_id;

      IF to_org IS NULL THEN
        RAISE EXCEPTION 'Invalid to_stage_id: %', NEW.to_stage_id;
      END IF;

      IF to_org <> lead_org THEN
        RAISE EXCEPTION 'Cross-org to_stage not allowed. lead.org=% to_stage.org=%', lead_org, to_org;
      END IF;

      -- from_stage optional but if present must match lead org
      IF NEW.from_stage_id IS NOT NULL THEN
        SELECT organization_id INTO from_org
        FROM pipeline_stages
        WHERE id = NEW.from_stage_id;

        IF from_org IS NULL THEN
          RAISE EXCEPTION 'Invalid from_stage_id: %', NEW.from_stage_id;
        END IF;

        IF from_org <> lead_org THEN
          RAISE EXCEPTION 'Cross-org from_stage not allowed. lead.org=% from_stage.org=%', lead_org, from_org;
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$;


--
-- Name: sg_validate_lead_stage_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sg_validate_lead_stage_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      stage_org uuid;
    BEGIN
      IF NEW.stage_id IS NULL THEN
        RAISE EXCEPTION 'leads.stage_id cannot be NULL';
      END IF;

      SELECT organization_id INTO stage_org
      FROM pipeline_stages
      WHERE id = NEW.stage_id;

      IF stage_org IS NULL THEN
        RAISE EXCEPTION 'Invalid stage_id: %', NEW.stage_id;
      END IF;

      IF stage_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'Cross-org stage not allowed. lead.org=% stage.org=%', NEW.organization_id, stage_org;
      END IF;

      RETURN NEW;
    END;
    $$;


--
-- Name: trg_quote_lines_catalog_item_id_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_quote_lines_catalog_item_id_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.catalog_item_id IS DISTINCT FROM NEW.catalog_item_id THEN
        RAISE EXCEPTION 'CP-QUOTE-005: catalog_item_id is immutable on quote_lines'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    label character varying(80),
    address_line1 character varying(255),
    address_line2 character varying(255),
    postal_code character varying(20),
    city character varying(150),
    country_code character(2) DEFAULT 'FR'::bpchar NOT NULL,
    formatted_address text,
    lat numeric(10,7),
    lon numeric(10,7),
    geo_provider character varying(50),
    geo_place_id character varying(255),
    geo_source character varying(50),
    geo_precision_level character varying(50),
    geo_confidence smallint,
    geo_bbox jsonb,
    geo_updated_at timestamp with time zone,
    is_geo_verified boolean DEFAULT false NOT NULL,
    geo_verification_method character varying(50),
    geo_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT addresses_geo_confidence_range CHECK (((geo_confidence IS NULL) OR ((geo_confidence >= 0) AND (geo_confidence <= 100)))),
    CONSTRAINT addresses_geo_precision_level_values CHECK (((geo_precision_level IS NULL) OR ((geo_precision_level)::text = ANY ((ARRAY['UNKNOWN'::character varying, 'COUNTRY'::character varying, 'CITY'::character varying, 'POSTAL_CODE'::character varying, 'STREET'::character varying, 'HOUSE_NUMBER_INTERPOLATED'::character varying, 'ROOFTOP_BUILDING'::character varying, 'MANUAL_PIN_BUILDING'::character varying])::text[])))),
    CONSTRAINT addresses_lat_range CHECK (((lat IS NULL) OR ((lat >= ('-90'::integer)::numeric) AND (lat <= (90)::numeric)))),
    CONSTRAINT addresses_lon_range CHECK (((lon IS NULL) OR ((lon >= ('-180'::integer)::numeric) AND (lon <= (180)::numeric)))),
    CONSTRAINT addresses_rooftop_pin_requires_coords CHECK ((((geo_precision_level)::text <> ALL ((ARRAY['ROOFTOP_BUILDING'::character varying, 'MANUAL_PIN_BUILDING'::character varying])::text[])) OR ((lat IS NOT NULL) AND (lon IS NOT NULL))))
);


--
-- Name: agencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agencies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(150) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.articles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    category character varying(150),
    buy_price numeric NOT NULL,
    sell_price numeric NOT NULL,
    vat_rate numeric DEFAULT 20 NOT NULL,
    unit character varying(50) DEFAULT 'unit'::character varying,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    user_id uuid,
    action character varying(150) NOT NULL,
    entity_type character varying(150) NOT NULL,
    entity_id uuid,
    before_hash character varying(128),
    after_hash character varying(128),
    ip_address character varying(100),
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_label character varying(500),
    request_id character varying(100),
    method character varying(16),
    route text,
    user_agent character varying(1024),
    status_code smallint
);


--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    all_day boolean DEFAULT false NOT NULL,
    client_id uuid,
    study_version_id uuid,
    user_id uuid,
    label_id uuid,
    location character varying(255),
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid
);


--
-- Name: calpinage_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calpinage_data (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    study_version_id uuid NOT NULL,
    geometry_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    total_panels integer,
    total_power_kwc numeric,
    annual_production_kwh numeric,
    total_loss_pct numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: calpinage_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calpinage_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    study_id uuid NOT NULL,
    study_version_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    version_number integer NOT NULL,
    snapshot_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT calpinage_snapshots_snapshot_json_not_null CHECK ((snapshot_json IS NOT NULL))
);


--
-- Name: client_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    client_id uuid NOT NULL,
    contact_type character varying(50) NOT NULL,
    first_name character varying(150),
    last_name character varying(150),
    email character varying(255),
    phone character varying(50),
    mobile character varying(50),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: client_portal_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_portal_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    token_secret text
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    client_number character varying(50) NOT NULL,
    company_name character varying(255),
    first_name character varying(150),
    last_name character varying(150),
    email character varying(255),
    phone character varying(50),
    mobile character varying(50),
    address_line_1 character varying(255),
    address_line_2 character varying(255),
    postal_code character varying(20),
    city character varying(150),
    country character varying(100) DEFAULT 'France'::character varying,
    installation_address_line_1 character varying(255),
    installation_postal_code character varying(20),
    installation_city character varying(150),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    agency_id uuid,
    siret character varying(20),
    birth_date date,
    company_domain text,
    rgpd_consent boolean DEFAULT false NOT NULL,
    rgpd_consent_at timestamp with time zone,
    marketing_opt_in boolean DEFAULT false NOT NULL,
    marketing_opt_in_at timestamp with time zone
);


--
-- Name: credit_note_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_note_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    credit_note_id uuid NOT NULL,
    "position" integer NOT NULL,
    label character varying(255),
    description text,
    quantity numeric DEFAULT 1 NOT NULL,
    unit_price_ht numeric NOT NULL,
    discount_ht numeric DEFAULT 0 NOT NULL,
    vat_rate numeric NOT NULL,
    total_line_ht numeric NOT NULL,
    total_line_vat numeric NOT NULL,
    total_line_ttc numeric NOT NULL,
    snapshot_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credit_note_lines_amounts_non_negative_check CHECK (((total_line_ht >= (0)::numeric) AND (total_line_vat >= (0)::numeric) AND (total_line_ttc >= (0)::numeric))),
    CONSTRAINT credit_note_lines_qty_non_negative_check CHECK ((quantity >= (0)::numeric))
);


--
-- Name: credit_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    client_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    credit_note_number character varying(100) NOT NULL,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    currency character varying(3) DEFAULT 'EUR'::character varying NOT NULL,
    issue_date date,
    total_ht numeric DEFAULT 0 NOT NULL,
    total_vat numeric DEFAULT 0 NOT NULL,
    total_ttc numeric DEFAULT 0 NOT NULL,
    reason_code character varying(50),
    reason_text text,
    issuer_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    recipient_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_invoice_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    document_snapshot_json jsonb,
    CONSTRAINT credit_notes_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'ISSUED'::character varying, 'CANCELLED'::character varying])::text[]))),
    CONSTRAINT credit_notes_totals_non_negative_check CHECK (((total_ht >= (0)::numeric) AND (total_vat >= (0)::numeric) AND (total_ttc >= (0)::numeric)))
);


--
-- Name: document_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_sequences (
    organization_id uuid NOT NULL,
    document_kind character varying(20) NOT NULL,
    year integer NOT NULL,
    last_value integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_sequences_kind_check CHECK (((document_kind)::text = ANY ((ARRAY['QUOTE'::character varying, 'INVOICE'::character varying, 'CREDIT_NOTE'::character varying])::text[]))),
    CONSTRAINT document_sequences_year_check CHECK (((year >= 2000) AND (year <= 2100)))
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    study_version_id uuid,
    client_id uuid,
    document_type character varying(100) NOT NULL,
    storage_provider character varying(50) DEFAULT 'infomaniak'::character varying NOT NULL,
    file_name character varying(255) NOT NULL,
    file_url text NOT NULL,
    file_path text,
    version_number integer DEFAULT 1,
    tags jsonb DEFAULT '[]'::jsonb,
    metadata_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: economic_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.economic_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    study_id uuid NOT NULL,
    study_version_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    version_number integer NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    config_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT economic_snapshots_config_json_not_null CHECK ((config_json IS NOT NULL))
);


--
-- Name: email_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid,
    email_address character varying(255) NOT NULL,
    imap_host character varying(255) NOT NULL,
    imap_port integer NOT NULL,
    imap_secure boolean DEFAULT true NOT NULL,
    smtp_host character varying(255),
    smtp_port integer,
    smtp_secure boolean DEFAULT true,
    encrypted_password text NOT NULL,
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    email_id uuid NOT NULL,
    file_name character varying(255) NOT NULL,
    file_size integer,
    mime_type character varying(255),
    storage_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    email_account_id uuid NOT NULL,
    client_id uuid,
    message_id character varying(500),
    subject character varying(500),
    from_address character varying(255),
    to_addresses jsonb DEFAULT '[]'::jsonb NOT NULL,
    cc_addresses jsonb DEFAULT '[]'::jsonb,
    bcc_addresses jsonb DEFAULT '[]'::jsonb,
    body_text text,
    body_html text,
    direction character varying(20) NOT NULL,
    status character varying(50),
    sent_at timestamp with time zone,
    received_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: entity_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    entity_type character varying(20) NOT NULL,
    entity_id uuid NOT NULL,
    file_name character varying(255) NOT NULL,
    file_size bigint NOT NULL,
    mime_type character varying(100) NOT NULL,
    storage_key text NOT NULL,
    url text NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    document_type text,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    document_category public.entity_document_category,
    source_type public.entity_document_source_type,
    is_client_visible boolean DEFAULT false NOT NULL,
    display_name text,
    description text,
    CONSTRAINT entity_documents_document_type_check CHECK (((document_type IS NULL) OR (document_type = ANY (ARRAY['consumption_csv'::text, 'lead_attachment'::text, 'study_attachment'::text, 'study_pdf'::text, 'organization_pdf_cover'::text, 'organization_legal_cgv'::text, 'organization_legal_rge'::text, 'organization_legal_decennale'::text, 'quote_pdf'::text, 'quote_pdf_signed'::text, 'quote_signature_client'::text, 'quote_signature_company'::text, 'invoice_pdf'::text, 'credit_note_pdf'::text, 'dp_pdf'::text, 'mail_attachment'::text]))))
);


--
-- Name: event_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_labels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(150) NOT NULL,
    color character varying(20) NOT NULL,
    category character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invoice_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    article_id uuid,
    description text NOT NULL,
    quantity numeric DEFAULT 1 NOT NULL,
    unit_price_ht numeric NOT NULL,
    vat_rate numeric NOT NULL,
    total_line_ht numeric NOT NULL,
    total_line_vat numeric NOT NULL,
    total_line_ttc numeric NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    label character varying(255),
    discount_ht numeric DEFAULT 0 NOT NULL,
    snapshot_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: invoice_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    reminded_at timestamp with time zone DEFAULT now() NOT NULL,
    channel character varying(30) DEFAULT 'OTHER'::character varying NOT NULL,
    note text,
    next_action_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_reminders_channel_check CHECK (((channel)::text = ANY ((ARRAY['PHONE'::character varying, 'EMAIL'::character varying, 'LETTER'::character varying, 'OTHER'::character varying])::text[])))
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    client_id uuid NOT NULL,
    quote_id uuid,
    invoice_number character varying(100) NOT NULL,
    status character varying(50) DEFAULT 'DRAFT'::character varying NOT NULL,
    total_ht numeric DEFAULT 0 NOT NULL,
    total_vat numeric DEFAULT 0 NOT NULL,
    total_ttc numeric DEFAULT 0 NOT NULL,
    total_paid numeric DEFAULT 0 NOT NULL,
    due_date date,
    notes text,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    currency character varying(3) DEFAULT 'EUR'::character varying NOT NULL,
    issue_date date,
    paid_at timestamp with time zone,
    total_credited numeric DEFAULT 0 NOT NULL,
    amount_due numeric DEFAULT 0 NOT NULL,
    issuer_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    recipient_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_quote_snapshot jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    document_snapshot_json jsonb,
    CONSTRAINT invoices_amounts_non_negative_check CHECK (((total_ht >= (0)::numeric) AND (total_vat >= (0)::numeric) AND (total_ttc >= (0)::numeric) AND (total_paid >= (0)::numeric) AND (total_credited >= (0)::numeric) AND (amount_due >= (0)::numeric))),
    CONSTRAINT invoices_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'ISSUED'::character varying, 'PARTIALLY_PAID'::character varying, 'PAID'::character varying, 'CANCELLED'::character varying])::text[])))
);


--
-- Name: lead_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    type character varying(30) NOT NULL,
    title character varying(120),
    content text,
    payload jsonb,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    CONSTRAINT lead_activities_type_check CHECK (((type)::text = ANY ((ARRAY['NOTE'::character varying, 'CALL'::character varying, 'MEETING'::character varying, 'EMAIL'::character varying, 'STATUS_CHANGE'::character varying, 'STAGE_CHANGE'::character varying, 'ADDRESS_VERIFIED'::character varying, 'PROJECT_STATUS_CHANGE'::character varying, 'DEVIS_SIGNE'::character varying, 'INSTALLATION_TERMINEE'::character varying])::text[])))
);


--
-- Name: lead_consumption_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_consumption_monthly (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    meter_id uuid NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    kwh integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lcm_kwh_check CHECK ((kwh >= 0)),
    CONSTRAINT lcm_month_check CHECK (((month >= 1) AND (month <= 12)))
);


--
-- Name: lead_dp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_dp (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    state_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lead_meters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_meters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    consumption_pdl character varying(50),
    meter_power_kva integer,
    grid_type character varying(20),
    consumption_mode character varying(20),
    consumption_annual_kwh integer,
    consumption_annual_calculated_kwh integer,
    consumption_profile character varying(20),
    hp_hc boolean DEFAULT false NOT NULL,
    supplier_name character varying(80),
    tariff_type character varying(20),
    energy_profile jsonb,
    equipement_actuel character varying(50),
    equipement_actuel_params jsonb,
    equipements_a_venir jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lead_meters_consumption_mode_check CHECK (((consumption_mode IS NULL) OR ((consumption_mode)::text = ANY ((ARRAY['ANNUAL'::character varying, 'MONTHLY'::character varying, 'PDL'::character varying])::text[])))),
    CONSTRAINT lead_meters_meter_power_kva_check CHECK (((meter_power_kva IS NULL) OR (meter_power_kva >= 0))),
    CONSTRAINT lead_meters_consumption_annual_kwh_check CHECK (((consumption_annual_kwh IS NULL) OR (consumption_annual_kwh >= 0))),
    CONSTRAINT lead_meters_consumption_annual_calculated_check CHECK (((consumption_annual_calculated_kwh IS NULL) OR (consumption_annual_calculated_kwh >= 0)))
);


--
-- Name: lead_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(150) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    slug character varying(64) NOT NULL,
    sort_order integer NOT NULL
);


--
-- Name: lead_stage_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_stage_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    from_stage_id uuid,
    to_stage_id uuid NOT NULL,
    changed_by uuid,
    changed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    note text
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    first_name character varying(150),
    last_name character varying(150),
    email character varying(255),
    phone character varying(50),
    address text,
    source_id uuid NOT NULL,
    stage_id uuid NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    client_id uuid,
    status character varying(50) DEFAULT 'LEAD'::character varying NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    score integer DEFAULT 0 NOT NULL,
    potential_revenue numeric DEFAULT 0 NOT NULL,
    inactivity_level character varying(20) DEFAULT 'none'::character varying NOT NULL,
    last_activity_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    estimated_kw numeric,
    is_owner boolean DEFAULT false,
    consumption numeric,
    surface_m2 numeric,
    project_delay_months integer,
    budget_validated boolean DEFAULT false,
    roof_exploitable boolean DEFAULT false,
    site_address_id uuid,
    billing_address_id uuid,
    civility character varying(20),
    full_name character varying(180) DEFAULT 'Sans nom'::character varying,
    phone_mobile character varying(30),
    phone_landline character varying(30),
    customer_type character varying(20) DEFAULT 'PERSON'::character varying NOT NULL,
    lead_source character varying(80),
    property_type character varying(30),
    household_size integer,
    consumption_mode character varying(20),
    consumption_annual_kwh integer,
    consumption_pdl character varying(50),
    hp_hc boolean DEFAULT false NOT NULL,
    supplier_name character varying(80),
    consumption_profile character varying(20),
    tariff_type character varying(20),
    grid_type character varying(20),
    meter_power_kva integer,
    consumption_annual_calculated_kwh integer,
    construction_year integer,
    insulation_level character varying(20),
    roof_type character varying(20),
    frame_type character varying(20),
    estimated_budget_eur integer,
    financing_mode character varying(20),
    project_timing character varying(20),
    is_primary_residence boolean,
    house_over_2_years boolean,
    is_abf_zone boolean,
    has_asbestos_roof boolean,
    rgpd_consent boolean DEFAULT false NOT NULL,
    rgpd_consent_at timestamp with time zone,
    internal_note text,
    project_status character varying(50),
    archived boolean DEFAULT false NOT NULL,
    archived_reason character varying(50),
    energy_profile jsonb,
    consumption_csv_path text,
    lost_reason text,
    company_name character varying(255),
    contact_first_name character varying(150),
    contact_last_name character varying(150),
    siret character varying(20),
    equipement_actuel character varying(50),
    equipement_actuel_params jsonb,
    equipements_a_venir jsonb,
    birth_date date,
    assigned_user_id uuid,
    marketing_opt_in boolean DEFAULT false NOT NULL,
    marketing_opt_in_at timestamp with time zone,
    mairie_id uuid,
    CONSTRAINT check_lost_reason CHECK ((((status)::text <> 'LOST'::text) OR ((lost_reason IS NOT NULL) AND (length(TRIM(BOTH FROM lost_reason)) > 0)))),
    CONSTRAINT leads_construction_year_check CHECK (((construction_year IS NULL) OR ((construction_year >= 1800) AND (construction_year <= 2100)))),
    CONSTRAINT leads_consumption_annual_calculated_check CHECK (((consumption_annual_calculated_kwh IS NULL) OR (consumption_annual_calculated_kwh >= 0))),
    CONSTRAINT leads_consumption_annual_kwh_check CHECK (((consumption_annual_kwh IS NULL) OR (consumption_annual_kwh >= 0))),
    CONSTRAINT leads_consumption_mode_check CHECK (((consumption_mode IS NULL) OR ((consumption_mode)::text = ANY ((ARRAY['ANNUAL'::character varying, 'MONTHLY'::character varying, 'PDL'::character varying])::text[])))),
    CONSTRAINT leads_estimated_budget_check CHECK (((estimated_budget_eur IS NULL) OR (estimated_budget_eur >= 0))),
    CONSTRAINT leads_household_size_check CHECK (((household_size IS NULL) OR (household_size >= 0))),
    CONSTRAINT leads_meter_power_kva_check CHECK (((meter_power_kva IS NULL) OR (meter_power_kva >= 0))),
    CONSTRAINT leads_status_check CHECK (((status)::text = ANY ((ARRAY['LEAD'::character varying, 'CLIENT'::character varying, 'NEW'::character varying, 'QUALIFIED'::character varying, 'APPOINTMENT'::character varying, 'OFFER_SENT'::character varying, 'IN_REFLECTION'::character varying, 'FOLLOW_UP'::character varying, 'LOST'::character varying, 'ARCHIVED'::character varying, 'SIGNED'::character varying])::text[])))
);


--
-- Name: mail_account_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_account_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mail_account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    can_read boolean DEFAULT true NOT NULL,
    can_send boolean DEFAULT false NOT NULL,
    can_manage boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mail_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid,
    email text NOT NULL,
    display_name text,
    imap_host text,
    imap_port integer,
    imap_secure boolean,
    smtp_host text,
    smtp_port integer,
    smtp_secure boolean,
    encrypted_credentials jsonb,
    is_shared boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_imap_sync_at timestamp with time zone,
    last_imap_error_at timestamp with time zone,
    last_imap_error_code text,
    last_imap_error_message text,
    sync_status text DEFAULT 'IDLE'::text NOT NULL
);


--
-- Name: mail_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mail_message_id uuid NOT NULL,
    file_name text NOT NULL,
    mime_type text,
    size_bytes integer,
    storage_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_inline boolean DEFAULT false NOT NULL,
    content_id text,
    document_id uuid,
    content_sha256 text
);


--
-- Name: mail_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mail_account_id uuid NOT NULL,
    name text NOT NULL,
    type public.mail_folder_type NOT NULL,
    external_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mail_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mail_thread_id uuid NOT NULL,
    mail_account_id uuid NOT NULL,
    folder_id uuid,
    message_id text,
    in_reply_to text,
    subject text,
    body_text text,
    body_html text,
    direction public.mail_message_direction NOT NULL,
    status public.mail_message_status NOT NULL,
    sent_at timestamp with time zone,
    received_at timestamp with time zone,
    is_read boolean DEFAULT false NOT NULL,
    has_attachments boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    references_ids text[],
    tracking_id uuid,
    opened_at timestamp with time zone,
    clicked_at timestamp with time zone,
    failure_code text,
    failure_reason text,
    retry_count integer DEFAULT 0 NOT NULL,
    last_retry_at timestamp with time zone,
    provider_response text,
    external_uid bigint,
    external_flags jsonb,
    external_internal_date timestamp with time zone,
    raw_headers jsonb,
    sync_source text DEFAULT 'IMAP'::text,
    lead_id uuid,
    client_id uuid,
    search_vector tsvector
);


--
-- Name: mail_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mail_account_id uuid NOT NULL,
    created_by uuid NOT NULL,
    mail_message_id uuid NOT NULL,
    mail_thread_id uuid,
    to_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    cc_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    bcc_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    subject text,
    body_html text,
    body_text text,
    from_name text,
    attachments_manifest jsonb,
    in_reply_to text,
    references_json jsonb,
    tracking_enabled boolean DEFAULT true NOT NULL,
    status public.mail_outbox_status DEFAULT 'queued'::public.mail_outbox_status NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 4 NOT NULL,
    last_attempt_at timestamp with time zone,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    last_error text,
    provider_message_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reply_to text
);


--
-- Name: mail_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mail_message_id uuid NOT NULL,
    type public.mail_participant_type NOT NULL,
    email text NOT NULL,
    name text,
    email_normalized text
);


--
-- Name: mail_signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid,
    mail_account_id uuid,
    name text NOT NULL,
    signature_html text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mail_signatures_scope_chk CHECK (((mail_account_id IS NOT NULL) OR ((user_id IS NOT NULL) AND (mail_account_id IS NULL)) OR ((user_id IS NULL) AND (mail_account_id IS NULL))))
);


--
-- Name: mail_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid,
    name text NOT NULL,
    subject_template text,
    body_html_template text NOT NULL,
    category text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mail_thread_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_thread_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    user_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mail_thread_tag_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_thread_tag_links (
    thread_id uuid NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: mail_thread_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_thread_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    color text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mail_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    subject text,
    snippet text,
    last_message_at timestamp with time zone,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lead_id uuid,
    client_id uuid,
    message_count integer DEFAULT 0 NOT NULL,
    has_unread boolean DEFAULT true NOT NULL,
    last_message_id uuid,
    normalized_subject text,
    archived_at timestamp with time zone
);


--
-- Name: mail_tracking_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_tracking_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mail_message_id uuid NOT NULL,
    type text NOT NULL,
    ip text,
    user_agent text,
    url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mail_tracking_events_type_chk CHECK ((type = ANY (ARRAY['OPEN'::text, 'CLICK'::text])))
);


--
-- Name: mairies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mairies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    postal_code character varying(20) NOT NULL,
    city character varying(150),
    portal_url text,
    portal_type character varying(32) DEFAULT 'online'::character varying NOT NULL,
    account_status character varying(32) DEFAULT 'none'::character varying NOT NULL,
    account_email character varying(255),
    bitwarden_ref character varying(500),
    notes text,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mairies_account_status_check CHECK (((account_status)::text = ANY ((ARRAY['none'::character varying, 'to_create'::character varying, 'created'::character varying])::text[]))),
    CONSTRAINT mairies_portal_type_check CHECK (((portal_type)::text = ANY ((ARRAY['online'::character varying, 'email'::character varying, 'paper'::character varying])::text[])))
);


--
-- Name: migration_checksums; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migration_checksums (
    migration_name text NOT NULL,
    checksum text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    checksum_normalized text
);


--
-- Name: mission_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mission_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mission_id uuid NOT NULL,
    user_id uuid NOT NULL,
    team_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mission_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mission_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    color character varying(20),
    default_duration_minutes integer,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: missions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.missions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    mission_type_id uuid,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    status character varying(50) DEFAULT 'scheduled'::character varying NOT NULL,
    client_id uuid,
    project_id uuid,
    agency_id uuid,
    is_private_block boolean DEFAULT false NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    settings_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    legal_name character varying(255),
    trade_name character varying(255),
    siret character varying(255),
    vat_number character varying(255),
    rcs character varying(255),
    capital_amount character varying(255),
    address_line1 character varying(255),
    address_line2 character varying(255),
    postal_code character varying(255),
    city character varying(255),
    country character varying(255),
    phone character varying(255),
    email character varying(255),
    website character varying(255),
    iban character varying(255),
    bic character varying(255),
    bank_name character varying(255),
    default_payment_terms text,
    default_invoice_notes text,
    default_quote_validity_days integer DEFAULT 30,
    default_invoice_due_days integer DEFAULT 30,
    default_vat_rate numeric DEFAULT 20.0,
    quote_prefix character varying(50) DEFAULT 'DEV'::character varying,
    invoice_prefix character varying(50) DEFAULT 'FAC'::character varying,
    logo_url character varying(512),
    logo_dark_url character varying(512),
    pdf_primary_color character varying(50),
    pdf_secondary_color character varying(50),
    pdf_cover_image_key text
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    amount numeric NOT NULL,
    payment_date date NOT NULL,
    payment_method character varying(100),
    reference character varying(255),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(20) DEFAULT 'RECORDED'::character varying NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_positive_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT payments_status_check CHECK (((status)::text = ANY ((ARRAY['RECORDED'::character varying, 'CANCELLED'::character varying])::text[])))
);


--
-- Name: pipeline_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(150) NOT NULL,
    "position" integer NOT NULL,
    is_closed boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    code character varying(50)
);


--
-- Name: pv_batteries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pv_batteries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    brand text NOT NULL,
    model_ref text NOT NULL,
    usable_kwh numeric(6,2) NOT NULL,
    nominal_voltage_v numeric(6,2),
    max_charge_kw numeric(6,2),
    max_discharge_kw numeric(6,2),
    roundtrip_efficiency_pct numeric(5,2),
    depth_of_discharge_pct numeric(5,2),
    cycle_life integer,
    chemistry text,
    scalable boolean DEFAULT false NOT NULL,
    max_modules integer,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    default_price_ht numeric(12,2),
    purchase_price_ht numeric(12,2)
);


--
-- Name: pv_inverters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pv_inverters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    brand text NOT NULL,
    model_ref text NOT NULL,
    inverter_type text NOT NULL,
    nominal_power_kw numeric(6,2),
    nominal_va integer,
    phases text,
    mppt_count integer,
    inputs_per_mppt integer,
    mppt_min_v numeric(6,2),
    mppt_max_v numeric(6,2),
    max_input_current_a numeric(6,2),
    max_dc_power_kw numeric(6,2),
    euro_efficiency_pct numeric(5,2),
    compatible_battery boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    modules_per_inverter integer,
    inverter_family character varying(20) DEFAULT 'CENTRAL'::character varying NOT NULL,
    CONSTRAINT pv_inverters_inverter_family_check CHECK (((inverter_family)::text = ANY ((ARRAY['CENTRAL'::character varying, 'MICRO'::character varying])::text[]))),
    CONSTRAINT pv_inverters_inverter_type_check CHECK ((inverter_type = ANY (ARRAY['micro'::text, 'string'::text]))),
    CONSTRAINT pv_inverters_phases_check CHECK (((phases IS NULL) OR (phases = ANY (ARRAY['1P'::text, '3P'::text]))))
);


--
-- Name: pv_panels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pv_panels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    brand text NOT NULL,
    model_ref text NOT NULL,
    technology text,
    bifacial boolean DEFAULT false NOT NULL,
    power_wc integer NOT NULL,
    efficiency_pct numeric(5,2) NOT NULL,
    temp_coeff_pct_per_deg numeric(6,3),
    degradation_first_year_pct numeric(5,2) DEFAULT 1 NOT NULL,
    degradation_annual_pct numeric(5,2) DEFAULT 0.4 NOT NULL,
    voc_v numeric(6,2),
    isc_a numeric(6,2),
    vmp_v numeric(6,2),
    imp_a numeric(6,2),
    width_mm integer NOT NULL,
    height_mm integer NOT NULL,
    thickness_mm integer,
    weight_kg numeric(6,2),
    warranty_product_years integer,
    warranty_performance_years integer,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pv_virtual_batteries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pv_virtual_batteries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    provider_code text NOT NULL,
    pricing_model text NOT NULL,
    monthly_subscription_ht numeric(10,4),
    cost_per_kwh_ht numeric(10,6),
    activation_fee_ht numeric(10,2),
    contribution_autoproducteur_ht numeric(10,2),
    includes_network_fees boolean DEFAULT false NOT NULL,
    indexed_on_trv boolean DEFAULT false NOT NULL,
    capacity_table jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    tariff_grid_json jsonb,
    tariff_source_label text,
    tariff_effective_date date,
    CONSTRAINT pv_virtual_batteries_pricing_model_check CHECK ((pricing_model = ANY (ARRAY['per_kwc'::text, 'per_capacity'::text, 'per_kwc_with_variable'::text, 'custom'::text])))
);


--
-- Name: quote_catalog_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quote_catalog_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    category public.quote_catalog_category NOT NULL,
    pricing_mode public.quote_catalog_pricing_mode DEFAULT 'FIXED'::public.quote_catalog_pricing_mode NOT NULL,
    sale_price_ht_cents integer DEFAULT 0 NOT NULL,
    purchase_price_ht_cents integer DEFAULT 0 NOT NULL,
    default_vat_rate_bps integer DEFAULT 2000 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quote_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quote_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    quote_id uuid NOT NULL,
    article_id uuid,
    description text NOT NULL,
    quantity numeric DEFAULT 1 NOT NULL,
    unit_price_ht numeric NOT NULL,
    vat_rate numeric NOT NULL,
    total_line_ht numeric NOT NULL,
    total_line_vat numeric NOT NULL,
    total_line_ttc numeric NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    label character varying(255),
    catalog_item_id uuid,
    snapshot_json jsonb NOT NULL,
    purchase_unit_price_ht_cents integer,
    vat_rate_bps integer,
    pricing_mode public.quote_catalog_pricing_mode,
    is_optional boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    discount_ht numeric DEFAULT 0 NOT NULL,
    CONSTRAINT chk_quote_lines_snapshot_json CHECK (((jsonb_typeof(snapshot_json) = 'object'::text) AND (snapshot_json ? 'name'::text) AND (snapshot_json ? 'category'::text)))
);


--
-- Name: quote_text_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quote_text_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    template_kind public.quote_text_template_kind NOT NULL,
    name text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    client_id uuid,
    study_version_id uuid,
    quote_number character varying(100) NOT NULL,
    status character varying(50) DEFAULT 'DRAFT'::character varying NOT NULL,
    total_ht numeric DEFAULT 0 NOT NULL,
    total_vat numeric DEFAULT 0 NOT NULL,
    total_ttc numeric DEFAULT 0 NOT NULL,
    valid_until date,
    notes text,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lead_id uuid,
    study_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    currency character varying(3) DEFAULT 'EUR'::character varying NOT NULL,
    discount_ht numeric DEFAULT 0 NOT NULL,
    sent_at timestamp with time zone,
    accepted_at timestamp with time zone,
    rejected_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    issuer_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    recipient_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    document_snapshot_json jsonb,
    CONSTRAINT quotes_client_or_lead_check CHECK (((client_id IS NOT NULL) OR (lead_id IS NOT NULL))),
    CONSTRAINT quotes_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'READY_TO_SEND'::character varying, 'SENT'::character varying, 'ACCEPTED'::character varying, 'REJECTED'::character varying, 'EXPIRED'::character varying, 'CANCELLED'::character varying])::text[])))
);


--
-- Name: rbac_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    module text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rbac_role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: rbac_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rbac_user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_user_roles (
    user_id uuid NOT NULL,
    role_id uuid NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: studies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.studies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    client_id uuid,
    lead_id uuid,
    study_number character varying(50) NOT NULL,
    status character varying(50) DEFAULT 'draft'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    title text,
    current_version integer DEFAULT 1 NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    deleted_at timestamp with time zone
);


--
-- Name: study_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_data (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    study_version_id uuid NOT NULL,
    data_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_pdf_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: study_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    study_id uuid NOT NULL,
    version_number integer NOT NULL,
    title character varying(255),
    summary text,
    data_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    final_study_json jsonb,
    status character varying(50),
    updated_at timestamp with time zone DEFAULT now(),
    selected_scenario_id text,
    selected_scenario_snapshot jsonb,
    is_locked boolean DEFAULT false NOT NULL,
    locked_at timestamp with time zone
);


--
-- Name: system_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    agency_id uuid,
    name character varying(150) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_agency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_agency (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    agency_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id uuid NOT NULL,
    role_id uuid NOT NULL
);


--
-- Name: user_team; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_team (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    last_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    first_name text,
    last_name text
);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: agencies agencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies
    ADD CONSTRAINT agencies_pkey PRIMARY KEY (id);


--
-- Name: articles articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);


--
-- Name: calpinage_data calpinage_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calpinage_data
    ADD CONSTRAINT calpinage_data_pkey PRIMARY KEY (id);


--
-- Name: calpinage_data calpinage_data_unique_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calpinage_data
    ADD CONSTRAINT calpinage_data_unique_version UNIQUE (study_version_id);


--
-- Name: calpinage_snapshots calpinage_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calpinage_snapshots
    ADD CONSTRAINT calpinage_snapshots_pkey PRIMARY KEY (id);


--
-- Name: calpinage_snapshots calpinage_snapshots_study_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calpinage_snapshots
    ADD CONSTRAINT calpinage_snapshots_study_version_unique UNIQUE (study_id, version_number);


--
-- Name: client_contacts client_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_contacts
    ADD CONSTRAINT client_contacts_pkey PRIMARY KEY (id);


--
-- Name: client_portal_tokens client_portal_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_tokens
    ADD CONSTRAINT client_portal_tokens_pkey PRIMARY KEY (id);


--
-- Name: client_portal_tokens client_portal_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_tokens
    ADD CONSTRAINT client_portal_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: clients clients_unique_client_number_per_org; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_unique_client_number_per_org UNIQUE (organization_id, client_number);


--
-- Name: credit_note_lines credit_note_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_note_lines
    ADD CONSTRAINT credit_note_lines_pkey PRIMARY KEY (id);


--
-- Name: credit_note_lines credit_note_lines_position_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_note_lines
    ADD CONSTRAINT credit_note_lines_position_unique UNIQUE (credit_note_id, "position");


--
-- Name: credit_notes credit_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_pkey PRIMARY KEY (id);


--
-- Name: credit_notes credit_notes_unique_number_per_org; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_unique_number_per_org UNIQUE (organization_id, credit_note_number);


--
-- Name: document_sequences document_sequences_org_kind_year_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_sequences
    ADD CONSTRAINT document_sequences_org_kind_year_unique UNIQUE (organization_id, document_kind, year);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: economic_snapshots economic_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_snapshots
    ADD CONSTRAINT economic_snapshots_pkey PRIMARY KEY (id);


--
-- Name: economic_snapshots economic_snapshots_study_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_snapshots
    ADD CONSTRAINT economic_snapshots_study_version_unique UNIQUE (study_id, version_number);


--
-- Name: email_accounts email_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_pkey PRIMARY KEY (id);


--
-- Name: email_accounts email_accounts_unique_per_org; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_unique_per_org UNIQUE (organization_id, email_address);


--
-- Name: email_attachments email_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_pkey PRIMARY KEY (id);


--
-- Name: emails emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT emails_pkey PRIMARY KEY (id);


--
-- Name: entity_documents entity_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_documents
    ADD CONSTRAINT entity_documents_pkey PRIMARY KEY (id);


--
-- Name: event_labels event_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_labels
    ADD CONSTRAINT event_labels_pkey PRIMARY KEY (id);


--
-- Name: event_labels event_labels_unique_name_per_org; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_labels
    ADD CONSTRAINT event_labels_unique_name_per_org UNIQUE (organization_id, name);


--
-- Name: invoice_lines invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: invoice_reminders invoice_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_reminders
    ADD CONSTRAINT invoice_reminders_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_unique_number_per_org; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_unique_number_per_org UNIQUE (organization_id, invoice_number);


--
-- Name: lead_consumption_monthly lcm_meter_year_month_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_consumption_monthly
    ADD CONSTRAINT lcm_meter_year_month_unique UNIQUE (meter_id, year, month);


--
-- Name: lead_activities lead_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_pkey PRIMARY KEY (id);


--
-- Name: lead_consumption_monthly lead_consumption_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_consumption_monthly
    ADD CONSTRAINT lead_consumption_monthly_pkey PRIMARY KEY (id);


--
-- Name: lead_meters lead_meters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_meters
    ADD CONSTRAINT lead_meters_pkey PRIMARY KEY (id);


--
-- Name: lead_dp lead_dp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_dp
    ADD CONSTRAINT lead_dp_pkey PRIMARY KEY (id);


--
-- Name: lead_dp lead_dp_unique_org_lead; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_dp
    ADD CONSTRAINT lead_dp_unique_org_lead UNIQUE (organization_id, lead_id);


--
-- Name: lead_sources lead_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_sources
    ADD CONSTRAINT lead_sources_pkey PRIMARY KEY (id);


--
-- Name: lead_stage_history lead_stage_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_stage_history
    ADD CONSTRAINT lead_stage_history_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: mail_account_permissions mail_account_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_account_permissions
    ADD CONSTRAINT mail_account_permissions_pkey PRIMARY KEY (id);


--
-- Name: mail_accounts mail_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_accounts
    ADD CONSTRAINT mail_accounts_pkey PRIMARY KEY (id);


--
-- Name: mail_attachments mail_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_attachments
    ADD CONSTRAINT mail_attachments_pkey PRIMARY KEY (id);


--
-- Name: mail_folders mail_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_folders
    ADD CONSTRAINT mail_folders_pkey PRIMARY KEY (id);


--
-- Name: mail_messages mail_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages
    ADD CONSTRAINT mail_messages_pkey PRIMARY KEY (id);


--
-- Name: mail_outbox mail_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_outbox
    ADD CONSTRAINT mail_outbox_pkey PRIMARY KEY (id);


--
-- Name: mail_participants mail_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_participants
    ADD CONSTRAINT mail_participants_pkey PRIMARY KEY (id);


--
-- Name: mail_signatures mail_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_signatures
    ADD CONSTRAINT mail_signatures_pkey PRIMARY KEY (id);


--
-- Name: mail_templates mail_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_templates
    ADD CONSTRAINT mail_templates_pkey PRIMARY KEY (id);


--
-- Name: mail_thread_notes mail_thread_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_thread_notes
    ADD CONSTRAINT mail_thread_notes_pkey PRIMARY KEY (id);


--
-- Name: mail_thread_tag_links mail_thread_tag_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_thread_tag_links
    ADD CONSTRAINT mail_thread_tag_links_pkey PRIMARY KEY (thread_id, tag_id);


--
-- Name: mail_thread_tags mail_thread_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_thread_tags
    ADD CONSTRAINT mail_thread_tags_pkey PRIMARY KEY (id);


--
-- Name: mail_threads mail_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_threads
    ADD CONSTRAINT mail_threads_pkey PRIMARY KEY (id);


--
-- Name: mail_tracking_events mail_tracking_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_tracking_events
    ADD CONSTRAINT mail_tracking_events_pkey PRIMARY KEY (id);


--
-- Name: mairies mairies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mairies
    ADD CONSTRAINT mairies_pkey PRIMARY KEY (id);


--
-- Name: migration_checksums migration_checksums_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_checksums
    ADD CONSTRAINT migration_checksums_pkey PRIMARY KEY (migration_name);


--
-- Name: mission_assignments mission_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission_assignments
    ADD CONSTRAINT mission_assignments_pkey PRIMARY KEY (id);


--
-- Name: mission_assignments mission_assignments_unique_mission_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission_assignments
    ADD CONSTRAINT mission_assignments_unique_mission_user UNIQUE (mission_id, user_id);


--
-- Name: mission_types mission_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission_types
    ADD CONSTRAINT mission_types_pkey PRIMARY KEY (id);


--
-- Name: missions missions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: pipeline_stages pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);


--
-- Name: pv_batteries pv_batteries_brand_model_ref_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pv_batteries
    ADD CONSTRAINT pv_batteries_brand_model_ref_unique UNIQUE (brand, model_ref);


--
-- Name: pv_batteries pv_batteries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pv_batteries
    ADD CONSTRAINT pv_batteries_pkey PRIMARY KEY (id);


--
-- Name: pv_inverters pv_inverters_brand_model_ref_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pv_inverters
    ADD CONSTRAINT pv_inverters_brand_model_ref_unique UNIQUE (brand, model_ref);


--
-- Name: pv_inverters pv_inverters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pv_inverters
    ADD CONSTRAINT pv_inverters_pkey PRIMARY KEY (id);


--
-- Name: pv_panels pv_panels_brand_model_ref_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pv_panels
    ADD CONSTRAINT pv_panels_brand_model_ref_unique UNIQUE (brand, model_ref);


--
-- Name: pv_panels pv_panels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pv_panels
    ADD CONSTRAINT pv_panels_pkey PRIMARY KEY (id);


--
-- Name: pv_virtual_batteries pv_virtual_batteries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pv_virtual_batteries
    ADD CONSTRAINT pv_virtual_batteries_pkey PRIMARY KEY (id);


--
-- Name: quote_catalog_items quote_catalog_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_catalog_items
    ADD CONSTRAINT quote_catalog_items_pkey PRIMARY KEY (id);


--
-- Name: quote_lines quote_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_lines
    ADD CONSTRAINT quote_lines_pkey PRIMARY KEY (id);


--
-- Name: quote_text_templates quote_text_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_text_templates
    ADD CONSTRAINT quote_text_templates_pkey PRIMARY KEY (id);


--
-- Name: quotes quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);


--
-- Name: quotes quotes_unique_number_per_org; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_unique_number_per_org UNIQUE (organization_id, quote_number);


--
-- Name: rbac_permissions rbac_permissions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_permissions
    ADD CONSTRAINT rbac_permissions_code_key UNIQUE (code);


--
-- Name: rbac_permissions rbac_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_permissions
    ADD CONSTRAINT rbac_permissions_pkey PRIMARY KEY (id);


--
-- Name: rbac_role_permissions rbac_role_permissions_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_pk PRIMARY KEY (role_id, permission_id);


--
-- Name: rbac_roles rbac_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_roles
    ADD CONSTRAINT rbac_roles_pkey PRIMARY KEY (id);


--
-- Name: rbac_user_roles rbac_user_roles_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_roles
    ADD CONSTRAINT rbac_user_roles_pk PRIMARY KEY (user_id, role_id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: studies studies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT studies_pkey PRIMARY KEY (id);


--
-- Name: studies studies_unique_study_number_per_org; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT studies_unique_study_number_per_org UNIQUE (organization_id, study_number);


--
-- Name: study_data study_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_data
    ADD CONSTRAINT study_data_pkey PRIMARY KEY (id);


--
-- Name: study_data study_data_unique_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_data
    ADD CONSTRAINT study_data_unique_version UNIQUE (study_version_id);


--
-- Name: study_versions study_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_versions
    ADD CONSTRAINT study_versions_pkey PRIMARY KEY (id);


--
-- Name: study_versions study_versions_study_id_version_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_versions
    ADD CONSTRAINT study_versions_study_id_version_number_unique UNIQUE (study_id, version_number);


--
-- Name: system_events system_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_events
    ADD CONSTRAINT system_events_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: mail_account_permissions uq_mail_account_permissions_account_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_account_permissions
    ADD CONSTRAINT uq_mail_account_permissions_account_user UNIQUE (mail_account_id, user_id);


--
-- Name: mail_accounts uq_mail_accounts_org_email; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_accounts
    ADD CONSTRAINT uq_mail_accounts_org_email UNIQUE (organization_id, email);


--
-- Name: mail_messages uq_mail_messages_account_message_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages
    ADD CONSTRAINT uq_mail_messages_account_message_id UNIQUE (mail_account_id, message_id);


--
-- Name: mail_outbox uq_mail_outbox_mail_message_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_outbox
    ADD CONSTRAINT uq_mail_outbox_mail_message_id UNIQUE (mail_message_id);


--
-- Name: quote_catalog_items uq_quote_catalog_items_org_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_catalog_items
    ADD CONSTRAINT uq_quote_catalog_items_org_name UNIQUE (organization_id, name);


--
-- Name: user_agency user_agency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_agency
    ADD CONSTRAINT user_agency_pkey PRIMARY KEY (id);


--
-- Name: user_agency user_agency_unique_user_agency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_agency
    ADD CONSTRAINT user_agency_unique_user_agency UNIQUE (user_id, agency_id);


--
-- Name: user_roles user_roles_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pk PRIMARY KEY (user_id, role_id);


--
-- Name: user_team user_team_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT user_team_pkey PRIMARY KEY (id);


--
-- Name: user_team user_team_unique_user_team; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT user_team_unique_user_team UNIQUE (user_id, team_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: addresses_lat_lon_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX addresses_lat_lon_index ON public.addresses USING btree (lat, lon);


--
-- Name: addresses_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX addresses_organization_id_index ON public.addresses USING btree (organization_id);


--
-- Name: agencies_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agencies_organization_id_index ON public.agencies USING btree (organization_id);


--
-- Name: articles_category_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_category_index ON public.articles USING btree (category);


--
-- Name: articles_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_created_at_index ON public.articles USING btree (created_at);


--
-- Name: articles_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_organization_id_index ON public.articles USING btree (organization_id);


--
-- Name: audit_logs_action_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_action_created_idx ON public.audit_logs USING btree (action, created_at);


--
-- Name: audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at);


--
-- Name: audit_logs_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_created_at_index ON public.audit_logs USING btree (created_at);


--
-- Name: audit_logs_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_entity_id_index ON public.audit_logs USING btree (entity_id);


--
-- Name: audit_logs_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_entity_idx ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: audit_logs_entity_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_entity_type_index ON public.audit_logs USING btree (entity_type);


--
-- Name: audit_logs_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_org_created_idx ON public.audit_logs USING btree (organization_id, created_at);


--
-- Name: audit_logs_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_organization_id_index ON public.audit_logs USING btree (organization_id);


--
-- Name: audit_logs_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_user_created_idx ON public.audit_logs USING btree (user_id, created_at);


--
-- Name: audit_logs_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_user_id_index ON public.audit_logs USING btree (user_id);


--
-- Name: calendar_events_archived_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_archived_at_index ON public.calendar_events USING btree (archived_at);


--
-- Name: calendar_events_client_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_client_id_index ON public.calendar_events USING btree (client_id);


--
-- Name: calendar_events_label_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_label_id_index ON public.calendar_events USING btree (label_id);


--
-- Name: calendar_events_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_organization_id_index ON public.calendar_events USING btree (organization_id);


--
-- Name: calendar_events_start_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_start_at_index ON public.calendar_events USING btree (start_at);


--
-- Name: calendar_events_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_user_id_index ON public.calendar_events USING btree (user_id);


--
-- Name: calpinage_data_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calpinage_data_created_at_index ON public.calpinage_data USING btree (created_at);


--
-- Name: calpinage_data_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calpinage_data_organization_id_index ON public.calpinage_data USING btree (organization_id);


--
-- Name: calpinage_data_study_version_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calpinage_data_study_version_id_index ON public.calpinage_data USING btree (study_version_id);


--
-- Name: calpinage_snapshots_study_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calpinage_snapshots_study_id_index ON public.calpinage_snapshots USING btree (study_id);


--
-- Name: calpinage_snapshots_study_version_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calpinage_snapshots_study_version_id_idx ON public.calpinage_snapshots USING btree (study_version_id);


--
-- Name: calpinage_snapshots_study_version_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calpinage_snapshots_study_version_id_index ON public.calpinage_snapshots USING btree (study_version_id);


--
-- Name: client_contacts_client_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_contacts_client_id_index ON public.client_contacts USING btree (client_id);


--
-- Name: client_contacts_email_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_contacts_email_index ON public.client_contacts USING btree (email);


--
-- Name: client_contacts_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_contacts_organization_id_index ON public.client_contacts USING btree (organization_id);


--
-- Name: client_portal_tokens_lead_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_portal_tokens_lead_id_index ON public.client_portal_tokens USING btree (lead_id);


--
-- Name: client_portal_tokens_one_active_per_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX client_portal_tokens_one_active_per_lead ON public.client_portal_tokens USING btree (lead_id) WHERE (revoked_at IS NULL);


--
-- Name: client_portal_tokens_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_portal_tokens_organization_id_index ON public.client_portal_tokens USING btree (organization_id);


--
-- Name: clients_archived_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_archived_at_index ON public.clients USING btree (archived_at);


--
-- Name: clients_client_number_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_client_number_index ON public.clients USING btree (client_number);


--
-- Name: clients_email_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_email_index ON public.clients USING btree (email);


--
-- Name: clients_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_organization_id_index ON public.clients USING btree (organization_id);


--
-- Name: credit_note_lines_credit_note_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_note_lines_credit_note_id_index ON public.credit_note_lines USING btree (credit_note_id);


--
-- Name: credit_note_lines_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_note_lines_organization_id_index ON public.credit_note_lines USING btree (organization_id);


--
-- Name: credit_notes_archived_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_notes_archived_at_index ON public.credit_notes USING btree (archived_at);


--
-- Name: credit_notes_client_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_notes_client_id_index ON public.credit_notes USING btree (client_id);


--
-- Name: credit_notes_invoice_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_notes_invoice_id_index ON public.credit_notes USING btree (invoice_id);


--
-- Name: credit_notes_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_notes_organization_id_index ON public.credit_notes USING btree (organization_id);


--
-- Name: credit_notes_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_notes_status_index ON public.credit_notes USING btree (status);


--
-- Name: documents_client_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_client_id_index ON public.documents USING btree (client_id);


--
-- Name: documents_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_created_at_index ON public.documents USING btree (created_at);


--
-- Name: documents_document_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_document_type_index ON public.documents USING btree (document_type);


--
-- Name: documents_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_organization_id_index ON public.documents USING btree (organization_id);


--
-- Name: documents_study_version_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_study_version_id_index ON public.documents USING btree (study_version_id);


--
-- Name: economic_snapshots_study_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX economic_snapshots_study_id_index ON public.economic_snapshots USING btree (study_id);


--
-- Name: economic_snapshots_study_version_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX economic_snapshots_study_version_id_index ON public.economic_snapshots USING btree (study_version_id);


--
-- Name: email_accounts_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_accounts_organization_id_index ON public.email_accounts USING btree (organization_id);


--
-- Name: email_accounts_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_accounts_user_id_index ON public.email_accounts USING btree (user_id);


--
-- Name: email_attachments_email_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_attachments_email_id_index ON public.email_attachments USING btree (email_id);


--
-- Name: email_attachments_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_attachments_organization_id_index ON public.email_attachments USING btree (organization_id);


--
-- Name: emails_client_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emails_client_id_index ON public.emails USING btree (client_id);


--
-- Name: emails_direction_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emails_direction_index ON public.emails USING btree (direction);


--
-- Name: emails_email_account_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emails_email_account_id_index ON public.emails USING btree (email_account_id);


--
-- Name: emails_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emails_organization_id_index ON public.emails USING btree (organization_id);


--
-- Name: emails_received_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emails_received_at_index ON public.emails USING btree (received_at);


--
-- Name: emails_sent_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emails_sent_at_index ON public.emails USING btree (sent_at);


--
-- Name: entity_documents_archived_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_documents_archived_at_index ON public.entity_documents USING btree (archived_at);


--
-- Name: entity_documents_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_documents_entity_id_index ON public.entity_documents USING btree (entity_id);


--
-- Name: entity_documents_entity_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_documents_entity_type_index ON public.entity_documents USING btree (entity_type);


--
-- Name: entity_documents_organization_id_entity_type_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_documents_organization_id_entity_type_entity_id_index ON public.entity_documents USING btree (organization_id, entity_type, entity_id);


--
-- Name: entity_documents_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_documents_organization_id_index ON public.entity_documents USING btree (organization_id);


--
-- Name: event_labels_category_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_labels_category_index ON public.event_labels USING btree (category);


--
-- Name: event_labels_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_labels_organization_id_index ON public.event_labels USING btree (organization_id);


--
-- Name: idx_calendar_events_org_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_org_active ON public.calendar_events USING btree (organization_id) WHERE (archived_at IS NULL);


--
-- Name: idx_calpinage_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calpinage_version ON public.calpinage_data USING btree (study_version_id);


--
-- Name: idx_clients_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_email ON public.clients USING btree (email);


--
-- Name: idx_clients_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_name ON public.clients USING btree (last_name, first_name);


--
-- Name: idx_clients_org_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_org_active ON public.clients USING btree (organization_id) WHERE (archived_at IS NULL);


--
-- Name: idx_clients_org_company_domain_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_org_company_domain_lower ON public.clients USING btree (organization_id, lower(TRIM(BOTH FROM company_domain))) WHERE ((company_domain IS NOT NULL) AND (TRIM(BOTH FROM company_domain) <> ''::text));


--
-- Name: idx_clients_org_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_org_email_lower ON public.clients USING btree (organization_id, lower(TRIM(BOTH FROM email))) WHERE ((email IS NOT NULL) AND (TRIM(BOTH FROM email) <> ''::text));


--
-- Name: idx_document_sequences_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_sequences_org ON public.document_sequences USING btree (organization_id);


--
-- Name: idx_documents_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_entity ON public.entity_documents USING btree (entity_type, entity_id);


--
-- Name: idx_economic_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_economic_version ON public.economic_snapshots USING btree (study_version_id);


--
-- Name: idx_entity_documents_org_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_documents_org_active ON public.entity_documents USING btree (organization_id) WHERE (archived_at IS NULL);


--
-- Name: idx_entity_documents_org_client_visible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_documents_org_client_visible ON public.entity_documents USING btree (organization_id, document_category) WHERE ((archived_at IS NULL) AND (is_client_visible = true));


--
-- Name: idx_entity_documents_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_documents_type ON public.entity_documents USING btree (organization_id, entity_type, entity_id, document_type) WHERE (archived_at IS NULL);


--
-- Name: idx_invoices_amount_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_amount_due ON public.invoices USING btree (amount_due);


--
-- Name: idx_invoices_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_client ON public.invoices USING btree (client_id);


--
-- Name: idx_invoices_due_date_fin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_due_date_fin ON public.invoices USING btree (due_date);


--
-- Name: idx_invoices_issue_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_issue_date ON public.invoices USING btree (issue_date);


--
-- Name: idx_invoices_org_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_org_active ON public.invoices USING btree (organization_id) WHERE (archived_at IS NULL);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_lead_activities_lead_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_activities_lead_occurred ON public.lead_activities USING btree (lead_id, occurred_at);


--
-- Name: idx_leads_archived_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_archived_at ON public.leads USING btree (archived_at);


--
-- Name: idx_leads_assigned_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_assigned_user ON public.leads USING btree (assigned_user_id);


--
-- Name: idx_leads_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_company_name ON public.leads USING btree (company_name) WHERE (company_name IS NOT NULL);


--
-- Name: idx_leads_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_created_at ON public.leads USING btree (created_at DESC);


--
-- Name: idx_leads_estimated_budget; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_estimated_budget ON public.leads USING btree (estimated_budget_eur);


--
-- Name: idx_leads_full_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_full_name ON public.leads USING btree (full_name);


--
-- Name: idx_leads_inactivity_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_inactivity_level ON public.leads USING btree (inactivity_level);


--
-- Name: idx_leads_org_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_org_active ON public.leads USING btree (organization_id) WHERE (archived_at IS NULL);


--
-- Name: idx_leads_org_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_org_email_lower ON public.leads USING btree (organization_id, lower(TRIM(BOTH FROM email))) WHERE ((email IS NOT NULL) AND (TRIM(BOTH FROM email) <> ''::text));


--
-- Name: idx_leads_organization_id_mairie_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_organization_id_mairie_id ON public.leads USING btree (organization_id, mairie_id) WHERE (mairie_id IS NOT NULL);


--
-- Name: idx_leads_project_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_project_status ON public.leads USING btree (project_status);


--
-- Name: idx_leads_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_stage ON public.leads USING btree (stage_id);


--
-- Name: idx_leads_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_status ON public.leads USING btree (status);


--
-- Name: idx_leads_status_cp029; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_status_cp029 ON public.leads USING btree (status);


--
-- Name: idx_mail_account_permissions_mail_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_account_permissions_mail_account_id ON public.mail_account_permissions USING btree (mail_account_id);


--
-- Name: idx_mail_account_permissions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_account_permissions_user_id ON public.mail_account_permissions USING btree (user_id);


--
-- Name: idx_mail_accounts_last_imap_sync_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_accounts_last_imap_sync_at ON public.mail_accounts USING btree (last_imap_sync_at);


--
-- Name: idx_mail_accounts_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_accounts_organization_id ON public.mail_accounts USING btree (organization_id);


--
-- Name: idx_mail_accounts_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_accounts_sync_status ON public.mail_accounts USING btree (sync_status);


--
-- Name: idx_mail_accounts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_accounts_user_id ON public.mail_accounts USING btree (user_id);


--
-- Name: idx_mail_attachments_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_attachments_document_id ON public.mail_attachments USING btree (document_id);


--
-- Name: idx_mail_attachments_mail_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_attachments_mail_message_id ON public.mail_attachments USING btree (mail_message_id);


--
-- Name: idx_mail_folders_mail_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_folders_mail_account_id ON public.mail_folders USING btree (mail_account_id);


--
-- Name: idx_mail_messages_account_folder_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_messages_account_folder_uid ON public.mail_messages USING btree (mail_account_id, folder_id, external_uid) WHERE (external_uid IS NOT NULL);


--
-- Name: idx_mail_messages_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_messages_client_id ON public.mail_messages USING btree (client_id);


--
-- Name: idx_mail_messages_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_messages_lead_id ON public.mail_messages USING btree (lead_id);


--
-- Name: idx_mail_messages_mail_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_messages_mail_account_id ON public.mail_messages USING btree (mail_account_id);


--
-- Name: idx_mail_messages_mail_thread_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_messages_mail_thread_id ON public.mail_messages USING btree (mail_thread_id);


--
-- Name: idx_mail_messages_received_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_messages_received_at_desc ON public.mail_messages USING btree (received_at DESC NULLS LAST);


--
-- Name: idx_mail_messages_references_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_messages_references_ids ON public.mail_messages USING gin (references_ids);


--
-- Name: idx_mail_messages_search_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_messages_search_vector ON public.mail_messages USING gin (search_vector);


--
-- Name: idx_mail_messages_sent_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_messages_sent_at_desc ON public.mail_messages USING btree (sent_at DESC NULLS LAST);


--
-- Name: idx_mail_messages_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_messages_status ON public.mail_messages USING btree (status);


--
-- Name: idx_mail_messages_status_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_messages_status_retry ON public.mail_messages USING btree (status, retry_count);


--
-- Name: idx_mail_outbox_mail_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_outbox_mail_account_id ON public.mail_outbox USING btree (mail_account_id);


--
-- Name: idx_mail_outbox_next_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_outbox_next_attempt ON public.mail_outbox USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['queued'::public.mail_outbox_status, 'retrying'::public.mail_outbox_status]));


--
-- Name: idx_mail_outbox_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_outbox_organization_id ON public.mail_outbox USING btree (organization_id);


--
-- Name: idx_mail_outbox_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_outbox_status ON public.mail_outbox USING btree (status);


--
-- Name: idx_mail_participants_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_participants_email ON public.mail_participants USING btree (email);


--
-- Name: idx_mail_participants_email_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_participants_email_normalized ON public.mail_participants USING btree (email_normalized);


--
-- Name: idx_mail_participants_mail_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_participants_mail_message_id ON public.mail_participants USING btree (mail_message_id);


--
-- Name: idx_mail_signatures_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_signatures_account ON public.mail_signatures USING btree (mail_account_id);


--
-- Name: idx_mail_signatures_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_signatures_org ON public.mail_signatures USING btree (organization_id);


--
-- Name: idx_mail_signatures_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_signatures_user ON public.mail_signatures USING btree (user_id);


--
-- Name: idx_mail_templates_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_templates_category ON public.mail_templates USING btree (category);


--
-- Name: idx_mail_templates_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_templates_org ON public.mail_templates USING btree (organization_id);


--
-- Name: idx_mail_templates_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_templates_user ON public.mail_templates USING btree (user_id);


--
-- Name: idx_mail_thread_notes_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_thread_notes_thread ON public.mail_thread_notes USING btree (thread_id);


--
-- Name: idx_mail_thread_tag_links_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_thread_tag_links_thread ON public.mail_thread_tag_links USING btree (thread_id);


--
-- Name: idx_mail_thread_tags_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_thread_tags_org ON public.mail_thread_tags USING btree (organization_id);


--
-- Name: idx_mail_threads_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_threads_client_id ON public.mail_threads USING btree (client_id);


--
-- Name: idx_mail_threads_last_message_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_threads_last_message_at_desc ON public.mail_threads USING btree (last_message_at DESC NULLS LAST);


--
-- Name: idx_mail_threads_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_threads_lead_id ON public.mail_threads USING btree (lead_id);


--
-- Name: idx_mail_threads_org_archived_last; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_threads_org_archived_last ON public.mail_threads USING btree (organization_id, archived_at, last_message_at DESC NULLS LAST);


--
-- Name: idx_mail_threads_org_normalized_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_threads_org_normalized_subject ON public.mail_threads USING btree (organization_id, normalized_subject) WHERE (normalized_subject IS NOT NULL);


--
-- Name: idx_mail_threads_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_threads_organization_id ON public.mail_threads USING btree (organization_id);


--
-- Name: idx_mail_tracking_events_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_tracking_events_message ON public.mail_tracking_events USING btree (mail_message_id);


--
-- Name: idx_mail_tracking_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_tracking_events_type ON public.mail_tracking_events USING btree (type);


--
-- Name: idx_mairies_organization_id_account_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mairies_organization_id_account_status ON public.mairies USING btree (organization_id, account_status);


--
-- Name: idx_mairies_organization_id_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mairies_organization_id_city ON public.mairies USING btree (organization_id, city);


--
-- Name: idx_mairies_organization_id_last_used_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mairies_organization_id_last_used_at_desc ON public.mairies USING btree (organization_id, last_used_at DESC NULLS LAST);


--
-- Name: idx_mairies_organization_id_postal_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mairies_organization_id_postal_code ON public.mairies USING btree (organization_id, postal_code);


--
-- Name: idx_pipeline_stages_org_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_stages_org_code ON public.pipeline_stages USING btree (organization_id, code);


--
-- Name: idx_pv_batteries_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pv_batteries_active ON public.pv_batteries USING btree (active);


--
-- Name: idx_pv_inverters_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pv_inverters_active ON public.pv_inverters USING btree (active);


--
-- Name: idx_pv_panels_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pv_panels_active ON public.pv_panels USING btree (active);


--
-- Name: idx_quote_catalog_items_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quote_catalog_items_org_id ON public.quote_catalog_items USING btree (organization_id);


--
-- Name: idx_quote_lines_org_catalog; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quote_lines_org_catalog ON public.quote_lines USING btree (organization_id, catalog_item_id);


--
-- Name: idx_quote_lines_org_quote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quote_lines_org_quote ON public.quote_lines USING btree (organization_id, quote_id);


--
-- Name: idx_quote_text_templates_org_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quote_text_templates_org_kind ON public.quote_text_templates USING btree (organization_id, template_kind);


--
-- Name: idx_quotes_accepted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_accepted_at ON public.quotes USING btree (accepted_at);


--
-- Name: idx_quotes_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_client ON public.quotes USING btree (client_id);


--
-- Name: idx_quotes_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_created_at ON public.quotes USING btree (created_at DESC);


--
-- Name: idx_quotes_org_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_org_active ON public.quotes USING btree (organization_id) WHERE (archived_at IS NULL);


--
-- Name: idx_quotes_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_sent_at ON public.quotes USING btree (sent_at);


--
-- Name: idx_quotes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_status ON public.quotes USING btree (status);


--
-- Name: idx_studies_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studies_client ON public.studies USING btree (client_id);


--
-- Name: idx_studies_current_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studies_current_version ON public.studies USING btree (current_version);


--
-- Name: idx_studies_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studies_deleted ON public.studies USING btree (deleted_at);


--
-- Name: idx_studies_org_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studies_org_active ON public.studies USING btree (organization_id) WHERE (archived_at IS NULL);


--
-- Name: idx_study_versions_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_versions_study ON public.study_versions USING btree (study_id);


--
-- Name: idx_study_versions_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_versions_version ON public.study_versions USING btree (study_id, version_number);


--
-- Name: idx_system_events_created_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_events_created_at_desc ON public.system_events USING btree (created_at DESC);


--
-- Name: idx_system_events_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_events_org ON public.system_events USING btree (organization_id);


--
-- Name: idx_system_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_events_type ON public.system_events USING btree (type);


--
-- Name: idx_virtual_batteries_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_virtual_batteries_org ON public.pv_virtual_batteries USING btree (organization_id);


--
-- Name: invoice_lines_article_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_lines_article_id_index ON public.invoice_lines USING btree (article_id);


--
-- Name: invoice_lines_invoice_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_lines_invoice_id_index ON public.invoice_lines USING btree (invoice_id);


--
-- Name: invoice_lines_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_lines_organization_id_index ON public.invoice_lines USING btree (organization_id);


--
-- Name: invoice_reminders_invoice_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_reminders_invoice_id_index ON public.invoice_reminders USING btree (invoice_id);


--
-- Name: invoice_reminders_next_action_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_reminders_next_action_at_index ON public.invoice_reminders USING btree (next_action_at);


--
-- Name: invoice_reminders_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_reminders_organization_id_index ON public.invoice_reminders USING btree (organization_id);


--
-- Name: invoices_archived_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_archived_at_index ON public.invoices USING btree (archived_at);


--
-- Name: invoices_client_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_client_id_index ON public.invoices USING btree (client_id);


--
-- Name: invoices_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_created_at_index ON public.invoices USING btree (created_at);


--
-- Name: invoices_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_organization_id_index ON public.invoices USING btree (organization_id);


--
-- Name: invoices_quote_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_quote_id_index ON public.invoices USING btree (quote_id);


--
-- Name: invoices_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_status_index ON public.invoices USING btree (status);


--
-- Name: lead_activities_created_by_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_activities_created_by_user_id_index ON public.lead_activities USING btree (created_by_user_id);


--
-- Name: lead_activities_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_activities_organization_id_index ON public.lead_activities USING btree (organization_id);


--
-- Name: lead_activities_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_activities_type_index ON public.lead_activities USING btree (type);


--
-- Name: lead_consumption_monthly_lead_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_consumption_monthly_lead_id_index ON public.lead_consumption_monthly USING btree (lead_id);


--
-- Name: lead_consumption_monthly_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_consumption_monthly_organization_id_index ON public.lead_consumption_monthly USING btree (organization_id);


--
-- Name: idx_lead_consumption_monthly_meter_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_consumption_monthly_meter_id ON public.lead_consumption_monthly USING btree (meter_id);


--
-- Name: lead_meters_lead_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_meters_lead_id_index ON public.lead_meters USING btree (lead_id);


--
-- Name: lead_meters_lead_id_sort_order_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_meters_lead_id_sort_order_index ON public.lead_meters USING btree (lead_id, sort_order);


--
-- Name: lead_meters_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_meters_organization_id_index ON public.lead_meters USING btree (organization_id);


--
-- Name: lead_meters_one_default_per_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX lead_meters_one_default_per_lead ON public.lead_meters USING btree (lead_id) WHERE (is_default = true);


--
-- Name: lead_dp_lead_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_dp_lead_id_index ON public.lead_dp USING btree (lead_id);


--
-- Name: lead_dp_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_dp_organization_id_index ON public.lead_dp USING btree (organization_id);


--
-- Name: lead_sources_organization_id_slug_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX lead_sources_organization_id_slug_uidx ON public.lead_sources USING btree (organization_id, slug);


--
-- Name: lead_stage_history_changed_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_stage_history_changed_at_index ON public.lead_stage_history USING btree (changed_at);


--
-- Name: lead_stage_history_lead_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_stage_history_lead_id_index ON public.lead_stage_history USING btree (lead_id);


--
-- Name: lead_stage_history_to_stage_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_stage_history_to_stage_id_index ON public.lead_stage_history USING btree (to_stage_id);


--
-- Name: leads_archived_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_archived_at_index ON public.leads USING btree (archived_at);


--
-- Name: leads_billing_address_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_billing_address_id_index ON public.leads USING btree (billing_address_id);


--
-- Name: leads_client_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_client_id_index ON public.leads USING btree (client_id);


--
-- Name: leads_organization_id_stage_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_organization_id_stage_id_index ON public.leads USING btree (organization_id, stage_id);


--
-- Name: leads_site_address_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_site_address_id_index ON public.leads USING btree (site_address_id);


--
-- Name: mission_assignments_mission_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mission_assignments_mission_id_index ON public.mission_assignments USING btree (mission_id);


--
-- Name: mission_assignments_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mission_assignments_user_id_index ON public.mission_assignments USING btree (user_id);


--
-- Name: mission_types_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mission_types_organization_id_index ON public.mission_types USING btree (organization_id);


--
-- Name: missions_agency_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX missions_agency_id_index ON public.missions USING btree (agency_id);


--
-- Name: missions_client_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX missions_client_id_index ON public.missions USING btree (client_id);


--
-- Name: missions_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX missions_organization_id_index ON public.missions USING btree (organization_id);


--
-- Name: missions_start_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX missions_start_at_index ON public.missions USING btree (start_at);


--
-- Name: organizations_name_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_name_index ON public.organizations USING btree (name);


--
-- Name: payments_invoice_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_invoice_id_index ON public.payments USING btree (invoice_id);


--
-- Name: payments_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_organization_id_index ON public.payments USING btree (organization_id);


--
-- Name: payments_payment_date_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_payment_date_index ON public.payments USING btree (payment_date);


--
-- Name: pipeline_stages_organization_id_position_unique_index; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pipeline_stages_organization_id_position_unique_index ON public.pipeline_stages USING btree (organization_id, "position");


--
-- Name: pv_virtual_batteries_tariff_grid_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pv_virtual_batteries_tariff_grid_gin ON public.pv_virtual_batteries USING gin (tariff_grid_json);


--
-- Name: quote_lines_article_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_lines_article_id_index ON public.quote_lines USING btree (article_id);


--
-- Name: quote_lines_catalog_item_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_lines_catalog_item_id_index ON public.quote_lines USING btree (catalog_item_id);


--
-- Name: quote_lines_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_lines_organization_id_index ON public.quote_lines USING btree (organization_id);


--
-- Name: quote_lines_quote_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_lines_quote_id_index ON public.quote_lines USING btree (quote_id);


--
-- Name: quotes_archived_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotes_archived_at_index ON public.quotes USING btree (archived_at);


--
-- Name: quotes_client_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotes_client_id_index ON public.quotes USING btree (client_id);


--
-- Name: quotes_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotes_created_at_index ON public.quotes USING btree (created_at);


--
-- Name: quotes_lead_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotes_lead_id_index ON public.quotes USING btree (lead_id);


--
-- Name: quotes_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotes_organization_id_index ON public.quotes USING btree (organization_id);


--
-- Name: quotes_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotes_status_index ON public.quotes USING btree (status);


--
-- Name: quotes_study_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotes_study_id_index ON public.quotes USING btree (study_id);


--
-- Name: rbac_permissions_module_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rbac_permissions_module_index ON public.rbac_permissions USING btree (module);


--
-- Name: rbac_role_permissions_permission_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rbac_role_permissions_permission_id_index ON public.rbac_role_permissions USING btree (permission_id);


--
-- Name: rbac_roles_org_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rbac_roles_org_code_unique ON public.rbac_roles USING btree (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), code);


--
-- Name: rbac_roles_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rbac_roles_organization_id_index ON public.rbac_roles USING btree (organization_id);


--
-- Name: rbac_user_roles_role_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rbac_user_roles_role_id_index ON public.rbac_user_roles USING btree (role_id);


--
-- Name: studies_archived_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX studies_archived_at_index ON public.studies USING btree (archived_at);


--
-- Name: studies_client_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX studies_client_id_index ON public.studies USING btree (client_id);


--
-- Name: studies_lead_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX studies_lead_id_index ON public.studies USING btree (lead_id);


--
-- Name: studies_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX studies_organization_id_index ON public.studies USING btree (organization_id);


--
-- Name: studies_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX studies_status_index ON public.studies USING btree (status);


--
-- Name: studies_study_number_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX studies_study_number_index ON public.studies USING btree (study_number);


--
-- Name: study_data_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX study_data_created_at_index ON public.study_data USING btree (created_at);


--
-- Name: study_data_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX study_data_organization_id_index ON public.study_data USING btree (organization_id);


--
-- Name: study_data_study_version_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX study_data_study_version_id_index ON public.study_data USING btree (study_version_id);


--
-- Name: study_versions_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX study_versions_created_at_index ON public.study_versions USING btree (created_at);


--
-- Name: study_versions_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX study_versions_organization_id_index ON public.study_versions USING btree (organization_id);


--
-- Name: study_versions_study_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX study_versions_study_id_index ON public.study_versions USING btree (study_id);


--
-- Name: study_versions_study_id_version_number_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX study_versions_study_id_version_number_index ON public.study_versions USING btree (study_id, version_number);


--
-- Name: teams_agency_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teams_agency_id_index ON public.teams USING btree (agency_id);


--
-- Name: teams_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teams_organization_id_index ON public.teams USING btree (organization_id);


--
-- Name: uq_mail_attachments_message_sha; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mail_attachments_message_sha ON public.mail_attachments USING btree (mail_message_id, content_sha256) WHERE (content_sha256 IS NOT NULL);


--
-- Name: uq_mail_messages_account_folder_external_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mail_messages_account_folder_external_uid ON public.mail_messages USING btree (mail_account_id, folder_id, external_uid) WHERE (external_uid IS NOT NULL);


--
-- Name: uq_mail_messages_tracking_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mail_messages_tracking_id ON public.mail_messages USING btree (tracking_id) WHERE (tracking_id IS NOT NULL);


--
-- Name: uq_mail_signatures_default_account; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mail_signatures_default_account ON public.mail_signatures USING btree (mail_account_id) WHERE ((is_default = true) AND (mail_account_id IS NOT NULL) AND (is_active = true));


--
-- Name: uq_mail_signatures_default_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mail_signatures_default_org ON public.mail_signatures USING btree (organization_id) WHERE ((is_default = true) AND (user_id IS NULL) AND (mail_account_id IS NULL) AND (is_active = true));


--
-- Name: uq_mail_signatures_default_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mail_signatures_default_user ON public.mail_signatures USING btree (organization_id, user_id) WHERE ((is_default = true) AND (user_id IS NOT NULL) AND (mail_account_id IS NULL) AND (is_active = true));


--
-- Name: uq_mail_thread_tags_org_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mail_thread_tags_org_name_lower ON public.mail_thread_tags USING btree (organization_id, lower(btrim(name)));


--
-- Name: uq_mairies_org_cp_city_name_when_no_portal_url; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mairies_org_cp_city_name_when_no_portal_url ON public.mairies USING btree (organization_id, postal_code, COALESCE(city, ''::character varying), name) WHERE (portal_url IS NULL);


--
-- Name: uq_mairies_org_cp_city_portal_url_when_url; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mairies_org_cp_city_portal_url_when_url ON public.mairies USING btree (organization_id, postal_code, COALESCE(city, ''::character varying), portal_url) WHERE (portal_url IS NOT NULL);


--
-- Name: uq_virtual_battery_provider_per_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_virtual_battery_provider_per_org ON public.pv_virtual_batteries USING btree (organization_id, provider_code);


--
-- Name: user_agency_agency_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_agency_agency_id_index ON public.user_agency USING btree (agency_id);


--
-- Name: user_agency_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_agency_organization_id_index ON public.user_agency USING btree (organization_id);


--
-- Name: user_agency_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_agency_user_id_index ON public.user_agency USING btree (user_id);


--
-- Name: user_team_organization_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_team_organization_id_index ON public.user_team USING btree (organization_id);


--
-- Name: user_team_team_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_team_team_id_index ON public.user_team USING btree (team_id);


--
-- Name: user_team_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_team_user_id_index ON public.user_team USING btree (user_id);


--
-- Name: users_organization_id_email_unique_index; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_organization_id_email_unique_index ON public.users USING btree (organization_id, email);


--
-- Name: audit_logs audit_logs_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_logs_modification();


--
-- Name: audit_logs audit_logs_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_logs_modification();


--
-- Name: credit_notes credit_notes_sync_invoice_totals; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER credit_notes_sync_invoice_totals AFTER INSERT OR DELETE OR UPDATE ON public.credit_notes FOR EACH ROW EXECUTE FUNCTION public.sg_credit_notes_sync_invoice_totals();


--
-- Name: lead_stage_history lead_stage_history_validate_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lead_stage_history_validate_org BEFORE INSERT ON public.lead_stage_history FOR EACH ROW EXECUTE FUNCTION public.sg_validate_lead_stage_history_org();


--
-- Name: leads leads_validate_stage_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER leads_validate_stage_org BEFORE INSERT OR UPDATE OF stage_id, organization_id ON public.leads FOR EACH ROW EXECUTE FUNCTION public.sg_validate_lead_stage_org();


--
-- Name: organizations organizations_seed_pipeline; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_seed_pipeline AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.sg_organizations_after_insert_seed_pipeline();


--
-- Name: organizations organizations_seed_rbac; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_seed_rbac AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.sg_organizations_after_insert_seed_rbac();


--
-- Name: payments payments_sync_total_paid; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_sync_total_paid AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.sg_payments_sync_total_paid();


--
-- Name: mail_account_permissions trg_mail_account_permissions_validate_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_account_permissions_validate_org BEFORE INSERT OR UPDATE OF organization_id, mail_account_id, user_id ON public.mail_account_permissions FOR EACH ROW EXECUTE FUNCTION public.sg_mail_account_permissions_validate_org();


--
-- Name: mail_attachments trg_mail_attachments_validate_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_attachments_validate_org BEFORE INSERT OR UPDATE OF organization_id, mail_message_id ON public.mail_attachments FOR EACH ROW EXECUTE FUNCTION public.sg_mail_attachments_validate_org();


--
-- Name: mail_folders trg_mail_folders_validate_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_folders_validate_org BEFORE INSERT OR UPDATE OF organization_id, mail_account_id ON public.mail_folders FOR EACH ROW EXECUTE FUNCTION public.sg_mail_folders_validate_org();


--
-- Name: mail_messages trg_mail_messages_search_vector; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_messages_search_vector BEFORE INSERT OR UPDATE OF subject, body_text ON public.mail_messages FOR EACH ROW EXECUTE FUNCTION public.mail_messages_search_vector_biu();


--
-- Name: mail_messages trg_mail_messages_validate_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_messages_validate_org BEFORE INSERT OR UPDATE OF organization_id, mail_thread_id, mail_account_id, folder_id, client_id, lead_id ON public.mail_messages FOR EACH ROW EXECUTE FUNCTION public.sg_mail_messages_validate_org();


--
-- Name: mail_participants trg_mail_participants_email_normalized; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_participants_email_normalized BEFORE INSERT OR UPDATE OF email ON public.mail_participants FOR EACH ROW EXECUTE FUNCTION public.sg_mail_participants_set_email_normalized();


--
-- Name: mail_participants trg_mail_participants_refresh_tsv; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_participants_refresh_tsv AFTER INSERT OR DELETE OR UPDATE ON public.mail_participants FOR EACH ROW EXECUTE FUNCTION public.mail_participants_refresh_message_tsv();


--
-- Name: mail_participants trg_mail_participants_validate_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_participants_validate_org BEFORE INSERT OR UPDATE OF organization_id, mail_message_id ON public.mail_participants FOR EACH ROW EXECUTE FUNCTION public.sg_mail_participants_validate_org();


--
-- Name: mail_signatures trg_mail_signatures_validate_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_signatures_validate_org BEFORE INSERT OR UPDATE OF organization_id, user_id, mail_account_id ON public.mail_signatures FOR EACH ROW EXECUTE FUNCTION public.sg_mail_signatures_validate_org();


--
-- Name: mail_templates trg_mail_templates_validate_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_templates_validate_org BEFORE INSERT OR UPDATE OF organization_id, user_id ON public.mail_templates FOR EACH ROW EXECUTE FUNCTION public.sg_mail_templates_validate_org();


--
-- Name: mail_thread_notes trg_mail_thread_notes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_thread_notes_updated_at BEFORE UPDATE ON public.mail_thread_notes FOR EACH ROW EXECUTE FUNCTION public.sg_mail_thread_notes_set_updated_at();


--
-- Name: mail_tracking_events trg_mail_tracking_events_validate_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_tracking_events_validate_org BEFORE INSERT OR UPDATE OF organization_id, mail_message_id ON public.mail_tracking_events FOR EACH ROW EXECUTE FUNCTION public.sg_mail_tracking_events_validate_org();


--
-- Name: quote_lines trg_quote_lines_catalog_item_id_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_quote_lines_catalog_item_id_immutable BEFORE UPDATE ON public.quote_lines FOR EACH ROW EXECUTE FUNCTION public.trg_quote_lines_catalog_item_id_immutable();


--
-- Name: user_agency user_agency_check_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_agency_check_org BEFORE INSERT OR UPDATE ON public.user_agency FOR EACH ROW EXECUTE FUNCTION public.cp_admin_struct_02_check_user_agency_org();


--
-- Name: user_team user_team_check_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_team_check_org BEFORE INSERT OR UPDATE ON public.user_team FOR EACH ROW EXECUTE FUNCTION public.cp_admin_struct_02_check_user_team_org();


--
-- Name: addresses addresses_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: agencies agencies_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies
    ADD CONSTRAINT agencies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: articles articles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: calendar_events calendar_events_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_label_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_label_id_fkey FOREIGN KEY (label_id) REFERENCES public.event_labels(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: calendar_events calendar_events_study_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_study_version_id_fkey FOREIGN KEY (study_version_id) REFERENCES public.study_versions(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: calpinage_data calpinage_data_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calpinage_data
    ADD CONSTRAINT calpinage_data_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: calpinage_data calpinage_data_study_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calpinage_data
    ADD CONSTRAINT calpinage_data_study_version_id_fkey FOREIGN KEY (study_version_id) REFERENCES public.study_versions(id) ON DELETE CASCADE;


--
-- Name: calpinage_snapshots calpinage_snapshots_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calpinage_snapshots
    ADD CONSTRAINT calpinage_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: calpinage_snapshots calpinage_snapshots_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calpinage_snapshots
    ADD CONSTRAINT calpinage_snapshots_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: calpinage_snapshots calpinage_snapshots_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calpinage_snapshots
    ADD CONSTRAINT calpinage_snapshots_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: calpinage_snapshots calpinage_snapshots_study_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calpinage_snapshots
    ADD CONSTRAINT calpinage_snapshots_study_version_id_fkey FOREIGN KEY (study_version_id) REFERENCES public.study_versions(id) ON DELETE CASCADE;


--
-- Name: client_contacts client_contacts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_contacts
    ADD CONSTRAINT client_contacts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_contacts client_contacts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_contacts
    ADD CONSTRAINT client_contacts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: client_portal_tokens client_portal_tokens_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_tokens
    ADD CONSTRAINT client_portal_tokens_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: client_portal_tokens client_portal_tokens_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_tokens
    ADD CONSTRAINT client_portal_tokens_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: clients clients_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE SET NULL;


--
-- Name: clients clients_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: clients clients_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: credit_note_lines credit_note_lines_credit_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_note_lines
    ADD CONSTRAINT credit_note_lines_credit_note_id_fkey FOREIGN KEY (credit_note_id) REFERENCES public.credit_notes(id) ON DELETE CASCADE;


--
-- Name: credit_note_lines credit_note_lines_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_note_lines
    ADD CONSTRAINT credit_note_lines_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: credit_notes credit_notes_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: credit_notes credit_notes_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: credit_notes credit_notes_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE RESTRICT;


--
-- Name: credit_notes credit_notes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: document_sequences document_sequences_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_sequences
    ADD CONSTRAINT document_sequences_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: documents documents_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: documents documents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: documents documents_study_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_study_version_id_fkey FOREIGN KEY (study_version_id) REFERENCES public.study_versions(id) ON DELETE CASCADE;


--
-- Name: economic_snapshots economic_snapshots_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_snapshots
    ADD CONSTRAINT economic_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: economic_snapshots economic_snapshots_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_snapshots
    ADD CONSTRAINT economic_snapshots_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: economic_snapshots economic_snapshots_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_snapshots
    ADD CONSTRAINT economic_snapshots_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: economic_snapshots economic_snapshots_study_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_snapshots
    ADD CONSTRAINT economic_snapshots_study_version_id_fkey FOREIGN KEY (study_version_id) REFERENCES public.study_versions(id) ON DELETE CASCADE;


--
-- Name: email_accounts email_accounts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: email_accounts email_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: email_attachments email_attachments_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_email_id_fkey FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE CASCADE;


--
-- Name: email_attachments email_attachments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: emails emails_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT emails_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: emails emails_email_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT emails_email_account_id_fkey FOREIGN KEY (email_account_id) REFERENCES public.email_accounts(id) ON DELETE CASCADE;


--
-- Name: emails emails_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT emails_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: entity_documents entity_documents_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_documents
    ADD CONSTRAINT entity_documents_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: entity_documents entity_documents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_documents
    ADD CONSTRAINT entity_documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: entity_documents entity_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_documents
    ADD CONSTRAINT entity_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: event_labels event_labels_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_labels
    ADD CONSTRAINT event_labels_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_threads fk_mail_threads_client_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_threads
    ADD CONSTRAINT fk_mail_threads_client_id FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: mail_threads fk_mail_threads_last_message_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_threads
    ADD CONSTRAINT fk_mail_threads_last_message_id FOREIGN KEY (last_message_id) REFERENCES public.mail_messages(id) ON DELETE SET NULL;


--
-- Name: mail_threads fk_mail_threads_lead_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_threads
    ADD CONSTRAINT fk_mail_threads_lead_id FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: invoice_lines invoice_lines_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL;


--
-- Name: invoice_lines invoice_lines_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_lines invoice_lines_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: invoice_reminders invoice_reminders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_reminders
    ADD CONSTRAINT invoice_reminders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoice_reminders invoice_reminders_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_reminders
    ADD CONSTRAINT invoice_reminders_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_reminders invoice_reminders_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_reminders
    ADD CONSTRAINT invoice_reminders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE SET NULL;


--
-- Name: lead_activities lead_activities_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lead_activities lead_activities_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_activities lead_activities_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: lead_consumption_monthly lead_consumption_monthly_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_consumption_monthly
    ADD CONSTRAINT lead_consumption_monthly_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_consumption_monthly lead_consumption_monthly_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_consumption_monthly
    ADD CONSTRAINT lead_consumption_monthly_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: lead_consumption_monthly lead_consumption_monthly_meter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_consumption_monthly
    ADD CONSTRAINT lead_consumption_monthly_meter_id_fkey FOREIGN KEY (meter_id) REFERENCES public.lead_meters(id) ON DELETE CASCADE;


--
-- Name: lead_meters lead_meters_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_meters
    ADD CONSTRAINT lead_meters_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_meters lead_meters_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_meters
    ADD CONSTRAINT lead_meters_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: lead_dp lead_dp_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_dp
    ADD CONSTRAINT lead_dp_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_dp lead_dp_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_dp
    ADD CONSTRAINT lead_dp_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: lead_sources lead_sources_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_sources
    ADD CONSTRAINT lead_sources_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: lead_stage_history lead_stage_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_stage_history
    ADD CONSTRAINT lead_stage_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lead_stage_history lead_stage_history_from_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_stage_history
    ADD CONSTRAINT lead_stage_history_from_stage_id_fkey FOREIGN KEY (from_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;


--
-- Name: lead_stage_history lead_stage_history_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_stage_history
    ADD CONSTRAINT lead_stage_history_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_stage_history lead_stage_history_to_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_stage_history
    ADD CONSTRAINT lead_stage_history_to_stage_id_fkey FOREIGN KEY (to_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT;


--
-- Name: leads leads_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: leads leads_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: leads leads_billing_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_billing_address_id_fkey FOREIGN KEY (billing_address_id) REFERENCES public.addresses(id) ON DELETE SET NULL;


--
-- Name: leads leads_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: leads leads_mairie_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_mairie_id_fkey FOREIGN KEY (mairie_id) REFERENCES public.mairies(id) ON DELETE SET NULL;


--
-- Name: leads leads_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: leads leads_site_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_site_address_id_fkey FOREIGN KEY (site_address_id) REFERENCES public.addresses(id) ON DELETE SET NULL;


--
-- Name: leads leads_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.lead_sources(id) ON DELETE SET NULL;


--
-- Name: leads leads_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT;


--
-- Name: mail_account_permissions mail_account_permissions_mail_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_account_permissions
    ADD CONSTRAINT mail_account_permissions_mail_account_id_fkey FOREIGN KEY (mail_account_id) REFERENCES public.mail_accounts(id) ON DELETE CASCADE;


--
-- Name: mail_account_permissions mail_account_permissions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_account_permissions
    ADD CONSTRAINT mail_account_permissions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_account_permissions mail_account_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_account_permissions
    ADD CONSTRAINT mail_account_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mail_accounts mail_accounts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_accounts
    ADD CONSTRAINT mail_accounts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_accounts mail_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_accounts
    ADD CONSTRAINT mail_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mail_attachments mail_attachments_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_attachments
    ADD CONSTRAINT mail_attachments_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.entity_documents(id) ON DELETE SET NULL;


--
-- Name: mail_attachments mail_attachments_mail_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_attachments
    ADD CONSTRAINT mail_attachments_mail_message_id_fkey FOREIGN KEY (mail_message_id) REFERENCES public.mail_messages(id) ON DELETE CASCADE;


--
-- Name: mail_attachments mail_attachments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_attachments
    ADD CONSTRAINT mail_attachments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_folders mail_folders_mail_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_folders
    ADD CONSTRAINT mail_folders_mail_account_id_fkey FOREIGN KEY (mail_account_id) REFERENCES public.mail_accounts(id) ON DELETE CASCADE;


--
-- Name: mail_folders mail_folders_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_folders
    ADD CONSTRAINT mail_folders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_messages mail_messages_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages
    ADD CONSTRAINT mail_messages_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: mail_messages mail_messages_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages
    ADD CONSTRAINT mail_messages_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.mail_folders(id) ON DELETE SET NULL;


--
-- Name: mail_messages mail_messages_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages
    ADD CONSTRAINT mail_messages_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: mail_messages mail_messages_mail_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages
    ADD CONSTRAINT mail_messages_mail_account_id_fkey FOREIGN KEY (mail_account_id) REFERENCES public.mail_accounts(id) ON DELETE CASCADE;


--
-- Name: mail_messages mail_messages_mail_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages
    ADD CONSTRAINT mail_messages_mail_thread_id_fkey FOREIGN KEY (mail_thread_id) REFERENCES public.mail_threads(id) ON DELETE CASCADE;


--
-- Name: mail_messages mail_messages_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages
    ADD CONSTRAINT mail_messages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_outbox mail_outbox_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_outbox
    ADD CONSTRAINT mail_outbox_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: mail_outbox mail_outbox_mail_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_outbox
    ADD CONSTRAINT mail_outbox_mail_account_id_fkey FOREIGN KEY (mail_account_id) REFERENCES public.mail_accounts(id) ON DELETE CASCADE;


--
-- Name: mail_outbox mail_outbox_mail_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_outbox
    ADD CONSTRAINT mail_outbox_mail_message_id_fkey FOREIGN KEY (mail_message_id) REFERENCES public.mail_messages(id) ON DELETE CASCADE;


--
-- Name: mail_outbox mail_outbox_mail_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_outbox
    ADD CONSTRAINT mail_outbox_mail_thread_id_fkey FOREIGN KEY (mail_thread_id) REFERENCES public.mail_threads(id) ON DELETE SET NULL;


--
-- Name: mail_outbox mail_outbox_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_outbox
    ADD CONSTRAINT mail_outbox_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_participants mail_participants_mail_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_participants
    ADD CONSTRAINT mail_participants_mail_message_id_fkey FOREIGN KEY (mail_message_id) REFERENCES public.mail_messages(id) ON DELETE CASCADE;


--
-- Name: mail_participants mail_participants_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_participants
    ADD CONSTRAINT mail_participants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_signatures mail_signatures_mail_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_signatures
    ADD CONSTRAINT mail_signatures_mail_account_id_fkey FOREIGN KEY (mail_account_id) REFERENCES public.mail_accounts(id) ON DELETE CASCADE;


--
-- Name: mail_signatures mail_signatures_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_signatures
    ADD CONSTRAINT mail_signatures_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_signatures mail_signatures_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_signatures
    ADD CONSTRAINT mail_signatures_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mail_templates mail_templates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_templates
    ADD CONSTRAINT mail_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_templates mail_templates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_templates
    ADD CONSTRAINT mail_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mail_thread_notes mail_thread_notes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_thread_notes
    ADD CONSTRAINT mail_thread_notes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_thread_notes mail_thread_notes_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_thread_notes
    ADD CONSTRAINT mail_thread_notes_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.mail_threads(id) ON DELETE CASCADE;


--
-- Name: mail_thread_notes mail_thread_notes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_thread_notes
    ADD CONSTRAINT mail_thread_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mail_thread_tag_links mail_thread_tag_links_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_thread_tag_links
    ADD CONSTRAINT mail_thread_tag_links_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.mail_thread_tags(id) ON DELETE CASCADE;


--
-- Name: mail_thread_tag_links mail_thread_tag_links_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_thread_tag_links
    ADD CONSTRAINT mail_thread_tag_links_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.mail_threads(id) ON DELETE CASCADE;


--
-- Name: mail_thread_tags mail_thread_tags_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_thread_tags
    ADD CONSTRAINT mail_thread_tags_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_threads mail_threads_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_threads
    ADD CONSTRAINT mail_threads_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_tracking_events mail_tracking_events_mail_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_tracking_events
    ADD CONSTRAINT mail_tracking_events_mail_message_id_fkey FOREIGN KEY (mail_message_id) REFERENCES public.mail_messages(id) ON DELETE CASCADE;


--
-- Name: mail_tracking_events mail_tracking_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_tracking_events
    ADD CONSTRAINT mail_tracking_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mairies mairies_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mairies
    ADD CONSTRAINT mairies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mission_assignments mission_assignments_mission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission_assignments
    ADD CONSTRAINT mission_assignments_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES public.missions(id) ON DELETE CASCADE;


--
-- Name: mission_assignments mission_assignments_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission_assignments
    ADD CONSTRAINT mission_assignments_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: mission_assignments mission_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission_assignments
    ADD CONSTRAINT mission_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mission_types mission_types_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission_types
    ADD CONSTRAINT mission_types_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: missions missions_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE SET NULL;


--
-- Name: missions missions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: missions missions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: missions missions_mission_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_mission_type_id_fkey FOREIGN KEY (mission_type_id) REFERENCES public.mission_types(id) ON DELETE SET NULL;


--
-- Name: missions missions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: missions missions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.studies(id) ON DELETE SET NULL;


--
-- Name: payments payments_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: payments payments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pipeline_stages pipeline_stages_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pv_virtual_batteries pv_virtual_batteries_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pv_virtual_batteries
    ADD CONSTRAINT pv_virtual_batteries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: quote_catalog_items quote_catalog_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_catalog_items
    ADD CONSTRAINT quote_catalog_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: quote_lines quote_lines_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_lines
    ADD CONSTRAINT quote_lines_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL;


--
-- Name: quote_lines quote_lines_catalog_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_lines
    ADD CONSTRAINT quote_lines_catalog_item_id_fkey FOREIGN KEY (catalog_item_id) REFERENCES public.quote_catalog_items(id) ON DELETE SET NULL;


--
-- Name: quote_lines quote_lines_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_lines
    ADD CONSTRAINT quote_lines_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: quote_lines quote_lines_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_lines
    ADD CONSTRAINT quote_lines_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE CASCADE;


--
-- Name: quote_text_templates quote_text_templates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_text_templates
    ADD CONSTRAINT quote_text_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: quotes quotes_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: quotes quotes_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: quotes quotes_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: quotes quotes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: quotes quotes_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE SET NULL;


--
-- Name: quotes quotes_study_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_study_version_id_fkey FOREIGN KEY (study_version_id) REFERENCES public.study_versions(id) ON DELETE SET NULL;


--
-- Name: rbac_role_permissions rbac_role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.rbac_permissions(id) ON DELETE CASCADE;


--
-- Name: rbac_role_permissions rbac_role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.rbac_roles(id) ON DELETE CASCADE;


--
-- Name: rbac_roles rbac_roles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_roles
    ADD CONSTRAINT rbac_roles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: rbac_user_roles rbac_user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_roles
    ADD CONSTRAINT rbac_user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.rbac_roles(id) ON DELETE CASCADE;


--
-- Name: rbac_user_roles rbac_user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_roles
    ADD CONSTRAINT rbac_user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: studies studies_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT studies_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: studies studies_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT studies_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: studies studies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT studies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: studies studies_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT studies_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: studies studies_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT studies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: study_data study_data_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_data
    ADD CONSTRAINT study_data_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: study_data study_data_study_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_data
    ADD CONSTRAINT study_data_study_version_id_fkey FOREIGN KEY (study_version_id) REFERENCES public.study_versions(id) ON DELETE CASCADE;


--
-- Name: study_versions study_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_versions
    ADD CONSTRAINT study_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: study_versions study_versions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_versions
    ADD CONSTRAINT study_versions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: study_versions study_versions_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_versions
    ADD CONSTRAINT study_versions_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: system_events system_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_events
    ADD CONSTRAINT system_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: teams teams_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE SET NULL;


--
-- Name: teams teams_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: user_agency user_agency_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_agency
    ADD CONSTRAINT user_agency_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;


--
-- Name: user_agency user_agency_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_agency
    ADD CONSTRAINT user_agency_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: user_agency user_agency_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_agency
    ADD CONSTRAINT user_agency_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_team user_team_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT user_team_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: user_team user_team_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT user_team_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: user_team user_team_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT user_team_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


