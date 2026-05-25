import { useEffect, useState } from "react";
import {
  confirmMfaSetup,
  disableMfa,
  fetchMfaStatus,
  fetchOrganizationSecurity,
  startMfaSetup,
  updateOrganizationSecurity,
  type MfaSetupStart,
  type MfaStatus,
} from "../services/mfa.service";
import {
  fetchActiveSessions,
  revokeOtherSessions,
  revokeSession,
  type ActiveSession,
} from "../services/sessions.service";
import { EmptyState, ErrorState, PageHeader, SectionHeader, SettingsCard } from "../components/ui";
import "./security-settings-page.css";

export default function SecuritySettingsPage() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<MfaSetupStart | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [requireMfa, setRequireMfa] = useState(false);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const [mfa, security] = await Promise.all([
      fetchMfaStatus(),
      fetchOrganizationSecurity().catch(() => ({ requireMfa: false })),
    ]);
    setStatus(mfa);
    setRequireMfa(security.requireMfa);
    setSessions(await fetchActiveSessions().catch(() => []));
  };

  useEffect(() => {
    reload()
      .catch((err) => setMessage(err instanceof Error ? err.message : "Chargement impossible"))
      .finally(() => setLoading(false));
  }, []);

  const startSetup = async () => {
    setMessage("");
    setSetup(await startMfaSetup());
  };

  const confirmSetup = async () => {
    setMessage("");
    try {
      const result = await confirmMfaSetup(confirmCode);
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setConfirmCode("");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Activation impossible");
    }
  };

  const submitDisable = async () => {
    setMessage("");
    try {
      await disableMfa(disablePassword, disableCode);
      setDisablePassword("");
      setDisableCode("");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Desactivation impossible");
    }
  };

  const toggleOrgMfa = async (checked: boolean) => {
    setRequireMfa(checked);
    try {
      const next = await updateOrganizationSecurity(checked);
      setRequireMfa(next.requireMfa);
    } catch (err) {
      setRequireMfa(!checked);
      setMessage(err instanceof Error ? err.message : "Mise a jour impossible");
    }
  };

  const revokeOneSession = async (id: string) => {
    setMessage("");
    try {
      await revokeSession(id);
      setSessions(await fetchActiveSessions());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Revocation impossible");
    }
  };

  const revokeOthers = async () => {
    setMessage("");
    try {
      const count = await revokeOtherSessions();
      setMessage(`${count} session(s) revoquee(s).`);
      setSessions(await fetchActiveSessions());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Revocation impossible");
    }
  };

  if (loading) return <div className="security-settings">Chargement securite...</div>;

  return (
    <div className="security-settings">
      <PageHeader title="Securite" description="MFA TOTP compatible Google Authenticator et Authy." />

      <SettingsCard
        className="security-card"
        title="Authentification MFA"
        description={`Statut : ${status?.enabled ? "activee" : "inactive"}`}
        actions={
          !status?.enabled ? (
            <button type="button" className="sn-btn sn-btn-primary" onClick={() => void startSetup()}>
              Activer le MFA
            </button>
          ) : null
        }
      />

      {setup ? (
        <section className="security-card security-card--setup">
          <div>
            <h2>Scanner le QR code</h2>
            <p>Cle manuelle : <code>{setup.manualKey}</code></p>
          </div>
          <img src={setup.qrCodeDataUrl} alt="QR code MFA" className="security-qr" />
          <label className="security-field">
            <span>Premier code MFA</span>
            <input value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} inputMode="numeric" />
          </label>
          <button type="button" className="sn-btn sn-btn-primary" onClick={() => void confirmSetup()}>
            Valider et activer
          </button>
        </section>
      ) : null}

      {recoveryCodes.length > 0 ? (
        <section className="security-card">
          <div>
            <h2>Codes de secours</h2>
            <p>Ils ne seront affiches qu'une seule fois.</p>
          </div>
          <div className="security-recovery-grid">
            {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
          </div>
        </section>
      ) : null}

      {status?.enabled ? (
        <section className="security-card">
          <div>
            <h2>Desactiver le MFA</h2>
            <p>Mot de passe actuel et code TOTP requis.</p>
          </div>
          <label className="security-field">
            <span>Mot de passe actuel</span>
            <input type="password" value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} />
          </label>
          <label className="security-field">
            <span>Code MFA</span>
            <input value={disableCode} onChange={(event) => setDisableCode(event.target.value)} inputMode="numeric" />
          </label>
          <button type="button" className="sn-btn sn-btn-danger" onClick={() => void submitDisable()}>
            Desactiver
          </button>
        </section>
      ) : null}

      <SettingsCard className="security-card" title="Politique organisation" description="Imposer le MFA a tous les membres de l'organisation.">
        <label className="security-toggle">
          <input type="checkbox" checked={requireMfa} onChange={(event) => void toggleOrgMfa(event.target.checked)} />
          <span>MFA obligatoire</span>
        </label>
      </SettingsCard>

      <section className="security-card">
        <div className="security-card__split">
          <div>
            <SectionHeader
              title="Sessions actives"
              description="Appareils connectes a votre compte avec refresh token actif."
            />
          </div>
          <button type="button" className="sn-btn sn-btn-secondary" onClick={() => void revokeOthers()}>
            Deconnecter toutes les autres sessions
          </button>
        </div>
        <div className="security-session-list">
          {sessions.length === 0 ? (
            <EmptyState title="Aucune session active trouvee" description="Les nouvelles connexions apparaitront ici." />
          ) : (
            sessions.map((session) => (
              <article className="security-session" key={session.id}>
                <div className="security-session__icon" aria-hidden>
                  {session.deviceHint?.toLowerCase().includes("mobile") ? "M" : "D"}
                </div>
                <div className="security-session__body">
                  <strong>
                    {session.deviceHint || "Appareil inconnu"}
                    {session.current ? <span className="security-current-badge">Session actuelle</span> : null}
                  </strong>
                  <span>
                    IP {session.ipAddress || "inconnue"}
                    {session.countryHint ? ` - ${session.countryHint}` : ""}
                  </span>
                  <small>
                    Derniere activite : {new Date(session.lastUsedAt).toLocaleString("fr-FR")}
                  </small>
                </div>
                {!session.current ? (
                  <button type="button" className="sn-btn sn-btn-ghost" onClick={() => void revokeOneSession(session.id)}>
                    Revoquer
                  </button>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>

      {message ? <ErrorState tone="warning" message={message} /> : null}
    </div>
  );
}
