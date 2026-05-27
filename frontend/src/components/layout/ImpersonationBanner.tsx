import { exitAdminImpersonationSession } from "../../services/organizations.service";
import "./impersonation-banner.css";

/**
 * État du jeton d'impersonation — union discriminée sur le type de cible.
 * Déplacé ici depuis AppLayout.tsx pour que le composant soit autonome.
 */
export type ImpersonationMetaState =
  | { type: "ORG"; organizationName: string; organizationId: string }
  | {
      type: "USER";
      userName: string;
      organizationName: string;
      userId?: string;
      organizationId?: string;
    };

interface ImpersonationBannerProps {
  meta: ImpersonationMetaState;
}

/**
 * Bandeau sécurité mode admin — visible uniquement en session d'impersonation.
 *
 * Couleur rouge fixe intentionnelle (alerte de sécurité universelle, indépendante du thème).
 * Pas d'inline styles : toutes les propriétés vivent dans impersonation-banner.css.
 */
export function ImpersonationBanner({ meta }: ImpersonationBannerProps) {
  return (
    <div role="status" className="sn-impersonation-banner">
      <div className="sn-impersonation-banner__body">
        <span className="sn-impersonation-banner__mode">Mode admin</span>
        {meta.type === "USER" ? (
          <>
            <span className="sn-impersonation-banner__name">{meta.userName}</span>
            <span className="sn-impersonation-banner__org">{meta.organizationName}</span>
          </>
        ) : (
          <span className="sn-impersonation-banner__name">{meta.organizationName}</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => exitAdminImpersonationSession()}
        className="sn-impersonation-banner__exit"
      >
        Quitter
      </button>
    </div>
  );
}
