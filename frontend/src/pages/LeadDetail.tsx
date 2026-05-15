/**
 * CP-LEAD-V3 — Fiche Lead/Client
 * Composant page pur JSX — toute la logique est dans useLeadDetail().
 * Route : /leads/:id
 */

import { useNavigate } from "react-router-dom";
import { getCrmApiBase } from "../config/crmApiBase";
import MissionCreateModal from "../modules/planning/MissionCreateModal";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { ModalShell } from "../components/ui/ModalShell";
import { Button } from "../components/ui/Button";
import { UndoToast } from "../components/ui/UndoToast";
import { DPRefusedModal } from "../modules/leads/DPRefusedModal";
import { PROJECT_CYCLE_LABELS } from "../modules/leads/LeadDetail/constants";
import {
  LeadHeader,
  LeadTabs,
  ActionBar,
  OverviewTab,
  StudiesTab,
  NotesTab,
  RdvTab,
  HistoryTab,
  DocumentsTab,
  FinancialTab,
} from "../modules/leads/LeadDetail";
import LeadDetailStickyBar from "../modules/leads/LeadDetail/LeadDetailStickyBar";
import LeadClientAssociationCard from "../modules/leads/LeadDetail/LeadClientAssociationCard";
import LeadMetersBar from "../modules/leads/LeadDetail/LeadMetersBar";
import LeadMeterModal from "../modules/leads/LeadDetail/LeadMeterModal";
import "../modules/leads/LeadDetail/lead-detail.css";
import { useLeadDetail } from "../hooks/lead/useLeadDetail";

const API_BASE = getCrmApiBase();

