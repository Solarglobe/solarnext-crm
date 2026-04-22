import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./mail-composer.css";
import type {
  MailAccountRow,
  MailSignatureRow,
  MailTemplateRow,
  SendMailAttachmentPayload,
  ThreadMessage,
} from "../../services/mailApi";
import { getSignatures, getTemplates, renderMailTemplate, sendMail } from "../../services/mailApi";
import { buildMailComposerRenderContext } from "./mailComposerTemplateContext";
import { MailComposerAttachments, readFileAsBase64, type LocalAttachment } from "./MailComposerAttachments";
import { MailComposerRecipients } from "./MailComposerRecipients";
import { MailHtmlEditor, type MailHtmlEditorHandle } from "./MailHtmlEditor";
import {
  buildForwardInitialBody,
  buildReplyAllContext,
  buildReplyContext,
  ensureFwdSubject,
  filterValidEmails,
  parseAddressListInput,
  pickThreadMailAccountId,
  type ComposerMode,
} from "./mailComposerLogic";
import { sanitizeComposerHtml } from "./sanitizeComposerHtml";
import { sanitizeMailHtmlDisplay } from "./mailHtmlSanitize";
import {
  extractForwardQuotedAppendix,
  injectMailSignatureHtml,
  shortSignaturePreview,
  stripMailSignatureFromHtml,
} from "./mailSignatureHtml";
import { apiFetch } from "../../services/api";
import { getCrmApiBase } from "../../config/crmApiBase";

function mailApiRoot(): string {
  const b = getCrmApiBase();
  return b ? b.replace(/\/$/, "") : "";
}

/** Préremplissage depuis la navigation (ex. envoi d’un document CRM). */
export type MailComposerInitialPrefill = {
  crmLeadId?: string | null;
  crmClientId?: string | null;
  subject?: string | null;
  /** Destinataire explicite (évite un GET lead si déjà connu). */
  to?: string | null;
  /** Corps initial (nouveau message). */
  bodyHtml?: string | null;
  /** entity_documents.id — fichier téléchargé puis joint comme pièce locale */
  documents?: { id: string; filename: string }[];
  /** Présentation du compositeur sur la page Mail (défaut : panneau droit). */
  composePresentation?: "standalone" | "overlay";
};

function htmlToPlainText(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent || "").replace(/\s+/g, " ").trim();
}

function isBodyEmpty(html: string): boolean {
  const plain = htmlToPlainText(html);
  return plain.length === 0;
}

function resolveInitialAccountId(accounts: MailAccountRow[], preferred: string | null | undefined): string {
  if (preferred && accounts.some((a) => a.id === preferred)) return preferred;
  return accounts[0]?.id ?? "";
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createEditorInstanceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return randomId();
}

/** V1 — ancienne clé `mail_draft_${accountId}_${threadId}` (migration one-shot). */
const MAIL_DRAFT_SCHEMA_V1 = 1;

/** V2 — historique (sans editorInstanceId). */
const MAIL_DRAFT_SCHEMA_V2 = 2;

/** V3 — + editorInstanceId (multi-onglet), clé inchangée côté stockage. */
const MAIL_DRAFT_SCHEMA_V3 = 3;

const DRAFT_MAX_RESTORE_AGE_MS = 24 * 60 * 60 * 1000;
const DRAFT_STALE_PURGE_MS = 7 * 24 * 60 * 60 * 1000;

type MailComposerDraftV1 = {
  v: typeof MAIL_DRAFT_SCHEMA_V1;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
};

type MailComposerDraftStored = {
  v: typeof MAIL_DRAFT_SCHEMA_V2 | typeof MAIL_DRAFT_SCHEMA_V3;
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
  updatedAt: number;
  /** Dernière instance éditeur ayant sauvegardé (comparaison multi-onglets via updatedAt). */
  editorInstanceId?: string;
};

/**
 * Sans fil : une seule clé `mail_draft_new`.
 * Avec fil : `mail_draft_${threadId}_${mode}` (reply / replyAll / forward distincts).
 */
function draftStorageKey(threadId: string | null | undefined, mode: ComposerMode): string {
  if (threadId) {
    return `mail_draft_${threadId}_${mode}`;
  }
  return "mail_draft_new";
}

function legacyDraftStorageKey(accountId: string, threadId: string | null | undefined): string {
  return `mail_draft_${accountId}_${threadId ?? "new"}`;
}

function parseStoredDraftV1(raw: string): MailComposerDraftV1 | null {
  try {
    const d = JSON.parse(raw) as Partial<MailComposerDraftV1>;
    if (d?.v !== MAIL_DRAFT_SCHEMA_V1 || typeof d.bodyHtml !== "string") return null;
    if (d.bodyHtml.length > 6_000_000) return null;
    return {
      v: MAIL_DRAFT_SCHEMA_V1,
      to: typeof d.to === "string" ? d.to : "",
      cc: typeof d.cc === "string" ? d.cc : "",
      bcc: typeof d.bcc === "string" ? d.bcc : "",
      subject: typeof d.subject === "string" ? d.subject : "",
      bodyHtml: d.bodyHtml,
    };
  } catch {
    return null;
  }
}

