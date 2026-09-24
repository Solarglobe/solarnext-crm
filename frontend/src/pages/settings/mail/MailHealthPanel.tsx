import type { MailHealthOverview, MailScanCounts, MailJobCounts } from '../../../services/mailApi';

function Scans({ title, counts }: { title: string; counts?: MailScanCounts }) {
  return <div><h3>{title}</h3>{counts ? <>
    <div className="mail-accts__health-grid">
      <span>En attente : {counts.pending}</span><span>En cours : {counts.scanning}</span>
      <span>Nouvelle tentative prévue : {counts.retryScheduled}</span>
      <span>Tentatives épuisées : {counts.exhausted}</span>
      <span>Scanner indisponible : {counts.unavailable}</span>
      <span>Propres : {counts.clean}</span><span>Infectés / bloqués : {counts.infected}</span>
      <span>Échecs sans reprise planifiée : {counts.failedUnscheduled}</span>
      <span>État inconnu : {counts.unknown}</span><span>Total : {counts.total}</span>
    </div>
  </> : <p>Détail des scans indisponible</p>}</div>;
}

function Jobs({ title, counts }: { title: string; counts?: MailJobCounts }) {
  return <div><h3>{title}</h3>{counts ? <div className="mail-accts__health-grid">
    <span>En file : {counts.queued}</span><span>À retenter : {counts.retrying}</span>
    <span>En cours : {counts.running}</span><span>Terminés : {counts.completed}</span>
    <span>Échoués : {counts.failed}</span><span>Non démarrés : {counts.notStarted ?? 0}</span>
    <span>État inconnu : {counts.unknown ?? 0}</span>
  </div> : <p>Détail des tâches indisponible</p>}</div>;
}

export default function MailHealthPanel({ health }: { health: MailHealthOverview }) {
  const scanner = health.scanner;
  const label = scanner?.availability === 'available' ? 'Disponible'
    : scanner?.availability === 'unavailable' ? 'Indisponible'
      : scanner?.availability === 'disabled' ? 'Désactivé' : 'État inconnu';
  return <section className="mail-accts__panel" aria-label="Santé Mail">
    <h2 className="mail-accts__panel-title">Santé Mail</h2>
    <p>Scanner : <strong>{label}</strong>{scanner?.provider ? ` (${scanner.provider})` : ''}
      {scanner?.errorCode ? ` — ${scanner.errorCode}` : ''}</p>
    <Scans title="Pièces jointes des messages" counts={health.scans?.messages} />
    <Scans title="Brouillons — pièces jointes actives" counts={health.scans?.drafts} />
    <p className="mail-accts__hint">Les éléments aux tentatives épuisées ne sont plus repris automatiquement.
      Les reprises planifiées restent dépendantes de la disponibilité du scanner.</p>
    <Jobs title="Tâches de brouillons" counts={health.jobs?.drafts} />
    <Jobs title="Classement dans Envoyés" counts={health.jobs?.sentArchive} />
    <div className="mail-accts__health-grid">
      <span>File d’envoi (statuts actifs) : {health.queues.outboxDepth}</span>
      <span>Modifications de flags (statuts actifs) : {health.queues.flagJobsDepth}</span>
      <span>Déplacements (statuts actifs) : {health.queues.moveJobsDepth}</span>
      <span>Conflits de brouillons : {health.queues.draftConflicts}</span>
    </div>
  </section>;
}