export default function LeadDetail() {
  const navigate = useNavigate();
  const ld = useLeadDetail();

  if (ld.loading) {
    return (
      <div className="crm-lead-page">
        <div className="crm-lead-loading">Chargement…</div>
      </div>
    );
  }

  if (ld.error && !ld.data) {
    return (
      <div className="crm-lead-page">
        <div className="crm-lead-error">
          <p>{ld.error}</p>
          <button type="button" className="sn-btn sn-btn-primary" onClick={() => navigate(-1)}>
            Retour
          </button>
        </div>
      </div>
    );
  }

  if (!ld.data) return null;

  const headerActions = ld.isArchived ? (
    <button
      type="button"
      className="sn-btn sn-btn-ghost sn-btn-sm crm-lead-header-v4-back"
      disabled={ld.isReadOnly}
      onClick={() => void ld.handleUnarchiveLead()}
    >
      ♻️ Restaurer
    </button>
  ) : (
    <button
      type="button"
      className="sn-btn sn-btn-ghost sn-btn-sm crm-lead-header-v4-back"
      disabled={ld.isReadOnly}
      onClick={ld.handleArchiveLeadRequest}
    >
      📁 Archiver
    </button>
  );

  return (
    <div className={`crm-lead-page${ld.isArchived ? " crm-lead-page--archived" : ""}`}>
      {ld.leadStickyBarVisible ? (
        <LeadDetailStickyBar
          fullName={ld.fullName || "Sans nom"}
          contactName={
            [ld.displayLead?.contact_first_name, ld.displayLead?.contact_last_name]
              .filter(Boolean)
              .join(" ") || undefined
          }
          customerType={ld.displayLead?.customer_type}
          status={ld.headerTypeStatus}
          isArchived={ld.isArchived}
          phone={ld.displayLead?.phone_mobile ?? ld.displayLead?.phone ?? ""}
          source={ld.displayLead?.source_name ?? ld.displayLead?.lead_source ?? ""}
          saveSyncState={ld.saveSyncState}
          onRetrySave={() => void ld.performOverviewSave()}
          onBack={() => navigate(-1)}
          showStudyButtons={ld.isLead && ld.data.stage?.code !== "SIGNED"}
          onStudyClick={() => ld.setActiveTab("studies")}
          onCreateStudy={ld.handleCreateStudy}
          createStudyLoading={ld.createStudyLoading}
          showRevertToLead={ld.isClient && !ld.isArchived}
          onRevertToLead={() => ld.setRevertConfirmOpen(true)}
          revertSaving={ld.revertSaving}
          statusSaving={ld.statusSaving}
          actions={headerActions}
          readOnly={ld.isReadOnly}
          leadStatusCode={ld.displayLead?.status}
          stageName={ld.displayLead?.stage_name ?? ld.data.stage?.name}
          stageCode={ld.data.stage?.code}
        />
      ) : null}

      <div ref={ld.headerZoneRef} className="crm-lead-detail-header-zone">
        <LeadHeader
          fullName={ld.fullName || "Sans nom"}
          customerType={ld.displayLead?.customer_type}
          companyName={ld.displayLead?.company_name}
          contactName={
            [ld.displayLead?.contact_first_name, ld.displayLead?.contact_last_name]
              .filter(Boolean)
              .join(" ") || undefined
          }
          status={ld.headerTypeStatus}
          projectStatus={ld.displayLead?.project_status ?? ld.data.lead.project_status ?? "SIGNE"}
          phone={ld.displayLead?.phone_mobile ?? ld.displayLead?.phone ?? ""}
          email={ld.displayLead?.email ?? ""}
          commercialEmail={ld.commercialEmail}
          source={ld.displayLead?.source_name ?? ld.displayLead?.lead_source ?? ""}
          isLead={ld.isLead}
          hasClientId={!!ld.data.lead.client_id}
          onBack={() => navigate(-1)}
          onProjectStatusIntent={(v) => void ld.handleProjectStatusIntent(v)}
          showProjectCycle={ld.isClient}
          showRevertToLead={ld.isClient && !ld.isArchived}
          onRevertToLead={() => ld.setRevertConfirmOpen(true)}
          revertSaving={ld.revertSaving}
          onStatusChange={ld.handleStatusChange}
          onRdvClick={() => ld.setCreateMissionModalOpen(true)}
          statusSaving={ld.statusSaving}
          saveSyncState={ld.saveSyncState}
          onRetrySave={() => void ld.performOverviewSave()}
          isArchived={ld.isArchived}
          actions={headerActions}
          readOnly={ld.isReadOnly}
          onWriteEmail={
            ld.displayLead?.email?.trim() && ld.id
              ? () => void ld.openComposeForLeadEmail(ld.displayLead!.email!, ld.id!)
              : undefined
          }
          leadStatusCode={ld.displayLead?.status}
          stageName={ld.displayLead?.stage_name ?? ld.data.stage?.name}
          stageCode={ld.data.stage?.code}
        />

        {ld.error && (
          <div className="crm-lead-calc-error" role="alert" style={{ marginBottom: 16 }}>
            {ld.error}
          </div>
        )}

        {ld.id ? (
          <LeadClientAssociationCard
            leadId={ld.id}
            clientId={ld.data.lead.client_id}
            readOnly={ld.isReadOnly || ld.isArchived}
          />
        ) : null}

        <ActionBar
          isLead={ld.isLead}
          showStudyButtons={ld.isLead && ld.data.stage?.code !== "SIGNED"}
          onStudyClick={() => ld.setActiveTab("studies")}
          onCreateStudy={ld.handleCreateStudy}
          createStudyLoading={ld.createStudyLoading}
          onRunCalc={ld.handleRunCalc}
          calcLoading={ld.calcLoading}
          studiesCount={ld.studies.length}
          calcSummary={ld.calcSummary}
          stages={ld.data.stages}
          currentStageId={ld.data.lead.stage_id}
          onStageChange={ld.handleStageChange}
          stageChanging={ld.stageChanging}
          readOnly={ld.isReadOnly}
        />

        {ld.dpFolderAccessible && ld.id ? (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="sn-btn sn-btn-primary sn-btn-sm"
              disabled={ld.isReadOnly}
              onClick={() => { if (ld.isReadOnly) return; navigate(`/leads/${ld.id}/dp`); }}
            >
              Créer / Continuer le dossier DP
            </button>
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
        title="Nom de l'étude"
        subtitle='« Modifier le titre » renomme cette étude. « Créer une copie » ajoute une deuxième étude sur le dossier (même contenu).'
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
              {ld.studyDuplicateBusy ? "Copie…" : "Créer une copie"}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={ld.studyTitleSaving || ld.studyDuplicateBusy || ld.isReadOnly}
              onClick={ld.handleSaveStudyTitle}
            >
              {ld.studyTitleSaving ? "Enregistrement…" : "Modifier le titre"}
            </Button>
          </>
        }
      >
        <label
          htmlFor="study-rename-input"
          style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-muted)" }}
        >
          Nom (titre ou libellé de la copie)
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

      <ConfirmModal
        open={ld.archiveConfirmOpen}
        title="Archiver ce lead ?"
        message="Le lead sera retiré des actifs mais restera accessible dans les archives."
        confirmLabel="Archiver"
        cancelLabel="Annuler"
        variant="default"
        onCancel={() => ld.setArchiveConfirmOpen(false)}
        onConfirm={() => void ld.performArchiveLead()}
      />

      <ConfirmModal
        open={ld.revertConfirmOpen}
        title="Revenir en lead ?"
        message="Le dossier repassera dans la liste Leads. La fiche client sera supprimée s'il n'y a pas de facture ni d'avoir lié."
        confirmLabel="Revenir en lead"
        cancelLabel="Annuler"
        variant="warning"
        confirmDisabled={ld.revertSaving}
        cancelDisabled={ld.revertSaving}
        onCancel={() => !ld.revertSaving && ld.setRevertConfirmOpen(false)}
        onConfirm={() => void ld.performRevertToLead()}
      />

      <ConfirmModal
        open={ld.confirmProjectOpen}
        title="Confirmer le changement de statut"
        message={
          ld.pendingProjectStatus
            ? `Passer le cycle projet à « ${
                PROJECT_CYCLE_LABELS[ld.pendingProjectStatus] ??
                ld.pendingProjectStatus.replace(/_/g, " ")
              } » ?`
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
