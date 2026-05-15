
export type SaasTabItem<T extends string = string> = { id: T; label: string };

export interface SaasTabsProps<T extends string> {
  items: SaasTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  /** Accessible name du tablist */
  ariaLabel?: string;
  /** Préfixe des id de tab (`${tabIdPrefix}-${id}`) pour aria-labelledby */
  tabIdPrefix?: string;
  /** Panneau associé (aria-controls), souvent unique pour pages à panneau unique */
  panelId?: string;
  className?: string;
}

/**
 * Onglets horizontaux sobres (underline actif) — aligné design system SaaS CRM.
 */
export function SaasTabs<T extends string>({
  items,
  activeId,
  onChange,
  ariaLabel,
  tabIdPrefix,
  panelId,
  className = "",
}: SaasTabsProps<T>) {
  return (
    <div className={`sn-saas-tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const tid = tabIdPrefix ? `${tabIdPrefix}-${item.id}` : undefined;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={tid}
            aria-selected={activeId === item.id}
            aria-controls={panelId}
            className={`sn-saas-tab${activeId === item.id ? " sn-saas-tab--active" : ""}`}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