/** Brouillon V2/V3 frais (< 24 h) — le plus récent est toujours dans la clé unique (updatedAt). */
function parseDraftStoredForRestore(raw: string): MailComposerDraftStored | null {
  try {
    const d = JSON.parse(raw) as Partial<MailComposerDraftStored & { v?: number }>;
    if (d?.v !== MAIL_DRAFT_SCHEMA_V2 && d?.v !== MAIL_DRAFT_SCHEMA_V3) return null;
    if (typeof d.bodyHtml !== "string") return null;
    if (d.bodyHtml.length > 6_000_000) return null;
    if (typeof d.accountId !== "string" || !d.accountId.trim()) return null;
    const updatedAt = typeof d.updatedAt === "number" ? d.updatedAt : 0;
    if (Date.now() - updatedAt > DRAFT_MAX_RESTORE_AGE_MS) return null;
    const ei =
      typeof d.editorInstanceId === "string" && d.editorInstanceId.trim()
        ? d.editorInstanceId.trim()
        : undefined;
    return {
      v: d.v as typeof MAIL_DRAFT_SCHEMA_V2 | typeof MAIL_DRAFT_SCHEMA_V3,
      accountId: d.accountId.trim(),
      to: typeof d.to === "string" ? d.to : "",
      cc: typeof d.cc === "string" ? d.cc : "",
      bcc: typeof d.bcc === "string" ? d.bcc : "",
      subject: typeof d.subject === "string" ? d.subject : "",
      bodyHtml: d.bodyHtml,
      updatedAt,
      editorInstanceId: ei,
    };
  } catch {
    return null;
  }
}

function resolveAccountFromDraft(draftAccountId: string, accounts: MailAccountRow[], preferred: string | null | undefined): string {
  if (accounts.some((a) => a.id === draftAccountId)) return draftAccountId;
  return resolveInitialAccountId(accounts, preferred);
}

/** Supprime les brouillons V2/V3 > 7 jours (parcours des clés `mail_draft_*`). */
function cleanupOldMailDrafts(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("mail_draft_")) continue;
      const raw = localStorage.getItem(k);
      if (!raw) {
        toRemove.push(k);
        continue;
      }
      try {
        const j = JSON.parse(raw) as { v?: number; updatedAt?: number };
        if (
          (j?.v === MAIL_DRAFT_SCHEMA_V2 || j?.v === MAIL_DRAFT_SCHEMA_V3) &&
          typeof j.updatedAt === "number" &&
          Date.now() - j.updatedAt > DRAFT_STALE_PURGE_MS
        ) {
          toRemove.push(k);
        }
      } catch {
        /* conserver clé illisible — pas de purge aveugle */
      }
    }
    for (const k of toRemove) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Fusionne d’anciennes clés `mail_draft_new_*` vers `mail_draft_new` (garde le payload au updatedAt le plus récent).
 */
