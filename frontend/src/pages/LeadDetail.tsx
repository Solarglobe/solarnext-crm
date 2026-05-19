/**
 * CP-LEAD-V3 - Fiche Lead/Client
 * Composant page pur JSX - toute la logique est dans useLeadDetail().
 * Route : /leads/:id
 */

import { useNavigate } from "react-router-dom";
import { getCrmApiBase } from "../config/crmApiBase";
import MissionCreateModal from "../modules/planning/MissionCreateModal";
import {
  ActionBar as UiActionBar,
  Button,
  ConfirmDialog,
  EmptyState,
  KpiStrip,
  ModalShell,
  PageHeader,
} from "../components/ui";
import { UndoToast } from "../components/ui/UndoToast";
import { CrmLeadStatusBadge } from "../components/crm/CrmLeadStatusBadge";
import { DPRefusedModal } from "../modules/leads/DPRefusedModal";
import { CYCLE_PROJECT_SELECT_OPTIONS, PROJECT_CYCLE_LABELS } from "../modules/leads/LeadDetail/constants";
import {
  LeadTabs,
  OverviewTab,
  StudiesTab,
  NotesTab,
  RdvTab,
  HistoryTab,
  DocumentsTab,
  FinancialTab,
} from "../modules/leads/LeadDetail";
import LeadClientAssociationCard from "../modules/leads/LeadDetail/LeadClientAssociationCard";
import LeadMetersBar from "../modules/leads/LeadDetail/LeadMetersBar";
import LeadMeterModal from "../modules/leads/LeadDetail/LeadMeterModal";
import LeadPipelineBar from "../modules/leads/LeadDetail/LeadPipelineBar";
import { formatEuroAmount, formatProductionKwh } from "../modules/leads/LeadDetail/leadEnergyFormat";
import "../modules/leads/LeadDetail/lead-detail.css";
import { useLeadDetail } from "../hooks/lead/useLeadDetail";

const API_BASE = getCrmApiBase();

type SaveSyncState = "idle" | "pending" | "saving" | "saved" | "error";

function saveSyncLabel(state: SaveSyncState): string {
  if (state === "error") return "Sauvegarde a reprendre";
  if (state === "pending") return "Modifications en attente";
  if (state === "saving") return "Sauvegarde...";
  return "Sauvegarde";
}

function saveSyncBadgeClass(state: SaveSyncState): string {
  if (state === "error") return "sn-badge-danger";
  if (state === "pending" || state === "saving") return "sn-badge-warn";
  return "sn-badge-success";
}

