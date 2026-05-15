/**
 * Onglet Financier — cockpit dossier (devis, facturation, assistant étude).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Quote } from "../../../services/quotes.service";
import type { Study } from "../../../services/studies.service";
import {
  fetchInvoicesByClientId,
  fetchInvoicesList,
  createQuoteDraft,
  type InvoiceListRow,
} from "../../../services/financial.api";
import {
  buildQuoteCreatePayloadFromQuotePrep,
  fetchQuotePrepEconomicItems,
} from "../../quotes/quotePrepImport";
import {
  deriveFinancialKpi,
  deriveQuotePortfolioSummary,
  deriveNextFinancialAction,
  pickPrimaryQuote,
} from "./financial/leadFinancialDerive";
import FinancialTabHeader from "./financial/FinancialTabHeader";
import FinancialPilotKpi from "./financial/FinancialPilotKpi";
import FinancialHeroQuote, { FinancialHeroEmpty } from "./financial/FinancialHeroQuote";
import FinancialStudyAssistantCompact from "./financial/FinancialStudyAssistantCompact";
import FinancialInvoicesTable from "./financial/FinancialInvoicesTable";
import FinancialSecondaryQuotesStrip from "./financial/FinancialSecondaryQuotesStrip";
import FinancialTodoPanel from "./financial/FinancialTodoPanel";
import "./financial/financial-tab.css";

interface FinancialTabProps {
  leadId: string;
  clientId: string | null | undefined;
  isLead: boolean;
  quotes: Quote[];
  quotesLoading: boolean;
  studies: Study[];
  studiesLoading: boolean;
  onRefreshQuotes: () => void | Promise<void>;
  onCreateStudy: () => void | Promise<void>;
  createStudyLoading: boolean;
  onOpenStudyCalpinage: (study: Study) => void;
  onOpenStudyQuoteBuilder: (study: Study) => void;
}

export default function FinancialTab({
  leadId,
  clientId,
  isLead,
  quotes,
  quotesLoading,
  studies,
  studiesLoading,
  onRefreshQuotes,
  
  
  onOpenStudyCalpinage,
  onOpenStudyQuoteBuilder,
}: FinancialTabProps) {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<InvoiceListRow[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  const latestStudy = useMemo(() => {
    if (studies.length === 0) return null;
    return [...studies].sort(
      (a, b) =>
        new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
    )[0];
  }, [studies]);

  const loadInvoices = useCallback(async () => {
    if (!clientId && !leadId) {
      setInvoices([]);
      return;
    }
    setInvoicesLoading(true);
    try {
      if (clientId) {
        setInvoices(await fetchInvoicesByClientId(clientId));
      } else {
        setInvoices(await fetchInvoicesList({ lead_id: leadId }));
      }
    } catch {
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  }, [clientId, leadId]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  const refreshAll = useCallback(async () => {
    await onRefreshQuotes();
    await loadInvoices();
  }, [onRefreshQuotes, loadInvoices]);

  const kpi = useMemo(() => deriveFinancialKpi(quotes, invoices), [quotes, invoices]);
  const portfolio = useMemo(() => deriveQuotePortfolioSummary(quotes), [quotes]);
  const primaryQuote = useMemo(() => pickPrimaryQuote(quotes), [quotes]);
  const nextAction = useMemo(
    () => deriveNextFinancialAction(quotes, primaryQuote, invoices.length > 0),
    [quotes, primaryQuote, invoices.length]
  );

  const handleCreateQuote = useCallback(async () => {
    try {
      if (clientId) {
        const { quote } = await createQuoteDraft({
          client_id: clientId,
          lead_id: leadId,
          items: [],
        });
        navigate(`/quotes/${quote.id}`);
        return;
      }
      const { quote } = await createQuoteDraft({
        lead_id: leadId,
        items: [],
      });
      navigate(`/quotes/${quote.id}`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Impossible de créer le devis");
    }
  }, [clientId, leadId, navigate]);

  const handleCreateFromStudy = useCallback(
    async (study: Study) => {
      try {
        const vid = study.latest_version_id;
        if (!vid) {
          window.alert("Aucune version d’étude pour pré-remplir le devis.");
          return;
        }
        const studyImportOnly = {
          study_import: {
            last_at: new Date().toISOString(),
            study_version_id: vid,
          },
        };
        const body: Parameters<typeof createQuoteDraft>[0] = {
          lead_id: leadId,
          study_id: study.id,
          study_version_id: vid,
          items: [],
          metadata: studyImportOnly,
        };
        if (clientId) body.client_id = clientId;
        try {
          const prep = await fetchQuotePrepEconomicItems(study.id, vid);
          const { items, metadata } = buildQuoteCreatePayloadFromQuotePrep(vid, prep);
          body.items = items;
          body.metadata = metadata;
        } catch {
          /* devis créé sans lignes si quote-prep indisponible */
        }
        const { quote } = await createQuoteDraft(body);
        navigate(`/quotes/${quote.id}`);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Impossible de créer le devis");
      }
    },
    [clientId, leadId, navigate]
  );

  const handleNextActionCta = useCallback(() => {
    if (!primaryQuote) {
      void handleCreateQuote();
      return;
    }
    navigate(`/quotes/${primaryQuote.id}`);
  }, [primaryQuote, navigate, handleCreateQuote]);

  const loadingKpi = quotesLoading || invoicesLoading;

  return (
    <div className="fin-cockpit">
      <FinancialTabHeader onCreateQuote={() => void handleCreateQuote()} clientId={clientId} />

      <FinancialPilotKpi
        isLead={isLead}
        kpi={kpi}
        portfolio={portfolio}
        nextAction={nextAction}
        onNextAction={handleNextActionCta}
        loading={loadingKpi}
      />

      {primaryQuote ? (
        <FinancialHeroQuote
          primary={primaryQuote}
          studies={studies}
          isLead={isLead}
          clientId={clientId}
          onRefresh={() => void refreshAll()}
        />
      ) : (
        <FinancialHeroEmpty
          latestStudy={latestStudy}
          onCreateQuote={() => void handleCreateQuote()}
          onCreateFromStudy={(s) => void handleCreateFromStudy(s)}
        />
      )}

      {primaryQuote ? (
        <FinancialSecondaryQuotesStrip quotes={quotes} excludeId={primaryQuote.id} loading={quotesLoading} />
      ) : null}

      <div className="fin-cockpit-grid">
        <FinancialStudyAssistantCompact
          studies={studies}
          studiesLoading={studiesLoading}
          onOpenCalpinage={onOpenStudyCalpinage}
          onOpenQuoteBuilder={onOpenStudyQuoteBuilder}
          onCreateCommercialFromStudy={(s) => void handleCreateFromStudy(s)}
        />
        <FinancialInvoicesTable
          invoices={invoices}
          loading={invoicesLoading}
          onOpenDetail={(id) => navigate(`/invoices/${id}`)}
          onRefresh={() => void loadInvoices()}
          clientId={clientId}
          leadId={leadId}
        />
      </div>

      <FinancialTodoPanel quotes={quotes} invoices={invoices} onOpenInvoice={(id) => navigate(`/invoices/${id}`)} />
    </div>
  );
}