function migrateObsoleteNewComposerKeys(mode: ComposerMode): void {
  try {
    const target = "mail_draft_new";
    for (const oldKey of [`mail_draft_new_new`, `mail_draft_new_${mode}`]) {
      if (oldKey === target) continue;
      const raw = localStorage.getItem(oldKey);
      if (!raw) continue;
      const incoming = parseDraftStoredForRestore(raw);
      const curRaw = localStorage.getItem(target);
      const cur = curRaw ? parseDraftStoredForRestore(curRaw) : null;
      if (incoming) {
        if (!cur || incoming.updatedAt >= cur.updatedAt) {
          localStorage.setItem(target, raw);
        }
      } else if (!curRaw) {
        localStorage.setItem(target, raw);
      }
      localStorage.removeItem(oldKey);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Migre un éventuel brouillon V1 (clé par compte) vers la clé courante, une seule fois.
 */
function tryMigrateLegacyDraftToV2(
  accounts: MailAccountRow[],
  threadId: string | null | undefined,
  mode: ComposerMode
): MailComposerDraftStored | null {
  for (const a of accounts) {
    const legacyKey = legacyDraftStorageKey(a.id, threadId);
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(legacyKey);
    } catch {
      continue;
    }
    if (!raw) continue;
    const v1 = parseStoredDraftV1(raw);
    if (!v1) continue;
    const now = Date.now();
    const v3: MailComposerDraftStored = {
      v: MAIL_DRAFT_SCHEMA_V3,
      accountId: a.id,
      to: v1.to,
      cc: v1.cc,
      bcc: v1.bcc,
      subject: v1.subject,
      bodyHtml: v1.bodyHtml,
      updatedAt: now,
      editorInstanceId: "legacy-migrate",
    };
    try {
      const newKey = draftStorageKey(threadId, mode);
      localStorage.setItem(newKey, JSON.stringify(v3));
      localStorage.removeItem(legacyKey);
    } catch {
      return null;
    }
    return v3;
  }
  return null;
}

export interface MailComposerProps {
  mode: ComposerMode;
  accounts: MailAccountRow[];
  preferredAccountId?: string | null;
  threadId?: string | null;
  threadSubject?: string | null;
  messages: ThreadMessage[] | null | undefined;
  onClose: () => void;
  onSent: (result: { threadId: string | null }) => void;
  /** Plein panneau (nouveau message sans fil) ou modale plein écran. */
  layout?: "dock" | "standalone" | "overlay";
  /** CRM lié au fil (variables templates). */
  crmClientId?: string | null;
  crmLeadId?: string | null;
  /** Email utilisateur (exclure de Répondre à tous). */
  userEmail?: string | null;
  /** Préremplissage (document CRM, sujet, contexte lead/client) — sans dupliquer l’envoi. */
  initialPrefill?: MailComposerInitialPrefill | null;
}

export const MailComposer = React.memo(function MailComposer({
  mode,
  accounts,
  preferredAccountId,
  threadId,
  threadSubject,
  messages,
  onClose,
  onSent,
  layout = "dock",
  crmClientId = null,
  crmLeadId = null,
  userEmail = null,
  initialPrefill = null,
}: MailComposerProps) {
  const mailBodyRef = useRef<MailHtmlEditorHandle>(null);
  const lastSigInjectKeyRef = useRef<string | null>(null);
  /** Évite le double ajout des PJ CRM (StrictMode / re-exécution). */
  const crmDocumentsAttachedKeyRef = useRef<string>("");
  const replyMetaRef = useRef<{ inReplyTo?: string; references: string[] }>({ references: [] });

  const snapshot = useMemo(() => {
    const acc = resolveInitialAccountId(accounts, preferredAccountId);
    if (mode === "new") {
      replyMetaRef.current = { references: [] };
      return {
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        html: "<p><br></p>",
        fromAccountId: acc,
        showCc: false,
        showBcc: false,
      };
    }
    const msgs = messages ?? [];
    if (!msgs.length) {
      replyMetaRef.current = { references: [] };
      return {
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        html: "<p><br></p>",
        fromAccountId: acc,
        showCc: false,
        showBcc: false,
      };
    }
    if (mode === "reply" || mode === "replyAll") {
      const ctx =
        mode === "replyAll"
          ? buildReplyAllContext(msgs, threadSubject, userEmail)
          : buildReplyContext(msgs, threadSubject);
      replyMetaRef.current = { inReplyTo: ctx.inReplyTo, references: ctx.references };
      const ccVal = (ctx.cc || "").trim();
      return {
        to: ctx.to,
        cc: ccVal,
        bcc: "",
        subject: ctx.subject,
        html: "<p><br></p>",
        fromAccountId: pickThreadMailAccountId(msgs) || acc,
        showCc: ccVal.length > 0,
        showBcc: false,
      };
    }
    replyMetaRef.current = { references: [] };
    return {
      to: "",
      cc: "",
      bcc: "",
      subject: ensureFwdSubject(threadSubject),
      html: buildForwardInitialBody(msgs),
      fromAccountId: pickThreadMailAccountId(msgs) || acc,
      showCc: false,
      showBcc: false,
    };
  }, [mode, messages, threadSubject, accounts, preferredAccountId, userEmail]);

  /** Fil + mode uniquement : changement de compte « De » ne réhydrate pas (contenu conservé). */
  const stableHydrateId = useMemo(() => `${threadId ?? "new"}|${mode}`, [threadId, mode]);
  const lastHydratedIdRef = useRef<string | null>(null);

  const [to, setTo] = useState(snapshot.to);
  const [cc, setCc] = useState(snapshot.cc);
  const [bcc, setBcc] = useState(snapshot.bcc);
  const [subject, setSubject] = useState(snapshot.subject);
  const [fromAccountId, setFromAccountId] = useState(snapshot.fromAccountId);
  const [showCc, setShowCc] = useState(snapshot.showCc);
  const [showBcc, setShowBcc] = useState(snapshot.showBcc);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [sendQueueNotice, setSendQueueNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Incrémenté à chaque saisie dans l’éditeur pour déclencher l’autosave debouncé. */
  const [editorTick, setEditorTick] = useState(0);
  /** Saisie utilisateur depuis dernier enregistrement — UX « Modification… ». */
  const [isDirty, setIsDirty] = useState(false);
  const [persistBanner, setPersistBanner] = useState<"idle" | "saving" | "saved">("idle");
  const [restoredNotice, setRestoredNotice] = useState(false);
  const editorInstanceIdRef = useRef(createEditorInstanceId());
  const draftDebounceTimerRef = useRef<number | null>(null);
  const persistBannerHideTimerRef = useRef<number | null>(null);
  const restoredNoticeTimerRef = useRef<number | null>(null);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const persistDraftNow = useCallback(() => {
    if (!fromAccountId || sending) return;
    if (draftDebounceTimerRef.current != null) {
      window.clearTimeout(draftDebounceTimerRef.current);
      draftDebounceTimerRef.current = null;
    }
    setPersistBanner("saving");
    try {
      const key = draftStorageKey(threadId, mode);
      const payload: MailComposerDraftStored = {
        v: MAIL_DRAFT_SCHEMA_V3,
        accountId: fromAccountId,
        to,
        cc,
        bcc,
        subject,
        bodyHtml: mailBodyRef.current?.getHTML() ?? "",
        updatedAt: Date.now(),
        editorInstanceId: editorInstanceIdRef.current,
      };
      localStorage.setItem(key, JSON.stringify(payload));
      setIsDirty(false);
      setPersistBanner("saved");
      if (persistBannerHideTimerRef.current != null) {
        window.clearTimeout(persistBannerHideTimerRef.current);
      }
      persistBannerHideTimerRef.current = window.setTimeout(() => {
        setPersistBanner("idle");
        persistBannerHideTimerRef.current = null;
      }, 2500);
    } catch {
      setPersistBanner("idle");
    }
  }, [fromAccountId, sending, threadId, mode, to, cc, bcc, subject]);

  const onToChange = useCallback(
    (v: string) => {
      markDirty();
      setTo(v);
    },
    [markDirty]
  );
  const onCcChange = useCallback(
    (v: string) => {
      markDirty();
      setCc(v);
    },
    [markDirty]
  );
  const onBccChange = useCallback(
    (v: string) => {
      markDirty();
      setBcc(v);
    },
    [markDirty]
  );

  const [sigList, setSigList] = useState<MailSignatureRow[]>([]);
  const [selectedSigId, setSelectedSigId] = useState<string | null>(null);
  const [sigLoading, setSigLoading] = useState(false);
  const [sigError, setSigError] = useState<string | null>(null);

  const [tmplPanelOpen, setTmplPanelOpen] = useState(false);
  const [tmplList, setTmplList] = useState<MailTemplateRow[]>([]);
  const [tmplLoading, setTmplLoading] = useState(false);
  const [tmplErr, setTmplErr] = useState<string | null>(null);
  const [tmplApplyId, setTmplApplyId] = useState<string | null>(null);

  /** Remonte l’éditeur TipTap quand on recharge brouillon / snapshot (fil + mode). */
  const [composerBodyKey, setComposerBodyKey] = useState("");
  const [composerInitialHtml, setComposerInitialHtml] = useState("<p></p>");

  useLayoutEffect(() => {
    if (!accounts.length) return;

    const acc = resolveInitialAccountId(accounts, preferredAccountId);
    if (!acc) return;

    if (lastHydratedIdRef.current === stableHydrateId) {
      return;
    }
    lastHydratedIdRef.current = stableHydrateId;

    if (!threadId) {
      migrateObsoleteNewComposerKeys(mode);
    }

    const key = draftStorageKey(threadId, mode);
    const skipDraftForCrmPrefill =
      mode === "new" &&
      !threadId &&
      (Boolean(initialPrefill?.documents?.length) ||
        Boolean(initialPrefill?.bodyHtml?.trim()) ||
        Boolean(initialPrefill?.to?.trim()) ||
        Boolean(initialPrefill?.crmLeadId?.trim()));

    let raw: string | null = null;
    if (!skipDraftForCrmPrefill) {
      try {
        raw = localStorage.getItem(key);
      } catch {
        lastHydratedIdRef.current = null;
        return;
      }
    }

    let draft: MailComposerDraftStored | null = raw ? parseDraftStoredForRestore(raw) : null;
    if (!draft && !skipDraftForCrmPrefill) {
      draft = tryMigrateLegacyDraftToV2(accounts, threadId, mode);
    }

    if (draft && !skipDraftForCrmPrefill) {
      setTo(draft.to);
      setCc(draft.cc);
      setBcc(draft.bcc);
      setSubject(draft.subject);
      setShowCc(Boolean(draft.cc.trim()));
      setShowBcc(Boolean(draft.bcc.trim()));
      setFromAccountId(resolveAccountFromDraft(draft.accountId, accounts, preferredAccountId));
      setComposerInitialHtml(draft.bodyHtml || "<p></p>");
      setComposerBodyKey(`${stableHydrateId}-${Date.now()}`);
      setIsDirty(false);
      setRestoredNotice(true);
      return;
    }

    setTo(initialPrefill?.to?.trim() ? initialPrefill.to.trim() : snapshot.to);
    setCc(snapshot.cc);
    setBcc(snapshot.bcc);
    setSubject(initialPrefill?.subject?.trim() ? initialPrefill.subject.trim() : snapshot.subject);
    setFromAccountId(snapshot.fromAccountId);
    setShowCc(snapshot.showCc);
    setShowBcc(snapshot.showBcc);
    const htmlFromPrefill = initialPrefill?.bodyHtml?.trim();
    setComposerInitialHtml(htmlFromPrefill ? htmlFromPrefill : snapshot.html || "<p></p>");
    setComposerBodyKey(`${stableHydrateId}-${Date.now()}`);
    setIsDirty(false);
    setRestoredNotice(false);
  }, [
    stableHydrateId,
    snapshot,
    accounts,
    preferredAccountId,
    threadId,
    mode,
    initialPrefill?.subject,
    initialPrefill?.documents,
    initialPrefill?.to,
    initialPrefill?.bodyHtml,
  ]);

  /** Email du lead si préremplissage depuis un document lié. */
  useEffect(() => {
    if (mode !== "new" || threadId) return;
    if (initialPrefill?.to?.trim()) return;
    const lid = initialPrefill?.crmLeadId ?? crmLeadId;
    if (!lid?.trim()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${mailApiRoot()}/api/leads/${encodeURIComponent(lid.trim())}`);
        if (!res.ok || cancelled) return;
        const lead = (await res.json()) as { email?: string | null };
        const em = typeof lead.email === "string" ? lead.email.trim() : "";
        if (em) {
          setTo((prev) => (prev.trim() ? prev : em));
        }
      } catch {
        /* silencieux */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, threadId, crmLeadId, initialPrefill?.crmLeadId]);

  /** Pièces jointes depuis des documents CRM (GET download → File). */
  useEffect(() => {
    const docs = initialPrefill?.documents;
    if (!docs?.length || mode !== "new" || threadId) return;
    const runKey = `${stableHydrateId}|${docs.map((d) => d.id).sort().join(",")}`;
    if (crmDocumentsAttachedKeyRef.current === runKey) return;
    crmDocumentsAttachedKeyRef.current = runKey;
    let cancelled = false;
    (async () => {
      const additions: LocalAttachment[] = [];
      for (const d of docs) {
        if (!d.id?.trim()) continue;
        try {
          const url = `${mailApiRoot()}/api/documents/${encodeURIComponent(d.id.trim())}/download`;
          const res = await apiFetch(url);
          if (!res.ok || cancelled) continue;
          const blob = await res.blob();
          const name = d.filename?.trim() || "document";
          const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
          additions.push({ id: randomId(), file });
        } catch {
          /* ignore une pièce */
        }
      }
      if (!cancelled && additions.length) {
        setAttachments((prev) => [...additions, ...prev]);
        markDirty();
      } else if (!cancelled && additions.length === 0) {
        crmDocumentsAttachedKeyRef.current = "";
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, threadId, markDirty, stableHydrateId, initialPrefill?.documents]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!fromAccountId) return;
      setSigLoading(true);
      setSigError(null);
      try {
        const r = await getSignatures(fromAccountId);
        if (cancelled) return;
        setSigList(r.signatures ?? []);
        const def = r.defaultSignature?.id ?? r.signatures?.[0]?.id ?? null;
        setSelectedSigId(def);
      } catch (e) {
        if (!cancelled) setSigError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setSigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromAccountId]);

  useEffect(() => {
    if (mode === "new") {
      setTmplPanelOpen(true);
    }
  }, [mode]);

  useEffect(() => {
    lastSigInjectKeyRef.current = null;
  }, [stableHydrateId]);

  useEffect(() => {
    if (sigLoading) return;
    const ed = mailBodyRef.current;
    if (!ed) return;
    const row = selectedSigId ? sigList.find((s) => s.id === selectedSigId) : null;
    const inner = row?.signature_html?.trim() ? row.signature_html : "";
    const injectKey = `${fromAccountId}|${selectedSigId ?? ""}|${mode}`;
    if (lastSigInjectKeyRef.current === injectKey) return;
    lastSigInjectKeyRef.current = injectKey;
    const base = stripMailSignatureFromHtml(ed.getHTML());
    ed.setHTML(injectMailSignatureHtml(base, inner, mode), { silent: true });
    setEditorTick((x) => x + 1);
  }, [selectedSigId, sigList, mode, sigLoading, fromAccountId]);

  useEffect(() => {
    if (!tmplPanelOpen) return;
    let cancelled = false;
    (async () => {
      setTmplLoading(true);
      setTmplErr(null);
      try {
        const r = await getTemplates();
        if (!cancelled) setTmplList(r.templates ?? []);
      } catch (e) {
        if (!cancelled) setTmplErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setTmplLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tmplPanelOpen]);

  useEffect(() => {
    cleanupOldMailDrafts();
    const intervalId = window.setInterval(() => cleanupOldMailDrafts(), 60 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!restoredNotice) return;
    if (restoredNoticeTimerRef.current != null) {
      window.clearTimeout(restoredNoticeTimerRef.current);
    }
    restoredNoticeTimerRef.current = window.setTimeout(() => {
      setRestoredNotice(false);
      restoredNoticeTimerRef.current = null;
    }, 4000);
    return () => {
      if (restoredNoticeTimerRef.current != null) {
        window.clearTimeout(restoredNoticeTimerRef.current);
        restoredNoticeTimerRef.current = null;
      }
    };
  }, [restoredNotice]);

  useEffect(() => {
    return () => {
      if (persistBannerHideTimerRef.current != null) {
        window.clearTimeout(persistBannerHideTimerRef.current);
        persistBannerHideTimerRef.current = null;
      }
      if (restoredNoticeTimerRef.current != null) {
        window.clearTimeout(restoredNoticeTimerRef.current);
        restoredNoticeTimerRef.current = null;
      }
      if (draftDebounceTimerRef.current != null) {
        window.clearTimeout(draftDebounceTimerRef.current);
        draftDebounceTimerRef.current = null;
      }
    };
  }, []);

  /** Autosave brouillon (localStorage), debounce 500 ms — pas de popup. */
  useEffect(() => {
    if (!fromAccountId || sending) return;

    if (draftDebounceTimerRef.current != null) {
      window.clearTimeout(draftDebounceTimerRef.current);
    }
    draftDebounceTimerRef.current = window.setTimeout(() => {
      draftDebounceTimerRef.current = null;
      persistDraftNow();
    }, 500);

    return () => {
      if (draftDebounceTimerRef.current != null) {
        window.clearTimeout(draftDebounceTimerRef.current);
        draftDebounceTimerRef.current = null;
      }
    };
  }, [to, cc, bcc, subject, fromAccountId, threadId, mode, editorTick, sending, persistDraftNow]);

  const applyMailTemplate = useCallback(
    async (t: MailTemplateRow) => {
      const ed = mailBodyRef.current;
      if (!ed) return;
      setTmplApplyId(t.id);
      setTmplErr(null);
      setError(null);
      try {
        const currentHtml = ed.getHTML();
        const trimmed = currentHtml.trim();
        const isEmpty =
          !trimmed ||
          trimmed === "<p></p>" ||
          trimmed === "<p><br></p>" ||
          isBodyEmpty(sanitizeComposerHtml(currentHtml));

        const innerSig =
          (selectedSigId ? sigList.find((s) => s.id === selectedSigId)?.signature_html : "")?.trim() ?? "";
        const ctx = await buildMailComposerRenderContext({
          clientId: crmClientId,
          leadId: crmLeadId,
        });
        const ctxWithSig = { ...ctx, signature: innerSig };
        const { rendered } = await renderMailTemplate(t.id, ctxWithSig);

        const tplUsesSigVar = (t.body_html_template ?? "").includes("{{signature}}");

        const applyReplace = () => {
          const stripped = stripMailSignatureFromHtml(ed.getHTML());
          let bodyMerge = rendered.bodyHtml;
          if (mode === "forward") {
            const tail = extractForwardQuotedAppendix(stripped);
            if (tail) bodyMerge = rendered.bodyHtml + tail;
          }
          ed.setHTML(tplUsesSigVar ? bodyMerge : injectMailSignatureHtml(bodyMerge, innerSig, mode));
          setSubject(rendered.subject.trim());
        };

        const applyAppend = () => {
          let newBlock = rendered.bodyHtml;
          newBlock = tplUsesSigVar ? newBlock : injectMailSignatureHtml(newBlock, innerSig, mode);
          ed.setHTML(currentHtml + "<br/><br/>" + newBlock);
        };

        if (isEmpty) {
          applyReplace();
        } else {
          const replaceOk = window.confirm(
            "Un contenu est déjà présent.\n\n" +
              "Souhaitez-vous le remplacer par le modèle sélectionné ?\n\n" +
              "OK = Remplacer\n" +
              "Annuler = Ajouter à la suite"
          );
          if (replaceOk) {
            applyReplace();
          } else {
            applyAppend();
          }
        }

        setTmplPanelOpen(false);
        markDirty();
        setEditorTick((x) => x + 1);
      } catch (e) {
        setTmplErr(e instanceof Error ? e.message : String(e));
      } finally {
        setTmplApplyId(null);
      }
    },
    [crmClientId, crmLeadId, mode, selectedSigId, sigList, markDirty]
  );

  const selectedSigPreviewHtml = useMemo(() => {
    if (!selectedSigId) return "";
    const row = sigList.find((s) => s.id === selectedSigId);
    const raw = row?.signature_html?.trim() ?? "";
    return raw ? sanitizeMailHtmlDisplay(raw) : "";
  }, [selectedSigId, sigList]);

  const requestClose = useCallback(() => {
    if (sending) return;
    onClose();
  }, [sending, onClose]);

  const addFiles = useCallback(
    (files: File[]) => {
      markDirty();
      setAttachments((prev) => [...prev, ...files.map((file) => ({ id: randomId(), file }))]);
    },
    [markDirty]
  );

  const removeFile = useCallback(
    (id: string) => {
      markDirty();
      setAttachments((prev) => prev.filter((x) => x.id !== id));
    },
    [markDirty]
  );

  const validate = useCallback((): string | null => {
    if (!fromAccountId) return "Choisissez un compte expéditeur.";
    const toList = filterValidEmails(parseAddressListInput(to));
    if (toList.length === 0) return "Indiquez au moins un destinataire valide (À).";
    if (!subject.trim()) return "Le sujet est requis.";
    const html = sanitizeComposerHtml(mailBodyRef.current?.getHTML() || "");
    if (isBodyEmpty(html)) return "Le message ne peut pas être vide.";
    const ccOk = filterValidEmails(parseAddressListInput(cc));
    const bccOk = filterValidEmails(parseAddressListInput(bcc));
    if (parseAddressListInput(cc).length > ccOk.length) return "Une adresse Cc est invalide.";
    if (parseAddressListInput(bcc).length > bccOk.length) return "Une adresse Cci est invalide.";
    return null;
  }, [fromAccountId, to, subject, cc, bcc]);

  const handleSend = useCallback(async () => {
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    const htmlRaw = mailBodyRef.current?.getHTML() || "";
    const bodyHtml = sanitizeComposerHtml(htmlRaw);
    const bodyText = htmlToPlainText(htmlRaw);
    const toList = filterValidEmails(parseAddressListInput(to));
    const ccList = filterValidEmails(parseAddressListInput(cc));
    const bccList = filterValidEmails(parseAddressListInput(bcc));

    let attPayload: SendMailAttachmentPayload[] = [];
    try {
      attPayload = await Promise.all(
        attachments.map(async (a) => ({
          filename: a.file.name,
          contentBase64: await readFileAsBase64(a.file),
          contentType: a.file.type || "application/octet-stream",
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lecture d’une pièce jointe impossible.");
      return;
    }

    const meta = replyMetaRef.current;
    const payload = {
      mailAccountId: fromAccountId,
      to: toList,
      cc: ccList.length ? ccList : undefined,
      bcc: bccList.length ? bccList : undefined,
      subject: subject.trim(),
      bodyHtml,
      bodyText: bodyText || undefined,
      attachments: attPayload.length ? attPayload : undefined,
      inReplyTo: mode === "reply" || mode === "replyAll" ? meta.inReplyTo ?? undefined : undefined,
      references:
        (mode === "reply" || mode === "replyAll") && meta.references.length ? meta.references : undefined,
    };

    setSending(true);
    try {
      const res = await sendMail(payload);
      try {
        localStorage.removeItem(draftStorageKey(threadId, mode));
      } catch {
        /* ignore quota / private mode */
      }
      if (persistBannerHideTimerRef.current != null) {
        window.clearTimeout(persistBannerHideTimerRef.current);
        persistBannerHideTimerRef.current = null;
      }
      if (draftDebounceTimerRef.current != null) {
        window.clearTimeout(draftDebounceTimerRef.current);
        draftDebounceTimerRef.current = null;
      }
      setIsDirty(false);
      setPersistBanner("idle");
      setSendQueueNotice(
        res.queued !== false
          ? "Message mis en file d’envoi. Le statut apparaît dans le fil et dans la page Envois."
          : null
      );
      if (res.queued !== false) {
        window.setTimeout(() => setSendQueueNotice(null), 10_000);
      }
      onSent({ threadId: res.threadId ?? threadId ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [validate, fromAccountId, to, cc, bcc, subject, attachments, mode, threadId, onSent]);

  if (!accounts.length) {
    return (
      <div className="mail-composer mail-composer--warn">
        <p className="mail-composer__warn">Aucun compte mail actif. Configurez un compte pour envoyer.</p>
        <button type="button" className="mail-composer__ghost" onClick={onClose}>
          Fermer
        </button>
      </div>
    );
  }

  const composerRootClass =
    "mail-composer" +
    (layout === "standalone" ? " mail-composer--standalone" : "") +
    (layout === "overlay" ? " mail-composer--overlay mail-overlay-content" : "");

  return (
    <div className={composerRootClass}>
      <div className="mail-composer__head">
        <span className="mail-composer__mode">
          {mode === "new" && "Nouveau message"}
          {mode === "reply" && "Répondre"}
          {mode === "replyAll" && "Répondre à tous"}
          {mode === "forward" && "Transférer"}
        </span>
        {restoredNotice && (
          <span className="mail-composer__draft-restored" aria-live="polite">
            Brouillon restauré
          </span>
        )}
        {!restoredNotice && persistBanner === "saving" && (
          <span className="mail-composer__draft-status" aria-live="polite">
            Enregistrement…
          </span>
        )}
        {!restoredNotice && persistBanner === "saved" && (
          <span className="mail-composer__draft-status" aria-live="polite">
            Brouillon enregistré
          </span>
        )}
        {!restoredNotice && persistBanner === "idle" && isDirty && (
          <span className="mail-composer__draft-status" aria-live="polite">
            Modification…
          </span>
        )}
        {sendQueueNotice && (
          <span className="mail-composer__draft-status" aria-live="polite">
            {sendQueueNotice}
          </span>
        )}
        <div className="mail-composer__head-actions">
          <button
            type="button"
            className="mail-composer__templates-btn"
            onClick={() => setTmplPanelOpen((o) => !o)}
            disabled={sending}
            aria-expanded={tmplPanelOpen}
          >
            Choisir un modèle
          </button>
          <button type="button" className="mail-composer__close" onClick={requestClose} disabled={sending} aria-label="Fermer">
            ×
          </button>
        </div>
      </div>

      {tmplPanelOpen && (
        <div className="mail-composer__templates-panel" role="region" aria-label="Templates mail">
          {tmplLoading && <p className="mail-composer__templates-hint">Chargement…</p>}
          {tmplErr && <div className="mail-composer__templates-err">{tmplErr}</div>}
          {!tmplLoading && tmplList.length === 0 && !tmplErr && (
            <p className="mail-composer__templates-hint">Aucun template. Créez-en dans les réglages.</p>
          )}
          <ul className="mail-composer__templates-list">
            {tmplList.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="mail-composer__templates-item"
                  disabled={!!tmplApplyId || sending}
                  onClick={() => void applyMailTemplate(t)}
                >
                  <span className="mail-composer__templates-item-name">{t.name}</span>
                  {t.category?.trim() && (
                    <span className="mail-composer__templates-item-cat">{t.category}</span>
                  )}
                  {tmplApplyId === t.id ? " …" : ""}
                </button>
              </li>
            ))}
          </ul>
          <Link className="mail-composer__templates-manage" to="/settings/mail?tab=templates">
            Gérer les templates →
          </Link>
        </div>
      )}

      <div className="mail-composer__row mail-composer__row--account">
        <label className="mail-composer-field mail-composer-field--inline">
          <span className="mail-composer-field__label">De</span>
          <select
            className="mail-composer-field__select"
            value={fromAccountId}
            onChange={(e) => setFromAccountId(e.target.value)}
            disabled={sending}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {(a.display_name?.trim() || a.email) + " — " + a.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      <MailComposerRecipients
        to={to}
        cc={cc}
        bcc={bcc}
        onTo={onToChange}
        onCc={onCcChange}
        onBcc={onBccChange}
        showCc={showCc}
        showBcc={showBcc}
        onToggleCc={() => setShowCc(true)}
        onToggleBcc={() => setShowBcc(true)}
        disabled={sending}
        onFieldBlur={persistDraftNow}
      />

      <label className="mail-composer-field">
        <span className="mail-composer-field__label">Objet</span>
        <input
          type="text"
          className="mail-composer-field__input"
          value={subject}
          onChange={(e) => {
            markDirty();
            setSubject(e.target.value);
          }}
          onBlur={() => persistDraftNow()}
          disabled={sending}
        />
      </label>

      <div className="mail-composer__signature-row">
        <label className="mail-composer-field mail-composer-field--inline mail-composer-field--sig">
          <span className="mail-composer-field__label">Signature du message</span>
          <select
            className="mail-composer-field__select mail-composer-field__select--sig"
            value={selectedSigId ?? ""}
            onChange={(e) => {
              markDirty();
              setSelectedSigId(e.target.value || null);
            }}
            disabled={sending || sigLoading}
            aria-busy={sigLoading}
          >
            <option value="">— Aucune —</option>
            {sigList.map((s) => (
              <option key={s.id} value={s.id} title={shortSignaturePreview(s.signature_html, 200)}>
                {s.name}
                {s.is_default ? " (défaut)" : ""} — {shortSignaturePreview(s.signature_html, 48)}
              </option>
            ))}
          </select>
        </label>
        <Link className="mail-composer__sig-settings" to="/settings/mail?tab=signatures">
          Gérer…
        </Link>
        {sigError && <span className="mail-composer__sig-err">{sigError}</span>}
      </div>

      {selectedSigPreviewHtml ? (
        <div
          className="mail-composer__sig-preview"
          aria-label="Aperçu de la signature sélectionnée"
          dangerouslySetInnerHTML={{ __html: selectedSigPreviewHtml }}
        />
      ) : null}

      <p className="mail-composer-field__label mail-composer__body-label">Corps du message</p>
      <MailHtmlEditor
        ref={mailBodyRef}
        variant="composer"
        docKey={composerBodyKey}
        initialHtml={composerInitialHtml}
        placeholder="Rédigez votre message…"
        editable={!sending}
        onChange={() => {
          setError(null);
          markDirty();
          setEditorTick((x) => x + 1);
        }}
        onBlur={() => persistDraftNow()}
      />

      <MailComposerAttachments items={attachments} onAdd={addFiles} onRemove={removeFile} disabled={sending} />

      {error && <div className="mail-composer__err">{error}</div>}
      <div className="mail-composer__footer">
        <button type="button" className="mail-composer__send" onClick={() => void handleSend()} disabled={sending}>
          {sending ? "Mise en file…" : "Envoyer"}
        </button>
      </div>

      {mode === "forward" && (
        <p className="mail-composer__hint">
          Transfert : les pièces jointes du message source ne sont pas recopiées automatiquement — vous pouvez les joindre à
          nouveau ci-dessus.
        </p>
      )}
    </div>
  );
});
