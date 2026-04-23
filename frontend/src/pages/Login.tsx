import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import {
  login,
  isAuthenticated,
  LoginAmbiguousError,
} from "../services/auth.service";

const LOGO_SRC = "/logo.png";

function IconEye({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M3 3l18 18M10.58 10.58a2 2 0 002.83 2.83M9.88 9.88A3 3 0 0117 12c0 .88-.36 1.68-.94 2.26M6.53 6.53C4.48 7.63 3 10 3 12s3 7 9 7c1.95 0 3.55-.45 4.82-1.18"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14.12 14.12a3 3 0 01-4.24-4.24M1 12s3-7 11-7c.53 0 1.04.05 1.52.14M19.42 15.58A18.09 18.09 0 0021 12c-1.73-3.45-5.33-7-12-7-.69 0-1.35.06-2 .17"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /** Désambiguïsation login quand le même email existe dans plusieurs organisations. */
  const [orgChoices, setOrgChoices] = useState<
    { id: string; name: string | null }[] | null
  >(null);
  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("sn-auth-page");
    document.documentElement.classList.remove("sn-app-page");
    return () => {
      document.documentElement.classList.remove("sn-auth-page");
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const orgId =
        orgChoices && orgChoices.length > 0 ? selectedOrgId || undefined : undefined;
      await login(email, password, orgId);
      setOrgChoices(null);
      setSelectedOrgId("");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof LoginAmbiguousError) {
        setOrgChoices(err.organizations);
        setSelectedOrgId(err.organizations[0]?.id ?? "");
        setError(err.message);
      } else {
        setOrgChoices(null);
        setSelectedOrgId("");
        setError(
          err instanceof Error ? err.message : "Identifiants invalides"
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sn-auth-bg">
      <div className="sn-auth-watermark" aria-hidden>
        <img src={LOGO_SRC} alt="" draggable={false} />
      </div>
      <div className="sn-auth-center">
        <div className="sn-auth-card-shell">
          <Card variant="premium" padding="none" className="sn-auth-login-card">
            <div className="sn-auth-card-inner">
              <header className="sn-auth-header">
                <div className="sn-auth-brand-row">
                  <img
                    src={LOGO_SRC}
                    alt="SolarNext"
                    className="sn-auth-brand-mark"
                    decoding="async"
                  />
                  <span className="sn-auth-badge sn-auth-badge-gold">
                    CRM photovoltaïque
                  </span>
                </div>
                <h1 className="sn-auth-headline">
                  <span className="sn-auth-headline-brand">SolarNext</span>
                  <span className="sn-auth-headline-crm">CRM</span>
                </h1>
                <p className="sn-auth-tagline">
                  Accédez à votre espace de pilotage : leads, études et suivi
                  opérationnel, au même endroit.
                </p>
              </header>

              <form onSubmit={handleSubmit} className="sn-auth-form" noValidate>
                <div className="sn-auth-field">
                  <label htmlFor="email" className="sn-auth-label">
                    Adresse e-mail
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setOrgChoices(null);
                      setSelectedOrgId("");
                    }}
                    required
                    autoComplete="email"
                    placeholder="vous@entreprise.fr"
                    className="sn-input sn-auth-input"
                  />
                </div>

                <div className="sn-auth-field">
                  <label htmlFor="password" className="sn-auth-label">
                    Mot de passe
                  </label>
                  <div className="sn-auth-password-wrap">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setOrgChoices(null);
                        setSelectedOrgId("");
                      }}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="sn-input sn-auth-input"
                    />
                    <button
                      type="button"
                      className="sn-auth-password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword
                          ? "Masquer le mot de passe"
                          : "Afficher le mot de passe"
                      }
                    >
                      <IconEye visible={showPassword} />
                    </button>
                  </div>
                </div>

                {orgChoices && orgChoices.length > 0 && (
                  <div className="sn-auth-field">
                    <label htmlFor="organization" className="sn-auth-label">
                      Organisation
                    </label>
                    <select
                      id="organization"
                      value={selectedOrgId}
                      onChange={(e) => setSelectedOrgId(e.target.value)}
                      className="sn-input sn-auth-input"
                    >
                      {orgChoices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name?.trim() ? o.name : o.id}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {error ? <p className="sn-auth-error">{error}</p> : null}

                <div className="sn-auth-submit">
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={loading}
                    fullWidth
                  >
                    {loading ? "Connexion…" : "Se connecter"}
                  </Button>
                </div>
              </form>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
