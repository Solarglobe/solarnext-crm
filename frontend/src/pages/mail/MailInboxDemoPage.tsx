import "./mail-inbox.css";
import { PageHeader } from "../../components/ui";

const folders = [
  { name: "Inbox", count: 128, depth: 0, active: true },
  { name: "Sent", count: 0, depth: 0 },
  { name: "Archive", count: 0, depth: 0 },
  { name: "Trash", count: 7, depth: 0 },
  { name: "Chantiers / très long dossier imbriqué avec client résidentiel", count: 14, depth: 1 },
  { name: "SAV", count: 2, depth: 2 },
  { name: "Secteur nord / agence / pose / attente mairie / relance très longue", count: 103, depth: 5 },
];

const threads = [
  {
    sender: "Claire Martin avec un nom d'expéditeur inhabituellement long pour vérifier l'ellipse",
    subject: "Devis solaire résidentiel - retour signé et demande de précision technique extrêmement longue avec objet qui doit rester lisible sans couper les actions",
    preview: "Bonjour, nous avons relu le devis et souhaitons confirmer la batterie virtuelle...",
    time: "09:42",
    unread: true,
    count: 4,
    account: "contact@solarglobe.fr",
    state: "",
  },
  {
    sender: "Outlook Sync",
    subject: "Synchronisation partielle du dossier historique",
    preview: "Erreur temporaire sur le dossier distant, nouvelle tentative planifiée.",
    time: "Hier",
    unread: false,
    count: 1,
    account: "support@solarglobe.fr",
    state: "Erreur sync",
  },
  {
    sender: "Marc Dubois",
    subject: "Photos toiture et pièces jointes",
    preview: "Vous trouverez les photos demandées en pièce jointe.",
    time: "Lun.",
    unread: true,
    count: 2,
    account: "contact@solarglobe.fr",
    state: "PJ",
  },
];

