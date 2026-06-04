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
  const visibleBlockers = pilot.blockers.slice(0, 2);
  const hiddenCount = Math.max(0, pilot.blockers.length - visibleBlockers.length);
  const interaction = pilot.lastInteraction;

  return (
    <section className="lead-commercial-pilot" aria-label="Pilotage commercial">
      <div className={`lead-commercial-pilot__next ${toneClass(pilot.nextAction.tone)}`}>
        <div className="lead-commercial-pilot__eyebrow">Prochaine action</div>
        <div className="lead-commercial-pilot__title" title={pilot.nextAction.subtitle}>
          {pilot.nextAction.title}
        </div>
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
              <p className="lead-commercial-pilot__line">Aucun suivi trace</p>
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
