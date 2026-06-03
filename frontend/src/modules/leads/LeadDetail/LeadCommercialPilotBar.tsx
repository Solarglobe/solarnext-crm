import type { CommercialPilotModel } from "./commercialPilot";

interface LeadCommercialPilotBarProps {
  pilot: CommercialPilotModel;
  onPrimaryAction: () => void;
  onBlockerClick: (blockerId: string) => void;
  primaryDisabled?: boolean;
}

function toneClass(tone: string): string {
  return `lead-pilot-tone-${tone}`;
}

export default function LeadCommercialPilotBar({
  pilot,
  onPrimaryAction,
  onBlockerClick,
  primaryDisabled = false,
}: LeadCommercialPilotBarProps) {
  const visibleBlockers = pilot.blockers.slice(0, 3);
  const hiddenCount = Math.max(0, pilot.blockers.length - visibleBlockers.length);
  const interaction = pilot.lastInteraction;

  return (
    <section className="lead-commercial-pilot" aria-label="Pilotage commercial">
      <div className={`lead-commercial-pilot__next ${toneClass(pilot.nextAction.tone)}`}>
        <div className="lead-commercial-pilot__eyebrow">Prochaine action</div>
        <div className="lead-commercial-pilot__title">{pilot.nextAction.title}</div>
        <p className="lead-commercial-pilot__subtitle">{pilot.nextAction.subtitle}</p>
        <button
          type="button"
          className="sn-btn sn-btn-primary sn-btn-sm lead-commercial-pilot__cta"
          disabled={primaryDisabled || pilot.nextAction.id === "none"}
          onClick={onPrimaryAction}
        >
          {pilot.nextAction.ctaLabel}
        </button>
      </div>

      <div className="lead-commercial-pilot__meta">
        <div className="lead-commercial-pilot__panel">
          <div className="lead-commercial-pilot__eyebrow">Dernière interaction enregistrée</div>
          {interaction ? (
            <>
              <div className={`lead-commercial-pilot__status ${toneClass(interaction.tone)}`}>
                {interaction.label} · {interaction.dateLabel}
              </div>
              <p className="lead-commercial-pilot__line" title={interaction.title}>
                {interaction.title}
              </p>
            </>
          ) : (
            <>
              <div className="lead-commercial-pilot__status lead-pilot-tone-danger">Aucune interaction</div>
              <p className="lead-commercial-pilot__line">Ajoutez une note, un appel ou un email pour tracer le suivi.</p>
            </>
          )}
        </div>

        <div className="lead-commercial-pilot__panel">
          <div className="lead-commercial-pilot__eyebrow">Blocages</div>
          {visibleBlockers.length ? (
            <div className="lead-commercial-pilot__blockers">
              {visibleBlockers.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`lead-commercial-pilot__blocker ${toneClass(b.tone)}`}
                  onClick={() => onBlockerClick(b.id)}
                >
                  {b.label}
                </button>
              ))}
              {hiddenCount ? <span className="lead-commercial-pilot__more">+{hiddenCount}</span> : null}
            </div>
          ) : (
            <div className="lead-commercial-pilot__status lead-pilot-tone-success">Aucun blocage majeur</div>
          )}
        </div>
      </div>
    </section>
  );
}