export default function MailInboxDemoPage() {
  return (
    <div className="mail-standard-page">
      <PageHeader
        eyebrow="Mail demo"
        title="Inbox"
        actions={<button type="button" className="mail-inbox__new-btn">+ Nouveau message</button>}
        meta={<span className="sn-badge sn-badge-info">128 non lus</span>}
      />
      <div className="mail-inbox mail-inbox--split">
        <aside className="mail-inbox__nav-mail" aria-label="Navigation boîte mail demo">
          <nav className="mail-inbox__nav-list">
            <button type="button" className="mail-inbox__account-heading" aria-expanded="true">
              <span className="mail-inbox__account-heading-main">
                <span className="mail-inbox__account-chevron" aria-hidden>⌄</span>
                <span className="mail-inbox__account-heading-label">contact@solarglobe.fr</span>
              </span>
              <span className="mail-inbox__account-health">Synchronisé</span>
            </button>
            {folders.map((folder) => (
              <button
                key={folder.name}
                type="button"
                className={`mail-inbox__nav-item${folder.active ? " mail-inbox__nav-item--active" : ""}`}
                style={{ paddingLeft: `${12 + folder.depth * 14}px` }}
              >
                <span className="mail-inbox__nav-item-label">{folder.name}</span>
                {folder.count > 0 ? <span className="sn-badge sn-badge-info mail-inbox__account-sn-tweak">{folder.count > 99 ? "99+" : folder.count}</span> : null}
              </button>
            ))}
            <button type="button" className="mail-inbox__account-heading" aria-expanded="true">
              <span className="mail-inbox__account-heading-main">
                <span className="mail-inbox__account-chevron" aria-hidden>⌄</span>
                <span className="mail-inbox__account-heading-label">support@solarglobe.fr</span>
              </span>
              <span className="mail-inbox__account-health">Reconnexion requise</span>
            </button>
            <button type="button" className="mail-inbox__account-heading" aria-expanded="false">
              <span className="mail-inbox__account-heading-main">
                <span className="mail-inbox__account-chevron" aria-hidden>›</span>
                <span className="mail-inbox__account-heading-label">ancien-compte-deconnecte@solarglobe.fr</span>
              </span>
              <span className="mail-inbox__account-health">Déconnecté</span>
            </button>
          </nav>
        </aside>
        <section className="mail-inbox__list-panel">
          <div className="mail-inbox__search">
            <input className="mail-inbox__search-input" value="devis has:attachment" readOnly aria-label="Recherche demo" />
            <button type="button" className="mail-inbox__search-clear" aria-label="Effacer la recherche">×</button>
          </div>
          <div className="mail-inbox__filter-strip">
            <div className="mail-filters mail-filters--toolbar">
              <div className="mail-filters__cell"><label className="mail-filters__lbl-toolbar">Compte</label><select className="mail-filters__select" defaultValue="contact"><option value="">Tous</option><option value="contact">contact@solarglobe.fr</option></select></div>
              <div className="mail-filters__cell"><label className="mail-filters__lbl-toolbar">Expéditeur</label><input className="mail-filters__select" value="martin" readOnly /></div>
              <div className="mail-filters__cell"><label className="mail-filters__lbl-toolbar">Destinataire</label><input className="mail-filters__select" value="contact" readOnly /></div>
            </div>
            <div className="mail-inbox-sn-tablist" role="tablist" aria-label="Filtres demo">
              <button type="button" className="mail-inbox-sn-tab sn-badge sn-badge-info">Tous</button>
              <button type="button" className="mail-inbox-sn-tab sn-badge sn-badge-neutral">Non lus</button>
              <button type="button" className="mail-inbox-sn-tab sn-badge sn-badge-neutral">Avec PJ</button>
            </div>
            <label className="mail-inbox__sort">
              <span>Tri</span>
              <select defaultValue="newest"><option>Plus récents</option></select>
            </label>
            <details className="mail-inbox__keyboard-help" open><summary>Clavier</summary><p>J/K · Entrée · R · F · E · Suppr · U · Échap</p></details>
          </div>
          <div className="mail-inbox__toolbar">
            <span className="mail-inbox__toolbar-meta">3 conversations · recherche</span>
            <div className="mail-inbox__bulk-actions"><span>2 sélection</span><button className="mail-inbox__refresh-btn">Archiver</button><button className="mail-inbox__refresh-btn">Corbeille</button><select className="mail-inbox__move-select" defaultValue=""><option value="">Déplacer...</option><option>Archive / Projet très long / Sous-dossier</option></select></div>
          </div>
          <ul className="mail-thread-list">
            {threads.map((thread, index) => (
              <li key={thread.subject} className="mail-thread-list__item">
                <div className={`mail-thread-row${thread.unread ? " mail-thread-row--unread" : " mail-thread-row--read"}${index === 0 ? " mail-thread-row--selected" : ""}`} role="button" tabIndex={0}>
                  <label className="mail-thread-row__check"><input type="checkbox" defaultChecked={index < 2} aria-label={`Sélectionner ${thread.subject}`} /></label>
                  <div className="mail-thread-row__unread-slot" aria-hidden>{thread.unread ? <span className="mail-thread-row__dot" /> : <span className="mail-thread-row__dot mail-thread-row__dot--empty" />}</div>
                  <div className="mail-thread-row__avatar" aria-hidden>{thread.sender[0]}</div>
                  <div className="mail-thread-row__body mail-thread-row__body--with-quick">
                    <div className="mail-thread-row__row1"><span className="mail-thread-row__sender">{thread.sender}</span><span className="mail-thread-row__icons"><span className="sn-badge sn-badge-neutral">{thread.account}</span></span><time className="mail-thread-row__time">{thread.time}</time></div>
                    <p className="mail-thread-row__subject">{thread.subject}</p>
                    <p className="mail-thread-row__snippet">{thread.preview}</p>
                    {thread.state ? <div className="mail-thread-row__thread-labels"><span className="sn-badge sn-badge-warn">{thread.state}</span></div> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="mail-inbox__viewer" aria-label="Conversation demo">
          <div className="mail-viewer mail-viewer--with-footer">
            <header className="mail-viewer__header">
              <div className="mail-viewer__header-main">
                <h2 className="mail-viewer__title">Devis solaire résidentiel - retour signé</h2>
                <div className="mail-viewer__thread-status-row"><span className="sn-badge sn-badge-warn">Non lu</span><span className="sn-badge sn-badge-success">Pièces jointes</span></div>
              </div>
              <div className="mail-viewer__actions"><button className="mail-viewer__btn mail-viewer__btn--primary">Répondre</button><button className="mail-viewer__btn">Transférer</button></div>
            </header>
            <div className="mail-viewer__body mail-viewer__body--flex">
              <div className="mail-viewer__scroll">
                <div className="mail-viewer__timeline">
                  <article className="mail-msg mail-msg--in"><div className="mail-msg__avatar">C</div><div className="mail-msg__bubble mail-msg__bubble--in"><div className="mail-msg__meta"><strong>Claire Martin</strong><span>{" "}à contact@solarglobe.fr · 20 août 2026, 09:42</span></div><p className="mail-msg__text">Bonjour, voici le retour signé. Pouvez-vous confirmer la date de visite technique et la liste des pièces jointes attendues ?</p></div></article>
                  <article className="mail-msg mail-msg--out"><div className="mail-msg__avatar">S</div><div className="mail-msg__bubble mail-msg__bubble--out"><div className="mail-msg__meta"><strong>SolarGlobe</strong><span>{" "}réponse en attente d'envoi</span></div><p className="mail-msg__text">Merci, nous revenons vers vous avec le créneau confirmé.</p></div></article>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <article key={i} className={i % 2 ? "mail-msg mail-msg--out" : "mail-msg mail-msg--in"}><div className="mail-msg__avatar">{i % 2 ? "S" : "C"}</div><div className={`mail-msg__bubble ${i % 2 ? "mail-msg__bubble--out" : "mail-msg__bubble--in"}`}><div className="mail-msg__meta"><strong>{i % 2 ? "SolarGlobe" : "Claire Martin"}</strong><span>{" "}message {i + 3}</span></div><p className="mail-msg__text">Message de conversation longue pour vérifier le scroll et la stabilité du panneau lecteur.</p></div></article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div className="mail-overlay mail-overlay--demo" role="dialog" aria-modal="true" aria-label="Nouveau message demo">
        <div className="mail-overlay__panel mail-overlay__panel--demo">
          <div className="mail-composer mail-composer--overlay mail-overlay-content">
            <div className="mail-composer__head"><span className="mail-composer__mode">Nouveau message</span><button className="mail-composer__close" aria-label="Fermer">×</button></div>
            <label className="mail-composer-field"><span className="mail-composer-field__label">Objet</span><input className="mail-composer-field__input" value="Réponse avec objet très long contrôlé visuellement" readOnly /></label>
            <p className="mail-composer-field__label mail-composer__body-label">Message</p>
            <div className="mail-composer__body-demo">Composer ouvert pour vérifier que les actions restent accessibles à 125 %.</div>
            <div className="mail-composer__footer"><button className="mail-composer__send">Envoyer</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}