export default function LeadDetail() {
  const navigate = useNavigate();
  const ld = useLeadDetail();

  if (ld.loading) {
    return (
      <div className="crm-lead-page">
        <EmptyState title="Chargement de la fiche" description="Les informations commerciales arrivent." />
      </div>
    );
  }

  if (ld.error && !ld.data) {
    return (
      <div className="crm-lead-page">
        <EmptyState
          title="Fiche indisponible"
          description={ld.error}
          actions={
            <Button type="button" variant="primary" onClick={() => navigate(-1)}>
              Retour
            </Button>
          }
        />
      </div>
    );
  }

  if (!ld.data) return null;

  const contactName =
    [ld.displayLead?.contact_first_name, ld.displayLead?.contact_last_name].filter(Boolean).join(" ") ||
    undefined;
  const phone = ld.displayLead?.phone_mobile ?? ld.displayLead?.phone ?? "";
  const email = ld.displayLead?.email ?? "";
  const source = ld.displayLead?.source_name ?? ld.displayLead?.lead_source ?? "";
  const stageName = ld.displayLead?.stage_name ?? ld.data.stage?.name;
  const canCreateStudy = ld.isLead && ld.data.stage?.code !== "SIGNED";
  const canCreateRdv = Boolean(ld.data.lead.client_id);
  const canWriteEmail = Boolean(email.trim() && ld.id);
  const calcAnnualKwh =
    ld.calcSummary?.annual_kwh != null && Number.isFinite(Number(ld.calcSummary.annual_kwh))
      ? Number(ld.calcSummary.annual_kwh)
      : null;
  const calcCapexTtc =
    ld.calcSummary?.capex_ttc != null && Number.isFinite(Number(ld.calcSummary.capex_ttc))
      ? Number(ld.calcSummary.capex_ttc)
      : null;
  const kpis = [
    ld.studies.length
      ? { id: "studies", label: "Etudes", value: ld.studies.length, hint: "dossier commercial" }
      : null,
    calcAnnualKwh != null
      ? {
          id: "production",
          label: "Production",
          value: formatProductionKwh(calcAnnualKwh),
          hint: "estimation annuelle",
        }
      : null,
    calcCapexTtc != null
      ? {
          id: "capex",
          label: "Budget",
          value: formatEuroAmount(calcCapexTtc),
          hint: "TTC estime",
        }
      : null,
    ld.quotes.length ? { id: "quotes", label: "Devis", value: ld.quotes.length, hint: "finance" } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <div className={`crm-lead-page${ld.isArchived ? " crm-lead-page--archived" : ""}`}>
      <div ref={ld.headerZoneRef} className="crm-lead-detail-header-zone crm-lead-detail-header-zone--foundation">
        <PageHeader
          eyebrow={ld.isClient ? "Fiche client" : "Fiche lead"}
          title={ld.fullName || "Sans nom"}
          description={
            <span className="crm-lead-foundation-description">
              {ld.displayLead?.company_name ? <strong>{ld.displayLead.company_name}</strong> : null}
              {ld.displayLead?.company_name && contactName ? <span aria-hidden> · </span> : null}
              {contactName ? <span>{contactName}</span> : null}
              {(ld.displayLead?.company_name || contactName) && source ? <span aria-hidden> · </span> : null}
              {source ? <span>Source {source}</span> : null}
            </span>
          }
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => navigate(-1)}>
                Retour
              </Button>
              {ld.isArchived ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={ld.isReadOnly}
                  onClick={() => void ld.handleUnarchiveLead()}
                >
                  Restaurer
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ld.isReadOnly}
                  onClick={ld.handleArchiveLeadRequest}
                >
                  Archiver
                </Button>
              )}
            </>
          }
          meta={
            <>
              <CrmLeadStatusBadge
                status={ld.displayLead?.status}
                stageName={stageName}
                stageCode={ld.data.stage?.code}
              />
              {ld.isArchived ? <span className="sn-badge sn-badge-danger">Archive</span> : null}
              {stageName ? <span className="sn-badge sn-badge-info">{stageName}</span> : null}
              <span className={`sn-badge ${saveSyncBadgeClass(ld.saveSyncState)}`}>
                {saveSyncLabel(ld.saveSyncState)}
              </span>
              {ld.saveSyncState === "error" ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => void ld.performOverviewSave()}>
                  Reessayer
                </Button>
              ) : null}
            </>
          }
        />

        <div className="crm-lead-foundation-contact-row" aria-label="Coordonnees principales">
          {phone ? <a href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a> : <span>Telephone non renseigne</span>}
          {email ? <span title={email}>{email}</span> : <span>Email non renseigne</span>}
          <span>Commercial {ld.commercialEmail || "non assigne"}</span>
        </div>

        {ld.error ? (
          <div className="crm-lead-calc-error" role="alert">
            {ld.error}
          </div>
        ) : null}

        <UiActionBar
          className="crm-lead-foundation-actions"
          primary={
            <>
              {canCreateStudy ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={ld.createStudyLoading || ld.isReadOnly}
                  onClick={ld.handleCreateStudy}
                >
                  {ld.createStudyLoading ? "Creation..." : "Creer etude"}
                </Button>
              ) : null}
              {ld.isLead ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => ld.setActiveTab("studies")}>
                  Voir les etudes ({ld.studies.length})
                </Button>
              ) : null}
              {canCreateRdv ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={ld.isReadOnly}
                  onClick={() => ld.setCreateMissionModalOpen(true)}
                >
                  Creer RDV
                </Button>
              ) : null}
              {canWriteEmail ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={ld.isReadOnly}
                  onClick={() => void ld.openComposeForLeadEmail(email, ld.id!)}
                >
                  Envoyer email
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={() => ld.setActiveTab("documents")}>
                Documents
              </Button>
              {ld.dpFolderAccessible && ld.id ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={ld.isReadOnly}
                  onClick={() => {
                    if (ld.isReadOnly) return;
                    navigate(`/leads/${ld.id}/dp`);
                  }}
                >
                  Dossier DP
                </Button>
              ) : null}
              {ld.isLead ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ld.calcLoading || ld.isReadOnly}
                  onClick={ld.handleRunCalc}
                >
                  {ld.calcLoading ? "Calcul..." : "Lancer calcul"}
                </Button>
              ) : null}
            </>
          }
          secondary={
            <>
              {ld.isClient ? (
                <label className="crm-lead-foundation-select-label">
                  <span>Cycle</span>
                  <select
                    className="crm-lead-foundation-select"
                    value={ld.displayLead?.project_status ?? ld.data.lead.project_status ?? "SIGNE"}
                    onChange={(e) => void ld.handleProjectStatusIntent(e.target.value)}
                    disabled={ld.isArchived || ld.isReadOnly}
                    aria-label="Cycle projet"
                  >
                    {CYCLE_PROJECT_SELECT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {ld.isClient && !ld.isArchived ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ld.revertSaving || ld.isReadOnly}
                  onClick={() => ld.setRevertConfirmOpen(true)}
                >
                  {ld.revertSaving ? "Retour..." : "Revenir en lead"}
                </Button>
              ) : null}
              {ld.isLead && !ld.isArchived ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={ld.statusSaving || ld.isReadOnly}
                  onClick={() => ld.handleStatusChange("CLIENT")}
                >
                  {ld.statusSaving ? "Conversion..." : "Convertir client"}
                </Button>
              ) : null}
            </>
          }
        />

        {ld.isLead && ld.data.stages.length ? (
          <section className="crm-lead-foundation-pipeline" aria-label="Pipeline commercial">
            <div className="crm-lead-foundation-section-heading">
              <span>Pipeline</span>
              {ld.stageChanging ? <small>mise a jour...</small> : null}
            </div>
            <LeadPipelineBar
              stages={ld.data.stages}
              currentStageId={ld.data.lead.stage_id}
              onStageChange={ld.handleStageChange}
              disabled={ld.stageChanging || ld.isReadOnly}
            />
          </section>
        ) : null}

        {kpis.length ? <KpiStrip items={kpis} className="crm-lead-foundation-kpis" /> : null}

        {ld.id ? (
          <div className="crm-lead-foundation-association">
            <LeadClientAssociationCard
              leadId={ld.id}
              clientId={ld.data.lead.client_id}
              readOnly={ld.isReadOnly || ld.isArchived}
            />
          </div>
        ) : null}
      </div>

      <LeadTabs
        activeTab={ld.activeTab}
        onTabChange={(t) => void ld.handleLeadTabChange(t)}
        tabCounts={{
          studies: ld.studies.length,
          notes: ld.notes.length,
          rdv: ld.clientMissions.length,
          documents: ld.documents.length,
          financial: ld.quotes.length,
          history: ld.historyItems.length,
        }}
      >
        {ld.activeTab === "overview" && (
          <OverviewTab
            lead={ld.formLead ?? ld.data.lead}
            siteAddress={ld.data.site_address}
            addressInput={ld.addressInput}
            setAddressInput={ld.setAddressInput}
            consumptionMonthly={ld.monthlyLocal}
            users={ld.users}
            leadSources={ld.leadSources}
            onLeadChange={ld.handleFormLeadChange}
            onMonthlyConsumptionChange={ld.handleMonthlyLocalChange}
            onMonthlyGridEditingChange={ld.setMonthlyGridEditing}
            onFlushOverviewSave={() => void ld.flushOverviewSave()}
            geoValidationModalOpen={ld.geoValidationModalOpen}
            onOpenGeoValidation={() => ld.setGeoValidationModalOpen(true)}
            onGeoValidationModalClose={() => ld.setGeoValidationModalOpen(false)}
            onAddressSelect={ld.handleAddressSelect}
            onManualMapPlacement={ld.handleManualMapPlacement}
            onGeoValidationSuccess={ld.fetchLead}
            energyEngine={ld.energyEngine}
            onEnergyEngineChange={ld.handleEnergyEngineChange}
            onDeleteEnergyProfile={ld.handleDeleteEnergyProfile}
            energyProfileSuccessMessage={ld.energyProfileSuccessMessage}
            apiBase={API_BASE}
            leadOverview={{ studies: ld.studies, activities: ld.activities }}
            metersBar={
              <LeadMetersBar
                meters={ld.metersBarMeters}
                metersFetchError={ld.metersLoadPhase === "error" ? ld.metersFetchError : null}
                selectedId={ld.selectedMeterId}
                onOpenMeter={(mid) => void ld.handleOpenMeterEditModal(mid)}
                onRequestAdd={() => void ld.handleOpenMeterCreateModal()}
                onSetDefault={(mid) => void ld.handleSetDefaultMeter(mid)}
                onDelete={(mid) => void ld.handleDeleteMeter(mid)}
                busy={ld.metersBusy}
              />
            }
            showEnergyConsoBody={ld.showEnergyConsoBody}
            energyConsoBlockedSummary={ld.energySectionSummary}
            hasMeters={ld.metersLoadPhase === "ready" && ld.metersList.length > 0}
            readOnly={ld.isReadOnly}
          />
        )}
        {ld.activeTab === "studies" && (
          <StudiesTab
            studies={ld.studies}
            studiesLoading={ld.studiesLoading}
            onCreateStudy={ld.handleCreateStudy}
            createStudyLoading={ld.createStudyLoading}
            onStudiesChange={ld.fetchStudies}
            canCreate={ld.isLead}
            onEditStudy={(s) => {
              ld.setStudyTitleModalStudy(s);
              ld.setStudyTitleDraft(s.title?.trim() ?? "");
            }}
            onOpenCalpinage={ld.handleOpenStudyCalpinage}
            onOpenTechnicalQuote={ld.handleOpenStudyQuoteBuilder}
          />
        )}
        {ld.activeTab === "notes" && (
          <NotesTab
            notes={ld.notes}
            notesLoading={ld.activitiesLoading}
            addFormOpen={ld.addNotesFormOpen}
            setAddFormOpen={ld.setAddNotesFormOpen}
            addActivityType={ld.addActivityType}
            setAddActivityType={ld.setAddActivityType}
            addActivityTitle={ld.addActivityTitle}
            setAddActivityTitle={ld.setAddActivityTitle}
            addActivityContent={ld.addActivityContent}
            setAddActivityContent={ld.setAddActivityContent}
            addActivitySaving={ld.addActivitySaving}
            onAddActivity={ld.handleAddActivity}
            editingActivityId={ld.editingActivityId}
            setEditingActivityId={ld.setEditingActivityId}
            editContent={ld.editContent}
            setEditContent={ld.setEditContent}
            onEditActivity={ld.handleEditActivity}
            onDeleteActivity={ld.handleDeleteActivity}
          />
        )}
        {ld.activeTab === "rdv" && (
          <RdvTab
            missions={ld.clientMissions}
            missionsLoading={ld.clientMissionsLoading}
            onNewRdv={() => ld.setCreateMissionModalOpen(true)}
            isLead={ld.isLead}
          />
        )}
        {ld.activeTab === "history" && (
          <HistoryTab historyItems={ld.historyItems} loading={ld.activitiesLoading} />
        )}
        {ld.activeTab === "documents" && (
          <DocumentsTab
            leadId={ld.data.lead.id}
            leadDocuments={ld.documents}
            clientId={ld.data.lead.client_id}
            clientDocuments={ld.clientDocuments}
            onRefresh={ld.fetchDocuments}
          />
        )}
        {ld.activeTab === "financial" && (
          <FinancialTab
            leadId={ld.data.lead.id}
            clientId={ld.data.lead.client_id}
            quotes={ld.quotes}
            quotesLoading={ld.quotesLoading}
            isLead={ld.isLead}
            studies={ld.studies}
            studiesLoading={ld.studiesLoading}
            onRefreshQuotes={ld.fetchQuotes}
            onCreateStudy={ld.handleCreateStudy}
            createStudyLoading={ld.createStudyLoading}
            onOpenStudyCalpinage={ld.handleOpenStudyCalpinage}
            onOpenStudyQuoteBuilder={ld.handleOpenStudyQuoteBuilder}
          />
        )}
      </LeadTabs>

      <ModalShell
        open={!!ld.studyTitleModalStudy}
        onClose={() => {
          if (!ld.studyTitleSaving && !ld.studyDuplicateBusy) ld.setStudyTitleModalStudy(null);
        }}
        size="sm"
        title="Nom de l'etude"
        subtitle='"Modifier le titre" renomme cette etude. "Creer une copie" ajoute une deuxieme etude sur le dossier (meme contenu).'
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={ld.studyTitleSaving || ld.studyDuplicateBusy}
              onClick={() => ld.setStudyTitleModalStudy(null)}
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={ld.studyTitleSaving || ld.studyDuplicateBusy || ld.isReadOnly}
              onClick={() => void ld.handleCreateStudyDuplicateFromTitleModal()}
            >
              {ld.studyDuplicateBusy ? "Copie..." : "Creer une copie"}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={ld.studyTitleSaving || ld.studyDuplicateBusy || ld.isReadOnly}
              onClick={ld.handleSaveStudyTitle}
            >
              {ld.studyTitleSaving ? "Enregistrement..." : "Modifier le titre"}
            </Button>
          </>
        }
      >
        <label
          htmlFor="study-rename-input"
          style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-muted)" }}
        >
          Nom (titre ou libelle de la copie)
        </label>
        <input
          id="study-rename-input"
          className="sn-input"
          style={{ width: "100%", boxSizing: "border-box" }}
          value={ld.studyTitleDraft}
          onChange={(e) => ld.setStudyTitleDraft(e.target.value)}
          disabled={ld.studyTitleSaving || ld.studyDuplicateBusy || ld.isReadOnly}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (!(ld.studyTitleSaving || ld.studyDuplicateBusy || ld.isReadOnly)) {
              void ld.handleSaveStudyTitle();
            }
          }}
          autoFocus
        />
      </ModalShell>

      {ld.createMissionModalOpen && (
        <MissionCreateModal
          clientId={ld.data?.lead?.client_id || undefined}
          onClose={() => ld.setCreateMissionModalOpen(false)}
          onCreated={(mission) => {
            ld.setCreateMissionModalOpen(false);
            if (ld.isLead) {
              ld.setClientMissions((prev) => [...prev, mission]);
            } else {
              ld.fetchClientMissions();
            }
          }}
        />
      )}

      <ConfirmDialog
        open={ld.archiveConfirmOpen}
        title="Archiver ce lead ?"
        description="Le lead sera retire des actifs mais restera accessible dans les archives."
        confirmLabel="Archiver"
        cancelLabel="Annuler"
        onCancel={() => ld.setArchiveConfirmOpen(false)}
        onConfirm={() => void ld.performArchiveLead()}
      />

      <ConfirmDialog
        open={ld.revertConfirmOpen}
        title="Revenir en lead ?"
        description="Le dossier repassera dans la liste Leads. La fiche client sera supprimee s'il n'y a pas de facture ni d'avoir lie."
        confirmLabel="Revenir en lead"
        cancelLabel="Annuler"
        variant="warning"
        loading={ld.revertSaving}
        onCancel={() => !ld.revertSaving && ld.setRevertConfirmOpen(false)}
        onConfirm={() => void ld.performRevertToLead()}
      />

      <ConfirmDialog
        open={ld.confirmProjectOpen}
        title="Confirmer le changement de statut"
        description={
          ld.pendingProjectStatus
            ? `Passer le cycle projet a "${
                PROJECT_CYCLE_LABELS[ld.pendingProjectStatus] ?? ld.pendingProjectStatus.replace(/_/g, " ")
              }" ?`
            : ""
        }
        confirmLabel="Confirmer"
        cancelLabel="Annuler"
        variant="warning"
        onCancel={() => {
          ld.setConfirmProjectOpen(false);
          ld.setPendingProjectStatus(null);
        }}
        onConfirm={() => void ld.confirmProjectApply()}
      />

      <DPRefusedModal
        open={ld.dpRefusedOpen}
        busy={ld.dpRefusedBusy}
        onClose={() => !ld.dpRefusedBusy && ld.setDpRefusedOpen(false)}
        onChoose={ld.handleDpRefusedChoose}
      />

      {ld.data.lead.id && ld.meterModalOpen && ld.meterModalMode ? (
        <LeadMeterModal
          open={ld.meterModalOpen}
          mode={ld.meterModalMode === "edit" ? "edit" : "create"}
          meterId={ld.meterModalMode === "edit" ? ld.meterModalMeterId : null}
          leadId={ld.data.lead.id}
          apiBase={API_BASE}
          nextMeterOrdinal={ld.metersList.length + 1}
          onClose={ld.handleMeterModalClose}
          onSaveSuccess={(r) => void ld.handleMeterSaveSuccess(r)}
        />
      ) : null}

      {ld.activeToast ? (
        <UndoToast
          message={ld.activeToast.message}
          secondsLeft={ld.activeToast.secondsLeft}
          onUndo={ld.activeToast.onUndo}
          onPauseChange={ld.activeToast.onHoverPause}
        />
      ) : null}
    </div>
  );
}
